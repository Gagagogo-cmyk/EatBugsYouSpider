// Core (juce_core-only) tests: id format, JSON I/O, notation + filter CONFORMANCE against the shared
// vectors, Library create/edit/trash/dataset, job spool, and the two halves of the C++ <-> Python interop test.
//
//   core_tests                             run everything except interop
//   core_tests --conformance <dir>         directory containing filter_cases.json / notation_cases.json
//   core_tests --interop-write <libdir>    create a library with Bakes + queued jobs (for the Python worker)
//   core_tests --interop-verify <libdir>   after the worker ran: every Bake READY, maps/analyses readable
#include "../core/Ids.h"
#include "../core/JsonIo.h"
#include "../core/NotationProfile.h"
#include "../core/FilterQuery.h"
#include "../core/Library.h"
#include "../core/Jobs.h"
#include "../core/Handoff.h"
#include "../core/MapData.h"
#include <iostream>
#include <cmath>
#include <set>

using juce::String;
using juce::var;
using namespace gnumbat;

static int g_checks = 0, g_fail = 0;
#define CHECK(cond) do { ++g_checks; if (! (cond)) { ++g_fail; std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " << #cond << "\n"; } } while (0)
#define CHECK_MSG(cond, msg) do { ++g_checks; if (! (cond)) { ++g_fail; std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " << #cond << "  -- " << String (msg).toRawUTF8() << "\n"; } } while (0)

static juce::File makeTempDir (const String& name)
{
    auto d = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("gnumbat_" + name + "_" + String::toHexString (juce::Random::getSystemRandom().nextInt()));
    d.createDirectory();
    return d;
}

static CapturedAudio sine (double sr, double seconds, double hz, int channels = 2, float amp = 0.5f)
{
    CapturedAudio a;
    a.sampleRate = sr;
    const auto n = (size_t) (sr * seconds);
    a.channels.assign ((size_t) channels, std::vector<float> (n));
    for (int c = 0; c < channels; ++c)
        for (size_t i = 0; i < n; ++i)
            a.channels[(size_t) c][i] = amp * (float) std::sin (2.0 * juce::MathConstants<double>::pi * hz * (c + 1) * (double) i / sr);
    return a;
}

// ------------------------------------------------------------------------------------------------ ids
static void testIds()
{
    auto a = ids::ulid();
    CHECK (a.length() == 26);
    CHECK (ids::isId ("bk_" + a, "bk"));
    CHECK (! ids::isId ("bk_" + a, "dc"));
    CHECK (! ids::isId ("bk_" + a.dropLastCharacters (1), "bk"));
    CHECK (! ids::isId ("bk_" + a.replaceSection (0, 1, "U"), "bk"));       // 'U' is not in Crockford
    CHECK (! ids::isId ("bk_" + a.toLowerCase(), "bk"));

    juce::int64 t = 1758456789123;                                          // explicit time roundtrip
    CHECK (ids::timeMs (ids::ulid (t)) == t);
    CHECK (ids::timeMs ("bk_" + ids::ulid (t)) == t);

    String prev;
    bool sorted = true;
    std::set<String> seen;
    for (int i = 0; i < 20000; ++i)                                         // many ids inside one millisecond must still sort
    {
        auto u = ids::ulid();
        if (prev.isNotEmpty() && ! (prev < u)) sorted = false;
        seen.insert (u);
        prev = u;
    }
    CHECK (sorted);
    CHECK (seen.size() == 20000);

    // cross-language vector: 2026-01-01T00:00:00Z (1767225600000 ms) encodes to this time prefix
    CHECK (ids::ulid (1767225600000).substring (0, 10) == "01KDVDNA00");
    CHECK (ids::shortId ("bk_" + ids::ulid()).length() == 9);
}

// ------------------------------------------------------------------------------------------------ json
static void testJson()
{
    auto now = json::utcNow();
    CHECK (now.length() == 24 && now.endsWithChar ('Z') && now[10] == 'T');
    auto t = juce::Time::fromISO8601 (now);
    CHECK (std::abs (t.toMilliseconds() - juce::Time::currentTimeMillis()) < 3000);

    auto dir = makeTempDir ("json");
    auto f = dir.getChildFile ("x/y.json");
    const auto unicode = String::fromUTF8 ("h\xc3\xa9llo \"q\" \n \xe2\x99\xaa");        // é, quotes, newline, ♪
    auto doc = json::object ({ { "i", 3 }, { "d", 128.5 }, { "one", 1.0 }, { "s", unicode }, { "b", true }, { "n", var() },
                               { "a", var (juce::Array<var> { 1, "two", 3.5 }) } });
    CHECK (json::atomicWriteJson (f, doc));
    bool ok = false;
    auto back = json::readFile (f, &ok);
    CHECK (ok);
    CHECK (json::getNumber (back, "d") == 128.5);
    CHECK (json::getString (back, "s") == unicode);
    CHECK (json::getBool (back, "b"));
    CHECK (json::has (back, "n") && json::get (back, "n").isVoid());
    CHECK (json::getStrings (back, "a").size() == 1);
    // no leftover temp files
    int leftovers = 0;
    for (auto& e : juce::RangedDirectoryIterator (f.getParentDirectory(), false, "*.tmp")) { (void) e; ++leftovers; }
    CHECK (leftovers == 0);
    CHECK (json::sha256OfFile (f).length() == 64);

    // SHA-256 of "abc" (FIPS 180-2 vector)
    auto abc = dir.getChildFile ("abc.txt");
    json::atomicWrite (abc, "abc");
    CHECK (json::sha256OfFile (abc) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    bool ok2 = true;
    dir.getChildFile ("bad.json").replaceWithText ("{ nope");
    json::readFile (dir.getChildFile ("bad.json"), &ok2);
    CHECK (! ok2);
    dir.deleteRecursively();
}

// ------------------------------------------------------------------------------------------------ conformance
static void testNotationConformance (const juce::File& dir)
{
    bool ok = false;
    auto doc = json::readFile (dir.getChildFile ("notation_cases.json"), &ok);
    CHECK_MSG (ok, "cannot read notation_cases.json in " + dir.getFullPathName());
    if (! ok) return;
    auto profiles = doc.getProperty ("profiles", {});
    int n = 0;
    for (auto& c : *doc.getProperty ("cases", {}).getArray())
    {
        ++n;
        auto profile = profiles.getProperty (json::getString (c, "profile"), {});
        auto raw = json::getString (c, "raw");
        CHECK (notation::validateProfile (profile).isEmpty());
        auto got = notation::parse (raw, profile);
        const auto want = json::getStrings (c, "tags");
        CHECK_MSG (got.tags == want, "tags for [" + json::getString (c, "profile") + "] '" + raw + "': got " + got.tags.joinIntoString ("|") + " want " + want.joinIntoString ("|"));

        auto wantFields = c.getProperty ("fields", {});
        auto* wf = wantFields.getDynamicObject();
        auto* gf = got.fields.getDynamicObject();
        CHECK_MSG (gf->getProperties().size() == wf->getProperties().size(), "field count for '" + raw + "': " + juce::JSON::toString (got.fields, true));
        for (auto& nv : wf->getProperties())
        {
            const auto g = gf->getProperty (nv.name);
            const bool same = (json::isNumber (nv.value) && json::isNumber (g)) ? (double) nv.value == (double) g : g.toString() == nv.value.toString();
            CHECK_MSG (same, "field " + nv.name.toString() + " for '" + raw + "': got " + g.toString() + " want " + nv.value.toString());
            // integers must stay integers (a tempo of 120 is "120", not "120.0")
            if (nv.value.isInt() || nv.value.isInt64()) CHECK_MSG (g.isInt() || g.isInt64(), "integer-ness of " + nv.name.toString());
        }
    }
    CHECK (n >= 13);
    std::cout << "  notation conformance: " << n << " cases\n";
}

static void testFilterConformance (const juce::File& dir)
{
    bool ok = false;
    auto doc = json::readFile (dir.getChildFile ("filter_cases.json"), &ok);
    CHECK_MSG (ok, "cannot read filter_cases.json in " + dir.getFullPathName());
    if (! ok) return;
    juce::Array<var> views = *doc.getProperty ("views", {}).getArray();
    int n = 0;
    for (auto& c : *doc.getProperty ("cases", {}).getArray())
    {
        ++n;
        juce::StringArray got;
        for (auto& v : views) if (filter::matches (v, c.getProperty ("query", {}))) got.add (json::getString (v, "id"));
        auto want = json::getStrings (c, "expect");
        CHECK_MSG (got == want, "filter case '" + json::getString (c, "name") + "': got [" + got.joinIntoString (",") + "] want [" + want.joinIntoString (",") + "]");
    }
    CHECK (n >= 30);
    std::cout << "  filter conformance: " << n << " cases\n";

    CHECK (filter::validate (filter::leaf ("a", "eq", 1)).isEmpty());
    CHECK (filter::validate (filter::leaf ("a", "wat", 1)).isNotEmpty());
    CHECK (filter::validate (filter::leaf ("a", "between", 1)).isNotEmpty());
    CHECK (filter::validate (json::object ({ { "and", var (juce::Array<var> { filter::leaf ("a", "nope", 1) }) } })).isNotEmpty());
    CHECK (filter::describe (filter::leaf ("fields/tempo", "gt", 100)) == "fields/tempo gt 100");

    auto cat = filter::catalog (views);
    bool sawTempo = false;
    for (auto& f : cat) if (f.path == "fields/tempo") { sawTempo = true; CHECK (f.hasRange && f.min == 95.5 && f.max == 120.0); CHECK (f.types.contains ("number") && f.types.contains ("string")); }
    CHECK (sawTempo);
}

// ------------------------------------------------------------------------------------------------ library
static void testLibrary()
{
    auto dir = makeTempDir ("lib");
    auto root = dir.getChildFile ("lib");
    CHECK (Library::init (root).wasOk());
    CHECK (Library::init (root).wasOk());                     // idempotent
    CHECK (Library::looksLikeLibrary (root));
    Library lib (root);
    CHECK (lib.libraryId().length() >= 8);
    CHECK (lib.listBakeIds().isEmpty());
    CHECK (root.getChildFile ("notation_profiles/np_freeform.json").existsAsFile());

    // -- create: raw notation verbatim, freeform => one phrase-tag
    NewBake nb;
    nb.audio = sine (48000.0, 2.0, 220.0);
    nb.rawNotation = "  metallic-density-increase / 4 bars  ";
    nb.capture.hostName = "TestHost"; nb.capture.hostVersion = "1.2"; nb.capture.pluginVersion = kCoreVersion;
    nb.capture.hasTimeline = true; nb.capture.startSample = 96000; nb.capture.endSample = 192000; nb.capture.timelineSampleRate = 48000;
    nb.capture.hasPpq = true; nb.capture.startPpq = 4.0; nb.capture.endPpq = 8.0; nb.capture.tempoBpm = 120; nb.capture.timeSigNum = 4; nb.capture.timeSigDen = 4;
    nb.capture.coverage = 0.75; nb.capture.complete = false; nb.capture.mode = "range";
    nb.extraTags.add ("mine");
    String id;
    auto r = lib.createBake (nb, id);
    CHECK_MSG (r.wasOk(), r.getErrorMessage());
    CHECK (ids::isId (id, "bk"));
    CHECK (lib.listBakeIds() == juce::StringArray (id));
    CHECK (lib.bakesDir().getNumberOfChildFiles (juce::File::findDirectories, "*.partial") == 0);

    auto bake = lib.readBake (id);
    CHECK (json::getString (bake, "audio/sha256") == json::sha256OfFile (lib.audioFile (id)));
    CHECK (json::getNumber (bake, "audio/frames") == 96000 && json::getNumber (bake, "audio/channels") == 2);
    CHECK (json::getString (bake, "audio/sample_format") == "float32");
    CHECK (json::getNumber (bake, "audio/duration_s") == 2.0);
    CHECK (bake.getProperty ("preview", {}).getProperty ("peaks", {}).getArray()->size() == 192);
    CHECK (json::getBool (bake, "capture/complete") == false && json::getNumber (bake, "capture/coverage") == 0.75);
    CHECK (json::getNumber (bake, "capture/timeline/start_sample") == 96000);

    auto sem = lib.readSemantic (id);
    CHECK (json::getString (sem, "raw_notation") == "  metallic-density-increase / 4 bars  ");     // verbatim, whitespace and all
    CHECK (json::getStrings (sem, "tags") == juce::StringArray ("metallic-density-increase / 4 bars", "mine"));
    CHECK (json::getString (lib.readState (id), "state") == "CAPTURED");
    CHECK (JobSubmitter (root).counts().pending == 1);

    // WAV bytes: RIFF/float, readable back
    {
        juce::FileInputStream in (lib.audioFile (id));
        char hdr[12]; in.read (hdr, 12);
        CHECK (std::memcmp (hdr, "RIFF", 4) == 0 && std::memcmp (hdr + 8, "WAVE", 4) == 0);
        CHECK (lib.audioFile (id).getSize() == 56 + 96000 * 2 * 4);          // RIFF+fmt+fact+data headers = 56 bytes
    }

    // -- musical-dash profile derives fields but raw stays verbatim
    NewBake nb2;
    nb2.audio = sine (44100.0, 1.0, 330.0, 1);
    nb2.rawNotation = "rise-E minor-120 BPM-4 bars-energetic";
    nb2.profile = notation::builtinProfile ("np_musical_dash");
    nb2.submit = false;
    String id2;
    CHECK (lib.createBake (nb2, id2).wasOk());
    auto sem2 = lib.readSemantic (id2);
    CHECK (json::getString (sem2, "raw_notation") == "rise-E minor-120 BPM-4 bars-energetic");
    CHECK (json::getStrings (sem2, "tags") == juce::StringArray ("rise", "E minor", "energetic"));
    CHECK (json::getNumber (sem2, "fields/tempo") == 120 && (json::get (sem2, "fields/tempo").isInt() || json::get (sem2, "fields/tempo").isInt64()));
    CHECK (json::getString (sem2, "field_origin/tempo") == "parsed");
    CHECK (json::getString (sem2, "notation_profile/id") == "np_musical_dash");
    CHECK (JobSubmitter (root).counts().pending == 1);        // submit=false queued nothing

    // -- empty capture refused, nothing left behind
    NewBake bad;
    CHECK (lib.createBake (bad, id).failed());
    CHECK (lib.listBakeIds().size() == 2);

    // -- views + filter
    auto assoc = lib.associations();
    auto v2 = lib.bakeView (id2, assoc);
    CHECK (json::getString (v2, "state") == "CAPTURED" && json::getNumber (v2, "fields/tempo") == 120);
    CHECK (filter::matches (v2, filter::leaf ("fields/tempo", "between", var (juce::Array<var> { 100, 130 }))));
    CHECK (filter::matches (v2, filter::text ("ENERGETIC minor")));
    CHECK (! filter::matches (lib.bakeView (id, assoc), filter::leaf ("fields/tempo", "exists", true)));

    // -- semantic edit: rev bump, history, conflict detection, unknown fields preserved
    {
        auto p = lib.bakeDir (id2).getChildFile ("semantic.json");
        auto raw = json::readFile (p);
        raw.getDynamicObject()->setProperty ("x_future", "keep me");
        json::atomicWriteJson (p, raw);
    }
    SemanticEdit e;
    e.addTags.add ("Rise");                                   // duplicate of "rise" (case-insensitive) => no-op
    e.addTags.add ("favourite");
    e.removeTags.add ("ENERGETIC");
    e.addGroups.add ("risers");
    e.setFields = json::object ({ { "mood", "dark" }, { "tempo", 121 } });
    e.setNotes = true; e.notes = "use in bridge";
    var nd;
    CHECK (lib.updateSemantic (id2, e, 1, &nd).wasOk());
    auto s2 = lib.readSemantic (id2);
    CHECK (json::getNumber (s2, "rev") == 2);
    CHECK (json::getStrings (s2, "tags") == juce::StringArray ("rise", "E minor", "favourite"));
    CHECK (json::getStrings (s2, "groups") == juce::StringArray ("risers"));
    CHECK (json::getString (s2, "field_origin/tempo") == "user" && json::getNumber (s2, "fields/tempo") == 121);
    CHECK (json::getString (s2, "field_origin/key") == "parsed");
    CHECK (json::getString (s2, "x_future") == "keep me");
    CHECK (json::getString (s2, "raw_notation") == "rise-E minor-120 BPM-4 bars-energetic");   // untouched by tag edits
    CHECK (lib.updateSemantic (id2, e, 1).failed());          // stale rev
    CHECK (lib.updateSemantic (id2, e, 1).getErrorMessage().startsWith ("CONFLICT"));
    CHECK (lib.bakeDir (id2).getChildFile ("semantic.history.jsonl").existsAsFile());
    {
        auto lines = juce::StringArray::fromLines (lib.bakeDir (id2).getChildFile ("semantic.history.jsonl").loadFileAsString());
        lines.removeEmptyStrings();
        CHECK (lines.size() == 1);
        var h; juce::JSON::parse (lines[0], h);
        CHECK (json::getNumber (h, "rev") == 1 && json::getNumber (h, "fields/tempo") == 120);
    }
    // re-notate + reparse keeps user fields, replaces parsed ones
    SemanticEdit e3;
    e3.setRawNotation = true; e3.rawNotation = "drone-90 BPM";
    e3.reparse = true;
    CHECK (lib.updateSemantic (id2, e3, 2).wasOk());
    auto s3 = lib.readSemantic (id2);
    CHECK (json::getString (s3, "raw_notation") == "drone-90 BPM");
    CHECK (json::getStrings (s3, "tags") == juce::StringArray ("drone"));
    CHECK (json::getNumber (s3, "fields/tempo") == 90 && json::getString (s3, "field_origin/tempo") == "parsed");   // parse overwrote the user value (documented)
    CHECK (json::getString (s3, "fields/mood") == "dark");
    CHECK (! json::has (s3, "fields/key"));

    // -- datasets
    String ds;
    CHECK (lib.createDataset ("risers v1", { id, id2, id }, ds).wasOk());
    CHECK (lib.createDataset ("  ", {}, ds).failed());
    auto list = lib.listDatasets();
    CHECK (list.size() == 1 && list[0].members == 2 && list[0].name == "risers v1");
    CHECK (lib.removeFromDataset (list[0].id, { id }).wasOk());
    CHECK (lib.listDatasets()[0].members == 1);
    CHECK (lib.addToDataset (list[0].id, { id }).wasOk());
    CHECK (lib.listDatasets()[0].members == 2);
    CHECK (lib.addToDataset ("ds_missing", { id }).failed());

    // -- trash / restore
    juce::File trashed;
    CHECK (lib.trashBake (id, &trashed).wasOk());
    CHECK (lib.listBakeIds() == juce::StringArray (id2));
    String back;
    CHECK (lib.restoreBake (trashed, &back).wasOk() && back == id);
    CHECK (lib.listBakeIds().size() == 2);

    // -- profiles
    CHECK (lib.listProfiles().size() >= 2);
    CHECK (json::getString (lib.listProfiles()[0], "profile_id") == "np_freeform");
    auto custom = notation::builtinProfile ("np_musical_dash").clone();
    custom.getDynamicObject()->setProperty ("profile_id", "np_custom");
    CHECK (lib.saveProfile (custom).wasOk());
    CHECK (lib.getProfile ("np_custom").getDynamicObject() != nullptr);
    auto broken = custom.clone();
    broken.getProperty ("rules", {}).getArray()->getReference (0).getDynamicObject()->setProperty ("match", "([unclosed");
    CHECK (lib.saveProfile (broken).failed());
    CHECK (notation::validateProfile (broken).isNotEmpty());
    auto p = notation::parse ("120 bpm", broken);              // never throws; reports the problem
    CHECK (p.error.isNotEmpty());

    dir.deleteRecursively();
}

// ------------------------------------------------------------------------------------------------ jobs / worker status
static void testJobs()
{
    auto dir = makeTempDir ("jobs");
    auto root = dir.getChildFile ("lib");
    Library::init (root);
    JobSubmitter js (root);
    auto id = js.submit ("project_map", json::object ({ { "feature_set_id", "spectral" } }));
    CHECK (ids::isId (id, "job"));
    auto doc = json::readFile (root.getChildFile ("jobs/pending/" + id + ".json"));
    CHECK (json::getString (doc, "type") == "project_map" && json::getNumber (doc, "attempt") == 0 && json::getNumber (doc, "max_attempts") == 2);
    CHECK (json::getString (doc, "created_by/app") == "gnumbat-plugin");
    CHECK (js.counts().pending == 1 && js.counts().running == 0);
    CHECK (js.result (id).isVoid());
    js.cancel (id);
    CHECK (root.getChildFile ("jobs/cancel/" + id).exists());

    auto w0 = readWorkerStatus (root);
    CHECK (! w0.present && ! w0.alive && w0.summary() == "no worker");

    auto hb = [&] (double ageSeconds)
    {
        auto d = json::object ({ { "schema", "gnumbat.worker_status/0.1" }, { "pid", 4242 }, { "version", "0.1.0" },
                                 { "heartbeat_unix", juce::Time::currentTimeMillis() / 1000.0 - ageSeconds },
                                 { "capabilities", json::object ({ { "decompose", json::array ({ "demucs", "testsplit" }) }, { "analyze", json::array ({ "python-ref" }) }, { "project", json::array ({ "tsne" }) } }) },
                                 { "current_job", json::object ({ { "job_id", "job_X" }, { "type", "process_bake" } }) } });
        json::atomicWriteJson (root.getChildFile ("worker.json"), d);
        return readWorkerStatus (root);
    };
    auto fresh = hb (1.0);
    CHECK (fresh.present && fresh.alive && fresh.pid == 4242 && fresh.decomposers.size() == 2 && fresh.currentJobType == "process_bake");
    CHECK (fresh.summary().contains ("demucs"));
    CHECK (! hb (60.0).alive && hb (60.0).present);

    Settings s = Settings::load();
    s.set ("python", "/opt/py 3/bin/python3");
    s.set ("core_path", "/home/u/it's here/core");
    auto cmd = workerCommandLine (s, juce::File ("/tmp/my lib"));
   #if ! JUCE_WINDOWS
    CHECK (cmd.contains ("PYTHONPATH='/home/u/it'\\''s here/core'"));
    CHECK (cmd.endsWith ("-l '/tmp/my lib' worker"));
   #endif
    dir.deleteRecursively();
}

// ------------------------------------------------------------------------------------------------ interop

// ---------------------------------------------------------------------------------------------- EBYS hand-off
static juce::File makeFakeEbys (const juce::File& root, const String& session = "default")
{
    root.getChildFile ("src/demucs").createDirectory();
    root.getChildFile ("src/demucs/watch_demucs.py").replaceWithText ("# fake watcher\n");
    root.getChildFile ("data").createDirectory();
    if (session.isNotEmpty()) root.getChildFile ("data/current_session.txt").replaceWithText (session + "\n");
    return root;
}

static juce::Array<juce::File> pendingJobs (const juce::File& lib)
{
    return lib.getChildFile ("jobs/pending").findChildFiles (juce::File::findFiles, false, "job_*.json");
}

static NewBake handoffBake (const juce::File& ebys, const String& notation, const String& decomposer = "auto")
{
    NewBake nb;
    nb.audio = sine (44100.0, 1.0, 220.0, 2, 0.25f);
    nb.rawNotation = notation;
    nb.decomposer = decomposer;
    nb.handoff.enabled = true;
    nb.handoff.ebysRoot = ebys;
    return nb;
}

static void testHandoff()
{
    auto dir = makeTempDir ("handoff");
    const auto ebys = makeFakeEbys (dir.getChildFile ("EBYS"), "live set");

    // ---- naming: ASCII, safe, and the Bake id survives
    CHECK (handoff::trackName ("Rise - C minor / 140 BPM", "bk_ABC") == "rise-c-minor-140-bpm__bk_ABC");
    CHECK (handoff::trackName ("", "bk_ABC") == "bake__bk_ABC");
    CHECK (handoff::trackName (String::fromUTF8 ("éé!!"), "bk_X") == "bake__bk_X");
    CHECK (! handoff::trackName (String ("a").paddedRight ('b', 300), "bk_X").containsChar ('/') && handoff::trackName (String ("a").paddedRight ('b', 300), "bk_X").length() < 64);

    // ---- resolve: the repo is validated, the session comes from data/current_session.txt
    handoff::Target t;
    CHECK (handoff::resolve (dir.getChildFile ("nope"), t).failed());
    CHECK (handoff::resolve (dir, t).failed());                                   // a folder, but not the repo
    CHECK (handoff::resolve (ebys, t, false).wasOk() && t.sessionId == "live set");
    CHECK (! t.rawUploads.isDirectory());                                         // createRawUploads = false has no side effect
    CHECK (handoff::resolve (ebys, t).wasOk() && t.rawUploads.isDirectory());
    CHECK (t.rawUploads.getFullPathName().endsWith (String ("data/sessions/live set/raw_uploads").replace ("/", juce::File::getSeparatorString())));
    ebys.getChildFile ("data/current_session.txt").replaceWithText ("");
    CHECK (handoff::resolve (ebys, t, false).wasOk() && t.sessionId == "default");     // empty file == "default", like watch_demucs.py
    ebys.getChildFile ("data/current_session.txt").replaceWithText ("../evil");
    CHECK (handoff::resolve (ebys, t, false).failed());
    ebys.getChildFile ("data/current_session.txt").replaceWithText ("live set");

    // ---- write: whole file appears in raw_uploads, nothing else is left behind
    auto audio = sine (48000.0, 0.5, 330.0, 2, 0.3f);
    juce::File written;
    CHECK (handoff::resolve (ebys, t).wasOk());
    CHECK_MSG (handoff::write (t, audio, "riser__bk_1", written).wasOk(), "write");
    CHECK (written == t.rawUploads.getChildFile ("riser__bk_1.wav") && written.existsAsFile());
    CHECK (written.getSize() >= (juce::int64) audio.frames() * 2 * 4 && written.getSize() < (juce::int64) audio.frames() * 2 * 4 + 200);
    {
        juce::MemoryBlock head;  written.loadFileAsData (head);
        CHECK (head.getSize() > 44 && std::memcmp (head.getData(), "RIFF", 4) == 0 && std::memcmp ((const char*) head.getData() + 8, "WAVE", 4) == 0);
    }
    CHECK (t.rawUploads.findChildFiles (juce::File::findFiles, false).size() == 1);                              // no .part, nothing hidden
    CHECK (t.sessionDir.getChildFile ("handoff_tmp").findChildFiles (juce::File::findFiles, false).isEmpty());
    CHECK (handoff::write (t, audio, "riser__bk_1", written).failed());                                         // never overwrites

    // ---- createBake: auto + link => file + manifest + job says "handoff"
    auto libDir = dir.getChildFile ("lib");
    CHECK (Library::init (libDir).wasOk());
    Library lib (libDir);
    String id, warn;
    CHECK_MSG (lib.createBake (handoffBake (ebys, "Rise C minor 140 BPM"), id, &warn).wasOk(), "createBake");
    CHECK (warn.isEmpty());
    const auto bake = lib.readBake (id);
    const auto track = "rise-c-minor-140-bpm__" + id;
    CHECK (json::getString (bake, "handoff/status") == "written" && json::getString (bake, "handoff/track") == track);
    CHECK (json::getString (bake, "handoff/session") == "live set");
    CHECK (juce::File (json::getString (bake, "handoff/file")).existsAsFile());
    CHECK (json::getString (bake, "handoff/stems_dir").endsWith (("stems/htdemucs/" + track).replace ("/", juce::File::getSeparatorString())));
    CHECK (t.rawUploads.getChildFile (track + ".wav").existsAsFile());
    CHECK (json::getString (bake, "audio/sha256").length() == 64);                                                // still a normal Bake
    {
        auto jobs = pendingJobs (libDir);
        CHECK (jobs.size() == 1);
        CHECK (json::getString (json::readFile (jobs[0]), "params/decompose") == "handoff");
    }
    CHECK (json::getString (lib.bakeView (id, {}), "handoff") == "waiting");
    CHECK (json::getString (lib.readSemantic (id), "raw_notation") == "Rise C minor 140 BPM");                     // notation untouched by the slug

    // ---- a follow-up Bake lands in whichever session is active *now*
    ebys.getChildFile ("data/current_session.txt").replaceWithText ("second");
    String id2;
    CHECK (lib.createBake (handoffBake (ebys, "again"), id2).wasOk());
    CHECK (ebys.getChildFile ("data/sessions/second/raw_uploads").getChildFile ("again__" + id2 + ".wav").existsAsFile());
    CHECK (json::getString (lib.readBake (id2), "handoff/session") == "second");

    // ---- explicit choices mean "do not feed the instrument"
    for (auto* d : { "testsplit", "demucs", "skip" })
    {
        String idx;
        const auto before = ebys.getChildFile ("data/sessions/second/raw_uploads").findChildFiles (juce::File::findFiles, false).size();
        CHECK (lib.createBake (handoffBake (ebys, "x", d), idx).wasOk());
        CHECK (! json::has (lib.readBake (idx), "handoff"));
        CHECK (ebys.getChildFile ("data/sessions/second/raw_uploads").findChildFiles (juce::File::findFiles, false).size() == before);
    }
    {
        String idx;
        auto nb = handoffBake (ebys, "not linked");
        nb.handoff.enabled = false;
        CHECK (lib.createBake (nb, idx).wasOk() && ! json::has (lib.readBake (idx), "handoff"));
    }

    // ---- failure never loses the Bake: it is saved, marked failed, told to the caller, and processed by the worker normally
    {
        String idx, w2;
        auto nb = handoffBake (dir.getChildFile ("missing"), "lost link");
        CHECK (lib.createBake (nb, idx, &w2).wasOk());
        CHECK (w2.contains ("not sent to the instrument"));
        CHECK (json::getString (lib.readBake (idx), "handoff/status") == "failed" && json::getString (lib.readBake (idx), "handoff/error").isNotEmpty());
        CHECK (json::getString (lib.bakeView (idx, {}), "handoff") == "failed");
        bool sawAuto = false;
        for (auto& j : pendingJobs (libDir))
        {
            const auto doc = json::readFile (j);
            if (json::getString (doc, "params/bake_id") == idx) sawAuto = json::getString (doc, "params/decompose") == "auto";
        }
        CHECK (sawAuto);
    }
    {
        String idx, w3;
        auto nb = handoffBake (ebys, "forced", "instrument");
        nb.handoff.enabled = false;
        CHECK (lib.createBake (nb, idx, &w3).wasOk() && w3.contains ("no EBYS folder is linked"));
    }
    dir.deleteRecursively();
}

static void interopWrite (const juce::File& libDir)
{
    libDir.deleteRecursively();
    CHECK (Library::init (libDir).wasOk());
    Library lib (libDir);
    const char* names[] = { "rise", "fall", "hits", "drone", "rise-E minor-120 BPM-4 bars-energetic", "metallic density increase" };
    for (int i = 0; i < 12; ++i)
    {
        NewBake nb;
        nb.audio = sine (44100.0, 2.5 + 0.1 * i, 110.0 * (1 + i % 5), 2, 0.4f);
        // add a decaying click train so the analyzers see transients, and a slow amplitude ramp for "rise"
        for (auto& ch : nb.audio.channels)
            for (size_t k = 0; k < ch.size(); ++k)
            {
                const double t = (double) k / 44100.0;
                ch[k] *= (float) (i % 2 == 0 ? (0.2 + 0.8 * t / 3.0) : std::exp (-2.0 * std::fmod (t, 0.5)));
            }
        nb.rawNotation = names[i % 6];
        nb.profile = i % 6 == 4 ? notation::builtinProfile ("np_musical_dash") : notation::freeformProfile();
        nb.capture.hostName = "interop"; nb.capture.tempoBpm = 120; nb.capture.timeSigNum = 4; nb.capture.timeSigDen = 4;
        nb.decomposer = "testsplit";
        nb.processParams = json::object ({ { "auto_map", false } });
        String id;
        auto r = lib.createBake (nb, id);
        CHECK_MSG (r.wasOk(), r.getErrorMessage());
    }
    JobSubmitter (libDir).submit ("project_map", json::object ({ { "feature_set_id", "spectral" }, { "method", "tsne" } }), -1);   // low priority: after all Bakes
    std::cout << "  wrote " << lib.listBakeIds().size() << " Bakes + " << JobSubmitter (libDir).counts().pending << " jobs to " << libDir.getFullPathName() << "\n";
}

static void interopVerify (const juce::File& libDir)
{
    Library lib (libDir);
    const auto idsList = lib.listBakeIds();
    CHECK (idsList.size() == 12);
    auto assoc = lib.associations();
    int ready = 0, withAnalysis = 0, withStems = 0;
    juce::Array<var> views;
    for (auto& id : idsList)
    {
        auto v = lib.bakeView (id, assoc);
        views.add (v);
        CHECK_MSG (json::getString (v, "state") == "READY", id + " is " + json::getString (v, "state") + " " + juce::JSON::toString (lib.readState (id).getProperty ("error", {}), true));
        ready += json::getString (v, "state") == "READY";
        withAnalysis += json::getNumber (v, "analysis/n_slices") > 0;
        withStems += json::get (v, "stems").getArray() != nullptr && json::get (v, "stems").getArray()->size() == 4;
        CHECK (lib.stemFiles (id).size() == 4);
        const auto stems = lib.stemFiles (id);
        for (auto& k : stems.getAllKeys()) CHECK (juce::File (stems[k]).existsAsFile());
        CHECK (json::has (v, "analysis/summary/mix/spectral.centroid"));
    }
    CHECK (ready == 12 && withAnalysis == 12 && withStems == 12);

    auto jobs = JobSubmitter (libDir).counts();
    CHECK_MSG (jobs.pending == 0 && jobs.running == 0 && jobs.failed == 0, "pending " + String (jobs.pending) + " running " + String (jobs.running) + " failed " + String (jobs.failed));

    auto map = readMap (libDir, "spectral");
    CHECK (map.valid && map.points.size() == 12 && map.method == "tsne");
    for (auto& p : map.points) CHECK (std::abs (p.x) <= 1.0001f && std::abs (p.y) <= 1.0001f && lib.bakeDir (p.bakeId).isDirectory());
    CHECK (map.hasTrust && map.disclaimer.isNotEmpty());
    CHECK (lib.listFeatureSets().size() >= 4);                 // the worker installed the built-in feature sets into a plugin-created library
    CHECK (listMapFeatureSets (libDir).contains ("spectral"));

    // the musical-dash Bake carries parsed fields the filter can use
    auto q = filter::leaf ("fields/tempo", "eq", 120);
    int hits = 0;
    for (auto& v : views) hits += filter::matches (v, q);
    CHECK (hits == 2);
    std::cout << "  verified 12 Bakes READY (stems=4, analysis present), map " << map.method << " trust=" << map.trustworthiness << "\n";
}


static void interopHandoffWrite (const juce::File& libDir, const juce::File& ebys)
{
    makeFakeEbys (ebys);
    CHECK (Library::init (libDir).wasOk());
    Library lib (libDir);
    const char* names[] = { "rise C minor 140 BPM", "drums 100 BPM", "" };
    for (int i = 0; i < 3; ++i)
    {
        auto nb = handoffBake (ebys, names[i]);
        nb.audio = sine (44100.0, 2.0 + 0.5 * i, 110.0 * (1 + i), 2, 0.4f);
        nb.processParams = json::object ({ { "auto_map", false } });
        String id, warn;
        CHECK_MSG (lib.createBake (nb, id, &warn).wasOk() && warn.isEmpty(), warn);
    }
    std::cout << "  handed 3 Bakes to " << ebys.getChildFile ("data/sessions/default/raw_uploads").getFullPathName() << "\n";
}

static void interopHandoffVerify (const juce::File& libDir)
{
    Library lib (libDir);
    const auto idsList = lib.listBakeIds();
    CHECK (idsList.size() == 3);
    for (auto& id : idsList)
    {
        auto v = lib.bakeView (id, {});
        CHECK_MSG (json::getString (v, "state") == "READY", id + " is " + json::getString (v, "state"));
        CHECK_MSG (json::getString (v, "handoff") == "adopted", id + " handoff=" + json::getString (v, "handoff"));
        CHECK (json::get (v, "stems").getArray() != nullptr && json::get (v, "stems").getArray()->size() == 4);
        CHECK (json::getString (lib.readDecomposition (id), "method/backend") == "instrument");
        CHECK (json::getNumber (v, "analysis/n_slices") > 0);
        CHECK (lib.stemFiles (id).size() == 4);
    }
    std::cout << "  verified 3 handed-off Bakes: READY, stems adopted from the instrument's folder\n";
}

int main (int argc, char** argv)
{
    juce::File conformance;
    juce::File interopW, interopV, hoLib, hoEbys, hoVerify;
    for (int i = 1; i < argc; ++i)
    {
        const String a (argv[i]);
        if (a == "--conformance" && i + 1 < argc) conformance = juce::File (argv[++i]);
        else if (a == "--interop-write" && i + 1 < argc) interopW = juce::File (argv[++i]);
        else if (a == "--interop-verify" && i + 1 < argc) interopV = juce::File (argv[++i]);
        else if (a == "--interop-handoff-write" && i + 2 < argc) { hoLib = juce::File (argv[i + 1]); hoEbys = juce::File (argv[i + 2]); i += 2; }
        else if (a == "--interop-handoff-verify" && i + 1 < argc) hoVerify = juce::File (argv[++i]);
    }
    if (hoLib != juce::File()) { interopHandoffWrite (hoLib, hoEbys); }
    else if (hoVerify != juce::File()) { interopHandoffVerify (hoVerify); }
    else if (interopW != juce::File()) { interopWrite (interopW); }
    else if (interopV != juce::File()) { interopVerify (interopV); }
    else
    {
        if (conformance == juce::File())
            conformance = juce::File (juce::File::getCurrentWorkingDirectory()).getChildFile ("../../core/conformance");
        std::cout << "ids\n";              testIds();
        std::cout << "json\n";             testJson();
        std::cout << "conformance\n";      testNotationConformance (conformance); testFilterConformance (conformance);
        std::cout << "library\n";          testLibrary();
        std::cout << "jobs\n";             testJobs();
        std::cout << "handoff\n";          testHandoff();
    }
    std::cout << (g_fail == 0 ? "core: all tests passed" : "core: FAILURES") << "  (" << g_checks << " checks, " << g_fail << " failed)\n";
    return g_fail == 0 ? 0 : 1;
}
