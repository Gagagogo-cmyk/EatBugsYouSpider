#include "Library.h"
#include "Handoff.h"
#include "Settings.h"
#include "Ids.h"
#include "JsonIo.h"
#include "Jobs.h"
#include "NotationProfile.h"
#include <algorithm>
#include <cmath>

namespace gnumbat
{
    using juce::String;
    using juce::var;

    namespace
    {
        constexpr const char* kBakeSchema = "gnumbat.bake/0.1";
        constexpr const char* kStateSchema = "gnumbat.bake_state/0.1";
        constexpr const char* kSemanticSchema = "gnumbat.semantic/0.1";
        constexpr const char* kLibrarySchema = "gnumbat.library/0.1";
        constexpr const char* kDatasetSchema = "gnumbat.dataset/0.1";

        var cloneVar (const var& v) { return v.clone(); }

        var stringsVar (const juce::StringArray& a) { return json::array (a); }

        void putLE32 (juce::MemoryOutputStream& m, juce::uint32 v) { m.writeInt ((int) v); }        // MemoryOutputStream::writeInt is little-endian
        void putLE16 (juce::MemoryOutputStream& m, juce::uint16 v) { m.writeShort ((short) v); }

        double roundTo (double v, double scale) { return std::round (v * scale) / scale; }
    }

    // ------------------------------------------------------------------------------------ WAV + peaks
    juce::Result writeFloatWav (const juce::File& target, const CapturedAudio& a)
    {
        const int ch = a.numChannels();
        const juce::int64 n = a.frames();
        if (ch < 1 || n < 1 || a.sampleRate < 8000.0) return juce::Result::fail ("empty or invalid audio");
        for (auto& c : a.channels) if ((juce::int64) c.size() != n) return juce::Result::fail ("channel length mismatch");

        const juce::uint64 dataBytes = (juce::uint64) n * (juce::uint64) ch * 4u;
        if (dataBytes > 0xFFFFFF00ull) return juce::Result::fail ("capture too long for a plain WAV (4 GB)");

        target.getParentDirectory().createDirectory();
        target.deleteFile();
        juce::FileOutputStream out (target);
        if (out.failedToOpen()) return juce::Result::fail ("cannot write " + target.getFullPathName());

        juce::MemoryOutputStream h;
        h.write ("RIFF", 4);  putLE32 (h, (juce::uint32) (4 + 8 + 16 + 8 + 4 + 8 + dataBytes));
        h.write ("WAVE", 4);
        h.write ("fmt ", 4);  putLE32 (h, 16);
        putLE16 (h, 3);                                        // IEEE float
        putLE16 (h, (juce::uint16) ch);
        putLE32 (h, (juce::uint32) std::llround (a.sampleRate));
        putLE32 (h, (juce::uint32) (std::llround (a.sampleRate) * ch * 4));
        putLE16 (h, (juce::uint16) (ch * 4));
        putLE16 (h, 32);
        h.write ("fact", 4);  putLE32 (h, 4);  putLE32 (h, (juce::uint32) n);
        h.write ("data", 4);  putLE32 (h, (juce::uint32) dataBytes);
        out.write (h.getData(), h.getDataSize());

        constexpr juce::int64 kChunk = 1 << 15;
        std::vector<float> buf ((size_t) (kChunk * ch));
        for (juce::int64 pos = 0; pos < n; pos += kChunk)
        {
            const auto m = (size_t) std::min (kChunk, n - pos);
            for (size_t i = 0; i < m; ++i)
                for (int c = 0; c < ch; ++c)
                {
                    const float s = a.channels[(size_t) c][(size_t) pos + i];
                    buf[i * (size_t) ch + (size_t) c] = std::isfinite (s) ? s : 0.0f;    // NaN/Inf never reach disk
                }
           #if JUCE_BIG_ENDIAN
            #error "WAV writer assumes a little-endian host"
           #endif
            if (! out.write (buf.data(), m * (size_t) ch * sizeof (float))) return juce::Result::fail ("disk full while writing " + target.getFileName());
        }
        out.flush();
        return juce::Result::ok();
    }

    // Deliberately lossy: mono mixdown, decimated to at most kPreviewMaxSampleRate, 16-bit PCM.
    // audio/original.wav (above) is what the worker actually analyses/decomposes and has to stay
    // untouched; a long capture there can run into the hundreds of MB, which is no problem for a
    // one-time background job but far too much to load just so the plugin's own play/stop button
    // can let someone recognise a Bake by ear. This is that: small enough to keep around per
    // Bake without a second thought, still "the whole thing", just not full quality.
    namespace
    {
        constexpr double kPreviewMaxSampleRate = 16000.0;
    }

    juce::Result writePreviewWav (const juce::File& target, const CapturedAudio& a)
    {
        const int ch = a.numChannels();
        const juce::int64 n = a.frames();
        if (ch < 1 || n < 1 || a.sampleRate < 8000.0) return juce::Result::fail ("empty or invalid audio");
        for (auto& c : a.channels) if ((juce::int64) c.size() != n) return juce::Result::fail ("channel length mismatch");

        // Block-average decimation: crude, but it's a recognise-it-by-ear preview, not a mix --
        // no resampling library needed, and averaging is at least a basic anti-alias.
        const int factor = juce::jmax (1, (int) std::floor (a.sampleRate / kPreviewMaxSampleRate));
        const double outRate = a.sampleRate / (double) factor;
        const juce::int64 outN = (n + factor - 1) / factor;
        if (outN < 1) return juce::Result::fail ("nothing to preview");

        std::vector<juce::int16> pcm ((size_t) outN);
        for (juce::int64 o = 0; o < outN; ++o)
        {
            const juce::int64 s0 = o * factor, s1 = juce::jmin (n, s0 + factor);
            double sum = 0.0;
            juce::int64 count = 0;
            for (juce::int64 i = s0; i < s1; ++i)
            {
                double m = 0.0;
                for (int c = 0; c < ch; ++c) m += a.channels[(size_t) c][(size_t) i];
                m /= (double) ch;
                if (std::isfinite (m)) { sum += m; ++count; }
            }
            const double avg = count > 0 ? sum / (double) count : 0.0;
            pcm[(size_t) o] = (juce::int16) juce::jlimit (-32768, 32767, juce::roundToInt (juce::jlimit (-1.0, 1.0, avg) * 32767.0));
        }

        const juce::uint64 dataBytes = (juce::uint64) outN * 2u;
        target.getParentDirectory().createDirectory();
        target.deleteFile();
        juce::FileOutputStream out (target);
        if (out.failedToOpen()) return juce::Result::fail ("cannot write " + target.getFullPathName());

        juce::MemoryOutputStream h;
        h.write ("RIFF", 4);  putLE32 (h, (juce::uint32) (4 + 8 + 16 + 8 + dataBytes));
        h.write ("WAVE", 4);
        h.write ("fmt ", 4);  putLE32 (h, 16);
        putLE16 (h, 1);                                        // PCM
        putLE16 (h, 1);                                        // mono
        putLE32 (h, (juce::uint32) std::llround (outRate));
        putLE32 (h, (juce::uint32) (std::llround (outRate) * 2));
        putLE16 (h, 2);
        putLE16 (h, 16);
        h.write ("data", 4);  putLE32 (h, (juce::uint32) dataBytes);
        out.write (h.getData(), h.getDataSize());

       #if JUCE_BIG_ENDIAN
        #error "WAV writer assumes a little-endian host"
       #endif
        if (! out.write (pcm.data(), (size_t) dataBytes)) return juce::Result::fail ("disk full while writing " + target.getFileName());
        out.flush();
        return juce::Result::ok();
    }

    var computePeaks (const CapturedAudio& a, int bins)
    {
        juce::Array<var> out;
        const juce::int64 n = a.frames();
        const int ch = a.numChannels();
        for (int b = 0; b < bins; ++b)
        {
            const juce::int64 s = n * b / bins;
            const juce::int64 e = std::max (n * (b + 1) / bins, s + 1);
            float lo = 0.0f, hi = 0.0f;
            bool first = true;
            for (juce::int64 i = s; i < e && i < n; ++i)
            {
                float m = 0.0f;
                for (int c = 0; c < ch; ++c) m += a.channels[(size_t) c][(size_t) i];
                m /= (float) ch;
                if (first) { lo = hi = m; first = false; }
                else { lo = std::min (lo, m); hi = std::max (hi, m); }
            }
            out.add (var (juce::Array<var> { roundTo (lo, 1e4), roundTo (hi, 1e4) }));
        }
        return var (out);
    }

    // ------------------------------------------------------------------------------------ CaptureMeta
    var CaptureMeta::toVar() const
    {
        auto o = json::emptyObject();
        auto* d = o.getDynamicObject();
        if (hostName.isNotEmpty())
        {
            auto host = json::object ({ { "name", hostName } });
            if (hostVersion.isNotEmpty()) host.getDynamicObject()->setProperty ("version", hostVersion);
            d->setProperty ("host", host);
        }
        if (pluginVersion.isNotEmpty()) d->setProperty ("plugin_version", pluginVersion);
        if (session.isNotEmpty())       d->setProperty ("session", session);
        if (trackName.isNotEmpty())     d->setProperty ("track_name", trackName);
        if (hasTimeline)
        {
            auto t = json::object ({ { "start_sample", (juce::int64) startSample }, { "end_sample", (juce::int64) endSample },
                                     { "sample_rate", timelineSampleRate } });
            if (hasPpq) { t.getDynamicObject()->setProperty ("start_ppq", startPpq); t.getDynamicObject()->setProperty ("end_ppq", endPpq); }
            d->setProperty ("timeline", t);
        }
        if (tempoBpm > 0.0) d->setProperty ("tempo_bpm", tempoBpm);
        if (timeSigNum > 0 && timeSigDen > 0) d->setProperty ("time_signature", var (juce::Array<var> { timeSigNum, timeSigDen }));
        d->setProperty ("coverage", juce::jlimit (0.0, 1.0, coverage));
        d->setProperty ("complete", complete);
        d->setProperty ("offline", offline);
        if (mode.isNotEmpty()) d->setProperty ("mode", mode);
        return o;
    }

    // ------------------------------------------------------------------------------------ Library basics
    bool Library::looksLikeLibrary (const juce::File& root) { return root.getChildFile ("library.json").existsAsFile(); }

    juce::Result Library::init (const juce::File& root)
    {
        if (! root.createDirectory()) return juce::Result::fail ("cannot create " + root.getFullPathName());
        const auto manifest = root.getChildFile ("library.json");
        if (! manifest.existsAsFile())
        {
            auto doc = json::object ({ { "schema", kLibrarySchema }, { "library_id", ids::ulid() }, { "created_at", json::utcNow() },
                                       { "gnumbat_version", kCoreVersion } });
            if (! json::atomicWriteJson (manifest, doc)) return juce::Result::fail ("cannot write library.json");
        }
        for (auto* d : { "bakes", "notation_profiles", "feature_sets", "datasets", "models", "derived", "jobs/pending", "jobs/running",
                         "jobs/done", "jobs/failed", "jobs/cancel", "tmp", ".trash" })
            root.getChildFile (d).createDirectory();

        for (auto& p : notation::builtinProfiles())
        {
            auto f = root.getChildFile ("notation_profiles").getChildFile (json::getString (p, "profile_id") + ".json");
            if (! f.existsAsFile()) json::atomicWriteJson (f, p);
        }
        return juce::Result::ok();      // feature_sets/ is populated by the worker on first start (it owns the extractor registry)
    }

    Library::Library (const juce::File& root) : rootDir (root) {}

    String Library::libraryId() const { return json::getString (json::readFile (rootDir.getChildFile ("library.json")), "library_id"); }

    juce::File Library::audioFile (const String& id) const
    {
        return bakeDir (id).getChildFile (json::getString (readBake (id), "audio/file", "audio/original.wav"));
    }

    juce::File Library::previewAudioFile (const String& id) const
    {
        const auto rel = json::getString (readBake (id), "preview/file");
        if (rel.isNotEmpty())
        {
            auto f = bakeDir (id).getChildFile (rel);
            if (f.existsAsFile()) return f;
        }
        return audioFile (id);   // a Bake saved before the preview existed: fall back to the original
    }

    juce::StringArray Library::listBakeIds() const
    {
        juce::StringArray out;
        for (auto& e : juce::RangedDirectoryIterator (bakesDir(), false, "*", juce::File::findDirectories))
        {
            const auto name = e.getFile().getFileName();
            if (ids::isId (name, "bk")) out.add (name);          // *.partial never matches
        }
        out.sort (false);
        return out;
    }

    // ------------------------------------------------------------------------------------ createBake
    juce::Result Library::createBake (const NewBake& nb, String& bakeIdOut, String* warningOut)
    {
        if (nb.audio.frames() < 1 || nb.audio.numChannels() < 1) return juce::Result::fail ("nothing to bake: the capture is empty");
        if (nb.audio.sampleRate < 8000.0) return juce::Result::fail ("invalid sample rate");

        const auto bakeId = ids::newId ("bk");
        const auto tmp = bakesDir().getChildFile (bakeId + ".partial");
        juce::File handoffFile;                                                   // rolled back if the Bake cannot be published
        const auto fail = [&] (const String& why) { tmp.deleteRecursively(); if (handoffFile != juce::File()) handoffFile.deleteFile(); return juce::Result::fail (why); };

        if (! tmp.getChildFile ("audio").createDirectory()) return fail ("cannot create " + tmp.getFullPathName());

        const auto wav = tmp.getChildFile ("audio/original.wav");
        if (auto r = writeFloatWav (wav, nb.audio); r.failed()) return fail (r.getErrorMessage());

        const auto previewWav = tmp.getChildFile ("audio/preview.wav");
        if (auto r = writePreviewWav (previewWav, nb.audio); r.failed()) return fail (r.getErrorMessage());

        const auto now = json::utcNow();
        const auto sr = (int) std::llround (nb.audio.sampleRate);

        auto manifest = json::object ({
            { "schema", kBakeSchema }, { "bake_id", bakeId }, { "created_at", now },
            // the real OS account that made this Bake -- distinct from nb.appName above (that's
            // the software, always "gnumbat-plugin"), useful once a library is shared or opened
            // on someone else's machine (see the README: a library is portable between machines).
            { "created_by", Settings::localIdentity() },
            { "origin", json::object ({ { "kind", nb.isImport ? "import" : "capture" },
                                        { "app", json::object ({ { "name", nb.appName }, { "version", kCoreVersion } }) } }) },
            { "audio", json::object ({ { "file", "audio/original.wav" }, { "sha256", json::sha256OfFile (wav) },
                                       { "sample_rate", sr }, { "channels", nb.audio.numChannels() },
                                       { "frames", (juce::int64) nb.audio.frames() },
                                       { "duration_s", roundTo ((double) nb.audio.frames() / nb.audio.sampleRate, 1e6) },
                                       { "sample_format", "float32" } }) },
            { "preview", json::object ({ { "peaks", computePeaks (nb.audio) }, { "file", "audio/preview.wav" } }) } });
        // Optional: also render into the instrument's raw_uploads/. A failure never loses the Bake; it is recorded in
        // bake.json ("handoff": {"status": "failed"}) and reported to the caller.
        String effectiveDecomposer = nb.decomposer;
        if (nb.submit && (nb.decomposer == "auto" || nb.decomposer == "instrument"))
        {
            if (nb.handoff.enabled)
            {
                handoff::Target target;
                String err;
                auto r = handoff::resolve (nb.handoff.ebysRoot, target);
                // Readable EBYS track name: the notation if any (older Bakes), else the tags, else the imported file's name.
                const auto track = handoff::trackName (nb.rawNotation.isNotEmpty() ? nb.rawNotation
                                                       : nb.extraTags.size() > 0 ? nb.extraTags.joinIntoString (" ")
                                                       : juce::File (nb.importOriginalName).getFileNameWithoutExtension(), bakeId);
                if (r.wasOk()) r = handoff::write (target, nb.audio, track, handoffFile);
                if (r.wasOk())
                {
                    manifest.getDynamicObject()->setProperty ("handoff", handoff::writtenManifest (target, track, handoffFile));
                    effectiveDecomposer = "handoff";
                }
                else
                {
                    err = r.getErrorMessage();
                    manifest.getDynamicObject()->setProperty ("handoff", handoff::failedManifest (err));
                    effectiveDecomposer = "auto";
                    if (warningOut != nullptr) *warningOut = "not sent to the instrument: " + err;
                }
            }
            else if (nb.decomposer == "instrument")
            {
                effectiveDecomposer = "auto";
                if (warningOut != nullptr) *warningOut = "not sent to the instrument: no EBYS folder is linked";
            }
        }

        if (nb.modelId.isNotEmpty())
            manifest.getDynamicObject()->setProperty ("model_id", nb.modelId);   // which Model's lineage this Bake was made for
        if (! nb.isImport)
            manifest.getDynamicObject()->setProperty ("capture", nb.capture.toVar());
        else
            manifest.getDynamicObject()->setProperty ("import", json::object ({ { "original_name", nb.importOriginalName },
                                                                                { "source_path", nb.importSourcePath } }));

        // Semantic layer: raw notation verbatim; tags/fields derived only through the (opt-in) profile.
        const var profile = nb.profile.getDynamicObject() != nullptr ? nb.profile : notation::freeformProfile();
        auto parsed = notation::parse (nb.rawNotation, profile);
        auto tags = parsed.tags;
        for (auto& t : nb.extraTags) if (t.isNotEmpty() && ! tags.contains (t, true)) tags.add (t);

        auto fields = cloneVar (parsed.fields);
        auto origin = json::emptyObject();
        for (auto& k : parsed.fieldOrder) origin.getDynamicObject()->setProperty (k, "parsed");
        if (auto* extra = nb.extraFields.getDynamicObject())
            for (auto& nv : extra->getProperties())
            {
                fields.getDynamicObject()->setProperty (nv.name, nv.value);
                origin.getDynamicObject()->setProperty (nv.name, "user");
            }

        auto semantic = json::object ({
            { "schema", kSemanticSchema }, { "bake_id", bakeId }, { "rev", 1 }, { "raw_notation", nb.rawNotation },
            { "notation_profile", json::object ({ { "id", json::getString (profile, "profile_id", "np_freeform") },
                                                  { "version", (int) json::getNumber (profile, "version", 1) } }) },
            { "tags", stringsVar (tags) }, { "fields", fields }, { "field_origin", origin }, { "groups", stringsVar (nb.groups) },
            { "prompt", var() }, { "ratings", json::emptyObject() }, { "notes", "" }, { "updated_at", now }, { "updated_by", nb.appName } });

        auto state = json::object ({
            { "schema", kStateSchema }, { "bake_id", bakeId }, { "state", "CAPTURED" }, { "rev", 1 }, { "updated_at", now },
            { "current", json::object ({ { "decomposition_id", var() }, { "analysis_id", var() } }) },
            { "history", var (juce::Array<var> { json::object ({ { "state", "CAPTURED" }, { "at", now } }) }) },
            { "error", var() }, { "progress", var() }, { "card", json::emptyObject() },
            { "stale", json::object ({ { "analysis", false } }) } });

        if (! json::atomicWriteJson (tmp.getChildFile ("bake.json"), manifest)
            || ! json::atomicWriteJson (tmp.getChildFile ("semantic.json"), semantic)
            || ! json::atomicWriteJson (tmp.getChildFile ("state.json"), state))
            return fail ("cannot write Bake metadata");

        const auto finalDir = bakeDir (bakeId);
        if (! tmp.moveFileTo (finalDir)) return fail ("cannot publish Bake directory");       // directory rename: the Bake appears atomically

        bakeIdOut = bakeId;

        if (nb.submit)
        {
            auto params = nb.processParams.getDynamicObject() != nullptr ? cloneVar (nb.processParams) : json::emptyObject();
            params.getDynamicObject()->setProperty ("bake_id", bakeId);
            if (! params.hasProperty ("decompose")) params.getDynamicObject()->setProperty ("decompose", effectiveDecomposer);
            if (JobSubmitter (rootDir).submit ("process_bake", params).isEmpty())
                return juce::Result::fail ("Bake " + bakeId + " saved, but the processing job could not be queued");
        }
        return juce::Result::ok();
    }

    // ------------------------------------------------------------------------------------ reads
    var Library::readBake (const String& id) const     { return json::readFile (bakeDir (id).getChildFile ("bake.json")); }
    var Library::readState (const String& id) const    { return json::readFile (bakeDir (id).getChildFile ("state.json")); }
    var Library::readSemantic (const String& id) const { return json::readFile (bakeDir (id).getChildFile ("semantic.json")); }

    var Library::readAnalysis (const String& id) const
    {
        const auto aid = json::getString (readState (id), "current/analysis_id");
        return aid.isEmpty() ? var() : json::readFile (bakeDir (id).getChildFile ("analyses/" + aid + "/analysis.json"));
    }

    var Library::readDecomposition (const String& id) const
    {
        const auto did = json::getString (readState (id), "current/decomposition_id");
        return did.isEmpty() ? var() : json::readFile (bakeDir (id).getChildFile ("decompositions/" + did + "/decomposition.json"));
    }

    juce::StringPairArray Library::stemFiles (const String& id) const
    {
        juce::StringPairArray out;
        const auto dec = readDecomposition (id);
        const auto did = json::getString (dec, "decomposition_id");
        if (auto* stems = dec.getProperty ("stems", {}).getArray())
            for (auto& s : *stems)
                out.set (json::getString (s, "name"), bakeDir (id).getChildFile ("decompositions/" + did + "/" + json::getString (s, "file")).getFullPathName());
        return out;
    }

    var Library::associations() const
    {
        return json::get (json::readFile (derivedDir().getChildFile ("associations.json")), "bakes");
    }

    namespace
    {
        var analysisView (const var& a)
        {
            const auto* sources = a.getProperty ("sources", {}).getArray();
            if (sources == nullptr || sources->isEmpty()) return json::emptyObject();
            var mix = (*sources)[0];
            for (auto& s : *sources) if (json::getString (s, "name") == "mix") { mix = s; break; }

            auto summary = json::emptyObject();
            if (auto* fs = mix.getProperty ("summary", {}).getDynamicObject())
                for (auto& nv : fs->getProperties())
                {
                    auto* dims = nv.value.getProperty ("dims", {}).getArray();
                    if (dims == nullptr) continue;
                    for (int k = 0; k < dims->size(); ++k)
                    {
                        const String key = dims->size() == 1 ? nv.name.toString() : nv.name.toString() + "#" + String (k);
                        auto stat = json::emptyObject();
                        for (auto* s : { "mean", "std", "min", "max", "slope" })
                            if (json::has ((*dims)[k], s)) stat.getDynamicObject()->setProperty (s, json::get ((*dims)[k], s));
                        summary.getDynamicObject()->setProperty (key, stat);
                    }
                }
            if (auto* sc = mix.getProperty ("scalars", {}).getDynamicObject())
                for (auto& nv : sc->getProperties())
                    summary.getDynamicObject()->setProperty (nv.name, json::object ({ { "mean", nv.value } }));

            const auto sug = a.getProperty ("suggestions", {});
            auto mixSummary = json::object ({ { "mix", summary } });
            return json::object ({ { "analysis_id", json::getString (a, "analysis_id") }, { "extractor", json::getString (a, "extractor/name") },
                                   { "n_slices", mix.getProperty ("slices", {}).getArray() != nullptr ? mix.getProperty ("slices", {}).getArray()->size() : 0 },
                                   { "tempo_bpm", json::get (sug, "tempo_bpm") }, { "key", json::get (sug, "key") }, { "summary", mixSummary } });
        }
    }

    var Library::bakeView (const String& id, const var& assoc) const
    {
        const auto bake = readBake (id), st = readState (id), sem = readSemantic (id);
        if (bake.getDynamicObject() == nullptr || st.getDynamicObject() == nullptr || sem.getDynamicObject() == nullptr) return {};

        auto view = json::object ({
            { "id", id }, { "notation", json::getString (sem, "raw_notation") }, { "tags", json::get (sem, "tags") },
            { "fields", json::get (sem, "fields") }, { "groups", json::get (sem, "groups") }, { "ratings", json::get (sem, "ratings") },
            { "state", json::getString (st, "state") }, { "created_at", json::getString (bake, "created_at") },
            { "creator", json::getString (bake, "created_by") }, { "updated_at", json::getString (sem, "updated_at") },
            { "duration_s", json::getNumber (bake, "audio/duration_s") }, { "origin", json::getString (bake, "origin/kind") },
            { "capture", json::has (bake, "capture") ? json::get (bake, "capture") : json::emptyObject() },
            { "stems", var (juce::Array<var>()) }, { "analysis", json::emptyObject() }, { "rev", json::getNumber (sem, "rev") },
            { "model_id", json::getString (bake, "model_id") } });
        auto* v = view.getDynamicObject();
        bool adopted = false;

        if (json::getString (st, "current/decomposition_id").isNotEmpty())
        {
            juce::Array<var> names;
            const auto dec = readDecomposition (id);                       // keep the owning var alive while we iterate
            if (auto* stems = dec.getProperty ("stems", {}).getArray())
                for (auto& s : *stems) names.add (json::get (s, "name"));
            v->setProperty ("stems", var (names));
            adopted = json::getString (dec, "method/backend") == "instrument";
        }
        if (json::has (bake, "handoff"))
            v->setProperty ("handoff", json::getString (bake, "handoff/status") != "written" ? String ("failed") : adopted ? String ("adopted") : String ("waiting"));
        // The instrument pipeline's own progress for this Bake's track (written by
        // src/demucs/watch_demucs.py next to the session: <session>/pipeline/<track>.json):
        // "pipeline" = its stages object {demucs, essentia, madmom, flucoma} -> {status, percent, msg};
        // "pipeline_active" = some stage is still waiting or running.
        if (json::getString (bake, "handoff/status") == "written")
        {
            const juce::File handed (json::getString (bake, "handoff/file"));
            const auto pf = handed.getParentDirectory().getParentDirectory()     // raw_uploads/ -> <session>/
                                  .getChildFile ("pipeline").getChildFile (json::getString (bake, "handoff/track") + ".json");
            bool active = true;                                                  // not started yet counts as active
            if (pf.existsAsFile())
            {
                bool ok = false;
                const auto doc = json::readFile (pf, &ok);
                if (ok && json::has (doc, "stages"))
                {
                    const auto stages = json::get (doc, "stages");
                    v->setProperty ("pipeline", stages);
                    active = false;
                    for (auto* st : { "demucs", "essentia", "madmom", "flucoma" })
                    {
                        const auto status = json::getString (stages, String (st) + "/status");
                        if (status.isEmpty() || status == "waiting" || status == "running") active = true;
                    }
                }
            }
            v->setProperty ("pipeline_active", active);
        }
        if (json::getString (st, "current/analysis_id").isNotEmpty())
        {
            auto a = readAnalysis (id);
            if (a.getDynamicObject() != nullptr) v->setProperty ("analysis", analysisView (a));
        }
        if (json::getString (st, "state") == "DECOMPOSING" || json::getString (st, "state") == "ANALYZING")
            v->setProperty ("progress", json::getNumber (st, "progress/fraction"));
        if (json::getString (st, "state") == "ERROR")
            v->setProperty ("error", json::getString (st, "error/code") + ": " + json::getString (st, "error/message"));
        const auto a = json::get (assoc, id);
        v->setProperty ("models", json::has (a, "models") ? json::get (a, "models") : var (juce::Array<var>()));
        v->setProperty ("datasets", json::has (a, "datasets") ? json::get (a, "datasets") : var (juce::Array<var>()));
        v->setProperty ("training", json::has (a, "training") ? json::get (a, "training") : json::emptyObject());
        return view;
    }

    // ------------------------------------------------------------------------------------ semantic edits
    juce::Result Library::updateSemantic (const String& id, const SemanticEdit& e, int expectedRev, var* newDoc)
    {
        const auto path = bakeDir (id).getChildFile ("semantic.json");
        bool ok = false;
        const auto cur = json::readFile (path, &ok);
        if (! ok) return juce::Result::fail ("no such Bake: " + id);
        const int curRev = (int) json::getNumber (cur, "rev");
        if (expectedRev >= 0 && curRev != expectedRev)
            return juce::Result::fail ("CONFLICT: semantic is at rev " + String (curRev) + ", you edited rev " + String (expectedRev) + " — reload and retry");

        auto next = cur.clone();
        auto* d = next.getDynamicObject();
        auto tags = json::getStrings (cur, "tags");
        auto groups = json::getStrings (cur, "groups");
        auto spectralTags = json::getStrings (cur, "spectral_tags");
        auto morphologyTags = json::getStrings (cur, "morphology_tags");
        auto fields = json::has (cur, "fields") ? json::get (cur, "fields").clone() : json::emptyObject();
        auto origin = json::has (cur, "field_origin") ? json::get (cur, "field_origin").clone() : json::emptyObject();

        String raw = json::getString (cur, "raw_notation");
        if (e.setRawNotation) { raw = e.rawNotation; d->setProperty ("raw_notation", raw); }

        if (e.reparse)
        {
            var profile = e.profile.getDynamicObject() != nullptr ? e.profile : getProfile (json::getString (cur, "notation_profile/id"));
            if (profile.getDynamicObject() == nullptr) profile = notation::freeformProfile();
            d->setProperty ("notation_profile", json::object ({ { "id", json::getString (profile, "profile_id") }, { "version", (int) json::getNumber (profile, "version", 1) } }));
            auto parsed = notation::parse (raw, profile);
            tags = parsed.tags;
            // drop previously *parsed* fields, keep user/suggested ones, then apply the fresh parse
            if (auto* fo = origin.getDynamicObject())
                for (auto& nv : juce::NamedValueSet (fo->getProperties()))
                    if (nv.value.toString() == "parsed") { fields.getDynamicObject()->removeProperty (nv.name); fo->removeProperty (nv.name); }
            for (auto& k : parsed.fieldOrder)
            {
                fields.getDynamicObject()->setProperty (k, parsed.fields.getProperty (k, {}));
                origin.getDynamicObject()->setProperty (k, "parsed");
            }
        }

        if (e.setTags) { tags.clear(); for (auto& t : e.tags) if (t.isNotEmpty() && ! tags.contains (t, true)) tags.add (t); }
        for (auto& t : e.addTags) if (t.isNotEmpty() && ! tags.contains (t, true)) tags.add (t);
        for (auto& t : e.removeTags) { for (int i = tags.size(); --i >= 0;) if (tags[i].equalsIgnoreCase (t)) tags.remove (i); }

        if (auto* sf = e.setFields.getDynamicObject())
            for (auto& nv : sf->getProperties())
            {
                fields.getDynamicObject()->setProperty (nv.name, nv.value);
                origin.getDynamicObject()->setProperty (nv.name, "user");
            }
        for (auto& k : e.removeFields) { fields.getDynamicObject()->removeProperty (k); origin.getDynamicObject()->removeProperty (k); }

        for (auto& g : e.addGroups) if (g.isNotEmpty() && ! groups.contains (g)) groups.add (g);
        for (auto& g : e.removeGroups) groups.removeString (g);
        // Same add/remove shape as tags itself -- two separate free-text arrays, never a fixed
        // enum, so a spectral or morphological "tag" is exactly as free as an ordinary one.
        for (auto& t : e.addSpectralTags) if (t.isNotEmpty() && ! spectralTags.contains (t, true)) spectralTags.add (t);
        for (auto& t : e.removeSpectralTags) { for (int i = spectralTags.size(); --i >= 0;) if (spectralTags[i].equalsIgnoreCase (t)) spectralTags.remove (i); }
        for (auto& t : e.addMorphologyTags) if (t.isNotEmpty() && ! morphologyTags.contains (t, true)) morphologyTags.add (t);
        for (auto& t : e.removeMorphologyTags) { for (int i = morphologyTags.size(); --i >= 0;) if (morphologyTags[i].equalsIgnoreCase (t)) morphologyTags.remove (i); }
        if (e.setNotes) d->setProperty ("notes", e.notes);

        d->setProperty ("tags", stringsVar (tags));
        d->setProperty ("groups", stringsVar (groups));
        d->setProperty ("spectral_tags", stringsVar (spectralTags));
        d->setProperty ("morphology_tags", stringsVar (morphologyTags));
        d->setProperty ("fields", fields);
        d->setProperty ("field_origin", origin);
        d->setProperty ("rev", curRev + 1);
        d->setProperty ("updated_at", json::utcNow());
        d->setProperty ("updated_by", e.updatedBy);

        // narrow the read-modify-write window: if someone else wrote meanwhile, do not clobber them
        if ((int) json::getNumber (json::readFile (path), "rev") != curRev)
            return juce::Result::fail ("CONFLICT: semantic changed concurrently — reload and retry");

        json::appendLine (bakeDir (id).getChildFile ("semantic.history.jsonl"), cur);
        if (! json::atomicWriteJson (path, next)) return juce::Result::fail ("cannot write semantic.json");
        if (newDoc != nullptr) *newDoc = next;
        return juce::Result::ok();
    }

    // ------------------------------------------------------------------------------------ trash
    juce::Result Library::trashBake (const String& id, juce::File* trashedTo)
    {
        const auto src = bakeDir (id);
        if (! src.isDirectory()) return juce::Result::fail ("no such Bake");
        const auto dst = rootDir.getChildFile (".trash").getChildFile (id + "__" + String (juce::Time::currentTimeMillis() / 1000));
        dst.getParentDirectory().createDirectory();
        if (! src.moveFileTo (dst)) return juce::Result::fail ("cannot move " + id + " to .trash");
        if (trashedTo != nullptr) *trashedTo = dst;
        return juce::Result::ok();
    }

    juce::Result Library::restoreBake (const juce::File& trashed, String* idOut)
    {
        const auto id = trashed.getFileName().upToFirstOccurrenceOf ("__", false, false);
        if (! ids::isId (id, "bk")) return juce::Result::fail ("not a trashed Bake");
        if (bakeDir (id).exists()) return juce::Result::fail ("a Bake with this id already exists");
        if (! trashed.moveFileTo (bakeDir (id))) return juce::Result::fail ("cannot restore");
        if (idOut != nullptr) *idOut = id;
        return juce::Result::ok();
    }

    std::map<String, juce::StringArray> Library::bakesPinnedByDatasetVersions() const
    {
        std::map<String, juce::StringArray> pinned;
        for (auto& e : juce::RangedDirectoryIterator (rootDir.getChildFile ("datasets"), true, "dataset_version.json", juce::File::findFiles))
        {
            const auto dv = json::readFile (e.getFile());
            const auto dvId = json::getString (dv, "dataset_version_id");
            if (auto* items = dv.getProperty ("items", {}).getArray())
                for (auto& it : *items) pinned[json::getString (it, "bake_id")].add (dvId);
        }
        return pinned;
    }

    // ------------------------------------------------------------------------------------ profiles / feature sets
    juce::Array<var> Library::listProfiles() const
    {
        juce::Array<var> out;
        juce::StringArray seen;
        for (auto& e : juce::RangedDirectoryIterator (rootDir.getChildFile ("notation_profiles"), false, "np_*.json", juce::File::findFiles))
        {
            auto p = json::readFile (e.getFile());
            const auto pid = json::getString (p, "profile_id");
            if (pid.isNotEmpty() && ! seen.contains (pid)) { seen.add (pid); out.add (p); }
        }
        for (auto& p : notation::builtinProfiles())
            if (! seen.contains (json::getString (p, "profile_id"))) out.add (p);
        std::stable_sort (out.begin(), out.end(), [] (const var& a, const var& b)
        {
            const bool af = json::getString (a, "profile_id") == "np_freeform", bf = json::getString (b, "profile_id") == "np_freeform";
            return af != bf ? af : json::getString (a, "name") < json::getString (b, "name");
        });
        return out;
    }

    var Library::getProfile (const String& id) const
    {
        if (id.isEmpty()) return notation::freeformProfile();
        const auto f = rootDir.getChildFile ("notation_profiles").getChildFile (id + ".json");
        if (f.existsAsFile()) return json::readFile (f);
        return notation::builtinProfile (id);
    }

    juce::Result Library::saveProfile (const var& profile)
    {
        if (auto err = notation::validateProfile (profile); err.isNotEmpty()) return juce::Result::fail (err);
        const auto pid = json::getString (profile, "profile_id");
        if (! json::atomicWriteJson (rootDir.getChildFile ("notation_profiles").getChildFile (pid + ".json"), profile))
            return juce::Result::fail ("cannot write profile");
        return juce::Result::ok();
    }

    juce::Array<Library::FeatureSetInfo> Library::listFeatureSets() const
    {
        juce::Array<FeatureSetInfo> out;
        for (auto& e : juce::RangedDirectoryIterator (rootDir.getChildFile ("feature_sets"), false, "*.json", juce::File::findFiles))
        {
            const auto fs = json::readFile (e.getFile());
            const auto fid = json::getString (fs, "feature_set_id");
            if (fid.isNotEmpty()) out.add ({ fid, json::getString (fs, "name", fid), json::getString (fs, "description") });
        }
        std::sort (out.begin(), out.end(), [] (const FeatureSetInfo& a, const FeatureSetInfo& b) { return a.name < b.name; });
        return out;
    }

    // ------------------------------------------------------------------------------------ datasets
    juce::Array<Library::DatasetInfo> Library::listDatasets() const
    {
        juce::Array<DatasetInfo> out;
        for (auto& e : juce::RangedDirectoryIterator (rootDir.getChildFile ("datasets"), false, "ds_*", juce::File::findDirectories))
        {
            const auto ds = json::readFile (e.getFile().getChildFile ("dataset.json"));
            if (ds.getDynamicObject() == nullptr) continue;
            DatasetInfo info;
            info.id = json::getString (ds, "dataset_id");
            info.name = json::getString (ds, "name");
            if (auto* a = json::get (ds, "membership/bake_ids").getArray()) info.members = a->size();
            info.hasFilter = json::get (ds, "membership/filter").getDynamicObject() != nullptr;
            out.add (info);
        }
        std::sort (out.begin(), out.end(), [] (const DatasetInfo& a, const DatasetInfo& b) { return a.name.compareIgnoreCase (b.name) < 0; });
        return out;
    }

    juce::Result Library::createDataset (const String& name, const juce::StringArray& bakeIds, String& idOut)
    {
        if (name.trim().isEmpty()) return juce::Result::fail ("a dataset needs a name");
        auto sorted = bakeIds; sorted.removeDuplicates (false); sorted.sort (false);
        const auto id = ids::newId ("ds");
        const auto now = json::utcNow();
        auto doc = json::object ({ { "schema", kDatasetSchema }, { "dataset_id", id }, { "name", name.trim() }, { "description", "" },
                                   { "created_at", now }, { "modified_at", now },
                                   { "membership", json::object ({ { "bake_ids", stringsVar (sorted) }, { "filter", var() } }) } });
        if (! json::atomicWriteJson (rootDir.getChildFile ("datasets/" + id + "/dataset.json"), doc)) return juce::Result::fail ("cannot write dataset");
        idOut = id;
        return juce::Result::ok();
    }

    static juce::Result editDataset (const juce::File& root, const String& dsId, const juce::StringArray& ids_, bool add)
    {
        const auto f = root.getChildFile ("datasets/" + dsId + "/dataset.json");
        bool ok = false;
        auto ds = json::readFile (f, &ok);
        if (! ok) return juce::Result::fail ("no such dataset");
        auto members = json::getStrings (ds, "membership/bake_ids");
        if (add) members.addArray (ids_);
        else for (auto& b : ids_) members.removeString (b);
        members.removeDuplicates (false);
        members.sort (false);
        auto next = ds.clone();
        auto mem = json::get (next, "membership");
        mem.getDynamicObject()->setProperty ("bake_ids", json::array (members));
        next.getDynamicObject()->setProperty ("modified_at", json::utcNow());
        return json::atomicWriteJson (f, next) ? juce::Result::ok() : juce::Result::fail ("cannot write dataset");
    }

    juce::Result Library::addToDataset (const String& dsId, const juce::StringArray& bakeIds)      { return editDataset (rootDir, dsId, bakeIds, true); }
    juce::Result Library::removeFromDataset (const String& dsId, const juce::StringArray& bakeIds) { return editDataset (rootDir, dsId, bakeIds, false); }
}
