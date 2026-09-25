// Plugin-level tests (no DAW needed):
//   * processor: transparent pass-through, transport tracking, capture by timeline / last-N / loop, coverage, state
//   * UI: editor construction, bank filtering/sorting/selection, map geometry, Bake flow through the real dialog
//   * --snapshot <dir>: renders PNGs of the terminal UI
//   * --interop-write <lib> / --interop-verify <lib>: Bakes created through the plugin path, processed by the Python worker
#include <juce_audio_utils/juce_audio_utils.h>
#include "../plugin/PluginProcessor.h"
#include "../plugin/PluginEditor.h"
#include "../plugin/ui/NotationCard.h"
#include "../core/JsonIo.h"
#include "../core/Ids.h"
#include "../core/MapData.h"
#include "../core/NotationProfile.h"
#include "../core/ModelTree.h"
#include "../core/Settings.h"
#include <cstdlib>
#include <iostream>

using namespace gnumbat;
using juce::String;
using juce::var;

static void setEnv (const char* k, const String& v)
{
   #if JUCE_WINDOWS
    _putenv_s (k, v.toRawUTF8());
   #else
    ::setenv (k, v.toRawUTF8(), 1);
   #endif
}

static int g_checks = 0, g_fail = 0;
#define CHECK(cond) do { ++g_checks; if (! (cond)) { ++g_fail; std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " << #cond << "\n"; } } while (0)
#define CHECK_MSG(cond, msg) do { ++g_checks; if (! (cond)) { ++g_fail; std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " << #cond << "  -- " << String (msg).toRawUTF8() << "\n"; } } while (0)

// ---------------------------------------------------------------------------------------------------- fake host
struct FakeHost : juce::AudioPlayHead
{
    bool present = true, playing = true, looping = false, hasLoop = false;
    double bpm = 120.0, ppqAt0 = 0.0;
    int num = 4, den = 4;
    juce::int64 timeSamples = 0;
    double sampleRate = 48000.0;
    double loopStart = 0.0, loopEnd = 0.0;
    double ppqBpm = 0.0;   // > 0: ppq advances at this tempo while the host REPORTS `bpm` (a host whose numbers disagree)

    juce::Optional<PositionInfo> getPosition() const override
    {
        if (! present) return {};
        PositionInfo p;
        p.setIsPlaying (playing);
        p.setIsRecording (false);
        p.setIsLooping (looping);
        p.setBpm (bpm);
        p.setTimeSignature (TimeSignature { num, den });
        p.setTimeInSamples (timeSamples);
        p.setPpqPosition (ppqAt0 + (double) timeSamples / sampleRate * (ppqBpm > 0.0 ? ppqBpm : bpm) / 60.0);
        if (hasLoop) p.setLoopPoints (LoopPoints { loopStart, loopEnd });
        return p;
    }
};

// Sample value is a pure function of (channel, timeline position): whatever order audio arrives in, a captured
// range can be verified sample-exactly against it.
static float valueAt (int ch, juce::int64 t) { return (float) ((t * 7 + ch * 13) % 20011) / 20011.0f - 0.5f; }

static void run (GnumbatProcessor& p, FakeHost* host, juce::int64 from, juce::int64 count, int block = 512, int channels = 2,
                 std::vector<std::vector<float>>* outCopy = nullptr)
{
    juce::AudioBuffer<float> buf (channels, block);
    juce::MidiBuffer midi;
    for (juce::int64 pos = 0; pos < count; pos += block)
    {
        const int n = (int) std::min<juce::int64> (block, count - pos);
        buf.setSize (channels, n, false, false, true);
        if (host != nullptr) host->timeSamples = from + pos;
        for (int c = 0; c < channels; ++c)
            for (int i = 0; i < n; ++i) buf.setSample (c, i, valueAt (c, from + pos + i));
        p.processBlock (buf, midi);
        if (outCopy != nullptr)
            for (int c = 0; c < channels; ++c)
                for (int i = 0; i < n; ++i) (*outCopy)[(size_t) c].push_back (buf.getSample (c, i));
    }
}

static bool matchesRange (const PreparedCapture& pc, juce::int64 start)
{
    if (pc.bake.audio.channels.empty()) return false;
    for (size_t c = 0; c < pc.bake.audio.channels.size(); ++c)
        for (size_t i = 0; i < pc.bake.audio.channels[c].size(); i += 37)
            if (pc.bake.audio.channels[c][i] != valueAt ((int) c, start + (juce::int64) i)) return false;
    return true;
}

static juce::File tempDir (const String& n)
{
    auto d = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("gnumbat_pt_" + n + "_" + String::toHexString (juce::Random::getSystemRandom().nextInt()));
    d.createDirectory();
    return d;
}

// ---------------------------------------------------------------------------------------------------- processor
static void testProcessor()
{
    GnumbatProcessor p;
    FakeHost host;
    p.setPlayHead (&host);
    p.setRateAndBufferSizeDetails (48000.0, 512);
    p.prepareToPlay (48000.0, 512);

    CHECK (! p.transport().valid);
    CHECK (! p.prepareCapture (p.plan).ok);                       // nothing has flowed yet: a clear message, not a crash
    CHECK (p.prepareCapture (p.plan).problem.isNotEmpty());

    // ---- transparent pass-through, bit-exact
    std::vector<std::vector<float>> out (2);
    run (p, &host, 0, 48000 * 10, 512, 2, &out);                  // 10 s at 120 bpm 4/4 = 5 bars
    bool exact = out[0].size() == 480000;
    for (size_t i = 0; exact && i < out[0].size(); ++i) exact = out[0][i] == valueAt (0, (juce::int64) i) && out[1][i] == valueAt (1, (juce::int64) i);
    CHECK (exact);

    // ---- transport mailbox
    auto t = p.transport();
    CHECK (t.valid && t.hostTimeline && t.playing);
    CHECK (std::abs (t.bpm - 120.0) < 1e-9 && t.tsNum == 4 && t.tsDen == 4);
    CHECK (t.samples == 480000);                                  // "now" = end of the last block
    CHECK (std::abs (t.ppq - 20.0) < 1e-6);                       // 10 s * 2 beats/s
    CHECK (t.written == 480000);

    // ---- last N bars: 2 bars * 4 beats * 0.5 s = 4 s
    p.plan.mode = CapturePlan::Mode::lastBars;
    p.plan.bars = 2.0;
    auto pc = p.prepareCapture (p.plan);
    CHECK_MSG (pc.ok, pc.problem);
    CHECK (pc.bake.audio.frames() == 4 * 48000 && pc.bake.audio.numChannels() == 2);
    CHECK (std::abs (pc.coverage - 1.0) < 1e-9 && pc.bake.capture.complete);
    CHECK (matchesRange (pc, 480000 - 4 * 48000));
    CHECK (pc.bake.capture.hasTimeline && pc.bake.capture.startSample == 480000 - 4 * 48000 && pc.bake.capture.endSample == 480000);
    CHECK (pc.bake.capture.tempoBpm == 120.0 && pc.bake.capture.timeSigNum == 4 && pc.bake.capture.mode == "last_bars");
    CHECK (pc.bake.capture.hostName.isNotEmpty() && pc.bake.capture.session.isNotEmpty());

    // ---- range by timeline
    p.plan.mode = CapturePlan::Mode::range;
    p.plan.in = { 96000, 4.0, true };
    p.plan.out = { 192000, 8.0, true };
    pc = p.prepareCapture (p.plan);
    CHECK_MSG (pc.ok, pc.problem);
    CHECK (pc.bake.audio.frames() == 96000 && matchesRange (pc, 96000));
    CHECK (pc.bake.capture.startSample == 96000 && pc.bake.capture.hasPpq && std::abs (pc.bake.capture.startPpq - 4.0) < 1e-9);
    CHECK (std::abs (p.coverageOf (p.plan.in, p.plan.out) - 1.0) < 1e-9);

    // ---- range never played: partial / none, clearly reported
    p.plan.in = { 480000, 20.0, true };  p.plan.out = { 480000 + 96000, 24.0, true };
    pc = p.prepareCapture (p.plan);
    CHECK (! pc.ok && pc.problem.contains ("None of that range"));
    run (p, &host, 480000, 48000, 512);                                       // play only the first second of that range
    pc = p.prepareCapture (p.plan);
    CHECK_MSG (pc.ok, pc.problem);
    CHECK (std::abs (pc.coverage - 0.5) < 0.01 && ! pc.bake.capture.complete);
    CHECK (std::abs (p.coverageOf (p.plan.in, p.plan.out) - 0.5) < 0.01);
    CHECK (pc.summary.contains ("50 %"));

    // ---- "heard" reflects where the cursor actually played, not a monotonic fill: jump away and
    // play a second, disjoint slice of the same range; the gap between the two must stay unheard.
    {
        auto fr = p.coveredFractionsOf (p.plan.in, p.plan.out);
        CHECK (fr.size() == 1);
        CHECK (std::abs (fr[0].first - 0.0) < 0.01 && std::abs (fr[0].second - 0.5) < 0.01);
    }
    run (p, &host, 552000, 24000, 512);                                       // jump the cursor; play only the range's last half-second
    pc = p.prepareCapture (p.plan);
    CHECK_MSG (pc.ok, pc.problem);
    CHECK (std::abs (pc.coverage - 0.75) < 0.01 && ! pc.bake.capture.complete);
    CHECK (std::abs (p.coverageOf (p.plan.in, p.plan.out) - 0.75) < 0.01);
    {
        auto fr = p.coveredFractionsOf (p.plan.in, p.plan.out);
        CHECK_MSG (fr.size() == 2, "expected two disjoint heard zones, got " + String ((int) fr.size()));
        if (fr.size() == 2)
        {
            CHECK (std::abs (fr[0].first - 0.0) < 0.01 && std::abs (fr[0].second - 0.5) < 0.01);    // first second: heard
            CHECK (std::abs (fr[1].first - 0.75) < 0.01 && std::abs (fr[1].second - 1.0) < 0.01);   // last half-second: heard
        }                                                                                           // the 0.5-0.75 gap: correctly NOT reported
    }

    // ---- inverted / unset markers
    p.plan.in = { 200000, 0, false };  p.plan.out = { 100000, 0, false };
    CHECK (! p.prepareCapture (p.plan).ok);
    p.plan.in = {}; p.plan.out = {};
    CHECK (! p.prepareCapture (p.plan).ok);

    // ---- loop: the host wraps back to bar 2 three times; the newest pass wins and a range spanning passes is complete
    {
        GnumbatProcessor q;  FakeHost h;  q.setPlayHead (&h);
        q.setRateAndBufferSizeDetails (48000.0, 512);  q.prepareToPlay (48000.0, 512);
        // The loop is selected FIRST, then played -- matching real usage (a Bake is always the
        // host's *current* loop; nothing plays before one is selected) and the "selecting a
        // region restarts heard-tracking from scratch" behaviour (see GnumbatProcessor::loopMarkers()):
        // listening that happened before this loop existed must not count toward it.
        h.hasLoop = true; h.looping = true; h.loopStart = 2.0; h.loopEnd = 6.0;      // ppq 2..6 = 1 s..3 s at 120 bpm = samples 48000..144000
        for (int pass = 0; pass < 3; ++pass) run (q, &h, 48000, 96000, 512);         // loop = samples 48000..144000, played three times over
        q.plan.mode = CapturePlan::Mode::loop;
        auto lc = q.prepareCapture (q.plan);
        CHECK_MSG (lc.ok, lc.problem);
        CHECK (lc.bake.audio.frames() == 96000 && std::abs (lc.coverage - 1.0) < 1e-6);
        CHECK (matchesRange (lc, 48000));
        Marker a, b;
        CHECK (q.loopMarkers (a, b) && b.sample > a.sample && std::abs ((double) (b.sample - a.sample) - 96000.0) < 2.0);
    }

    // ---- heard history: backwards jumps, stop/continue, and selection changes all keep accumulating
    {
        GnumbatProcessor q;  FakeHost h;  q.setPlayHead (&h);
        q.setRateAndBufferSizeDetails (48000.0, 512);  q.prepareToPlay (48000.0, 512);
        h.hasLoop = true; h.looping = true; h.loopStart = 0.0; h.loopEnd = 8.0;    // ppq 0..8 = samples 0..192000
        h.playing = false; run (q, &h, 0, 512, 512);                                 // stopped at the loop start
        Marker a, b;
        CHECK (q.loopMarkers (a, b) && a.sample == 0 && b.sample == 192000);
        CHECK (q.coverageOf (a, b) == 0.0);

        h.playing = true;
        run (q, &h, 96000, 48000, 512);                                             // hear the 3rd quarter first
        CHECK (std::abs (q.coverageOf (a, b) - 0.25) < 0.01);
        run (q, &h, 0, 48000, 512);                                                 // then press play at the selection START
        CHECK_MSG (std::abs (q.coverageOf (a, b) - 0.5) < 0.01,                     // (a backwards jump used to be dropped)
                   "coverage after playing from the start: " + String (q.coverageOf (a, b)));
        h.playing = false; run (q, &h, 48000, 2048, 512);                           // stop...
        h.playing = true;  run (q, &h, 48000, 24000, 512);                          // ...and continue from where it stopped
        CHECK (std::abs (q.coverageOf (a, b) - 0.625) < 0.01);

        h.loopStart = 4.0; h.loopEnd = 6.0; run (q, &h, 72000, 512, 512);           // pick a different selection (samples 96000..144000)
        Marker c, d;
        CHECK (q.loopMarkers (c, d) && c.sample == 96000 && d.sample == 144000);
        CHECK (std::abs (q.coverageOf (c, d) - 1.0) < 0.01);                        // already heard earlier -> still heard
        h.loopStart = 0.0; h.loopEnd = 8.0; run (q, &h, 72512, 512, 512);           // back to the first selection: nothing forgotten
        CHECK (q.loopMarkers (a, b) && std::abs (q.coverageOf (a, b) - (145024.0 - 24000.0) / 192000.0) < 0.01);

        for (int pass = 0; pass < 200; ++pass) run (q, &h, 0, 4096, 512);           // cycling doesn't pile up new runs
        CHECK (q.coveredFractionsOf (a, b).size() <= 2);
    }

    // ---- TimelineTape: the heard bar is exactly the host selection, and grey = audio in memory
    {
        GnumbatProcessor q;  FakeHost h;  q.setPlayHead (&h);
        q.setRateAndBufferSizeDetails (48000.0, 512);  q.prepareToPlay (48000.0, 512);
        h.hasLoop = true; h.looping = true; h.loopStart = 2.0; h.loopEnd = 6.0;      // 1 s .. 3 s at 120 bpm
        h.playing = false; run (q, &h, 0, 512, 512);
        auto sel = q.selection();
        CHECK (sel.ok && sel.start == 48000 && sel.end == 144000 && std::abs (sel.seconds - 2.0) < 1e-9 && sel.coverage == 0.0);

        // Play it out of order: the second half first, then the first half.
        h.playing = true;
        run (q, &h, 96000, 48000, 512);
        sel = q.selection();
        CHECK (std::abs (sel.coverage - 0.5) < 1e-6 && sel.fractions.size() == 1
               && std::abs (sel.fractions[0].first - 0.5) < 1e-6 && std::abs (sel.fractions[0].second - 1.0) < 1e-6);
        run (q, &h, 48000, 48000, 512);
        sel = q.selection();
        CHECK (std::abs (sel.coverage - 1.0) < 1e-9 && sel.fractions.size() == 1);

        // The Bake is exactly the selection's audio, sample for sample, from memory.
        q.plan.mode = CapturePlan::Mode::loop;
        auto lc = q.prepareCapture (q.plan);
        CHECK_MSG (lc.ok, lc.problem);
        CHECK (lc.bake.audio.frames() == 96000 && std::abs (lc.coverage - 1.0) < 1e-9 && matchesRange (lc, 48000));

        // The bar never moves: the host's sample clock re-basing (latency change, pre-roll, a host
        // whose timeInSamples doesn't line up with its ppq) does not shift the selection at all.
        h.ppqAt0 = 0.37;  run (q, &h, 0, 512, 512);
        sel = q.selection();
        CHECK (sel.start == 48000 && sel.end == 144000);

        // A new, longer selection shows what's already in memory at its exact position.
        h.loopStart = 0.0; h.loopEnd = 8.0;
        h.playing = false; run (q, &h, 0, 512, 512);                                  // (loop points reach the plugin with the next block)
        sel = q.selection();
        CHECK (sel.ok && sel.start == 0 && sel.end == 192000 && std::abs (sel.seconds - 4.0) < 1e-9);
        CHECK (std::abs (sel.coverage - (96000.0 + 512.0) / 192000.0) < 1e-6);   // 1..3 s already heard, + the 512-sample block above
        CHECK (sel.fractions.size() == 2);

        // Partial selection -> partial Bake: unplayed parts are silence, not stale audio.
        GnumbatProcessor r;  FakeHost hr;  r.setPlayHead (&hr);
        r.setRateAndBufferSizeDetails (48000.0, 512);  r.prepareToPlay (48000.0, 512);
        hr.hasLoop = true; hr.looping = true; hr.loopStart = 0.0; hr.loopEnd = 4.0;  // 0 .. 96000
        run (r, &hr, 24576, 24576, 512);                                            // middle quarter-ish only
        r.plan.mode = CapturePlan::Mode::loop;
        auto pc2 = r.prepareCapture (r.plan);
        CHECK_MSG (pc2.ok, pc2.problem);
        CHECK (pc2.bake.audio.frames() == 96000 && std::abs (pc2.coverage - 24576.0 / 96000.0) < 1e-6 && ! pc2.bake.capture.complete);
        bool silentOutside = true, exactInside = true;
        for (int i = 0; i < 96000; i += 101)
        {
            const float v = pc2.bake.audio.channels[0][(size_t) i];
            if (i < 24576 || i >= 49152) silentOutside = silentOutside && v == 0.0f;
            else exactInside = exactInside && v == valueAt (0, i);
        }
        CHECK (silentOutside && exactInside);

        // A tempo change moves every musical position: the tape starts over instead of mixing scales.
        hr.bpm = 100.0; run (r, &hr, 0, 512, 512);
        CHECK (r.selection().coverage < 0.01);
    }

    // ---- a cycling host whose blocks straddle the loop end must still reach exactly 100 %
    {
        GnumbatProcessor q;  FakeHost h;  q.setPlayHead (&h);
        q.setRateAndBufferSizeDetails (48000.0, 512);  q.prepareToPlay (48000.0, 512);
        h.hasLoop = true; h.looping = true; h.loopStart = 2.0; h.loopEnd = 6.0;   // samples 48000..144000 (96000 = 187.5 blocks)
        const juce::int64 L0 = 48000, L1 = 144000;
        // Play pressed INSIDE the loop (300 samples in), 480-sample blocks: 96000 / 480 = 200 exactly, so
        // every wrap lands mid-block at the same offset -- without the split, [0, 300) of the
        // selection is never recorded on any pass and the bar sticks just under 100 %.
        constexpr int B = 480;
        juce::AudioBuffer<float> buf (2, B);  juce::MidiBuffer midi;
        juce::int64 t = L0 + 300;
        for (int blk = 0; blk < 200 * 4; ++blk)                                    // 4 passes
        {
            h.timeSamples = t;
            for (int i = 0; i < B; ++i)
            {
                juce::int64 ti = t + i;  if (ti >= L1) ti = L0 + (ti - L1);
                for (int c = 0; c < 2; ++c) buf.setSample (c, i, valueAt (c, ti));
            }
            q.processBlock (buf, midi);
            t += B;  if (t >= L1) t = L0 + (t - L1);
            if (blk == 190) h.bpm = 120.0 + 3.0e-3;                                   // host tempo jitter: must NOT wipe anything
            if (blk == 191) h.bpm = 120.0;
        }
        const auto sel = q.selection();
        CHECK_MSG (sel.ok && sel.coverage == 1.0 && sel.fractions.size() == 1,
                   "coverage " + String (sel.coverage, 8) + ", zones " + String ((int) sel.fractions.size()));
        q.plan.mode = CapturePlan::Mode::loop;
        auto lc = q.prepareCapture (q.plan);
        CHECK_MSG (lc.ok, lc.problem);
        CHECK (lc.bake.capture.complete && lc.bake.audio.frames() == 96000 && matchesRange (lc, L0));
        // stays at 100 % while nothing about the selection changes
        h.playing = false;  for (int k = 0; k < 20; ++k) { h.timeSamples = L0; q.processBlock (buf, midi); }
        CHECK (q.selection().coverage == 1.0);
    }

    // ---- a host whose reported tempo and ppq progression disagree slightly (so every block lands a
    // sample or more off where the previous one ended), cycling with mid-block wraps and play pressed
    // inside the loop: must still reach exactly 100 %, and the Bake must be full-length with no dropouts.
    {
        GnumbatProcessor q;  FakeHost h;  q.setPlayHead (&h);
        q.setRateAndBufferSizeDetails (48000.0, 512);  q.prepareToPlay (48000.0, 512);
        h.bpm = 120.0; h.ppqBpm = 120.3;                                              // 0.25 % disagreement
        h.hasLoop = true; h.looping = true; h.loopStart = 2.0; h.loopEnd = 6.0;
        const double sr = 48000.0, spbHost = 60.0 / 120.3 * sr;                     // host's real samples per beat
        const juce::int64 L0 = (juce::int64) std::llround (2.0 * spbHost), L1 = (juce::int64) std::llround (6.0 * spbHost);
        constexpr int B = 480;
        juce::AudioBuffer<float> buf (2, B);  juce::MidiBuffer midi;
        juce::int64 t = L0 + 777;
        for (int blk = 0; blk < 5 * (int) ((L1 - L0) / B + 1); ++blk)
        {
            h.timeSamples = t;
            for (int i = 0; i < B; ++i)
            {
                juce::int64 ti = t + i;  if (ti >= L1) ti = L0 + (ti - L1);
                for (int c = 0; c < 2; ++c) buf.setSample (c, i, 0.25f * std::sin ((float) ti * 0.01f));
            }
            q.processBlock (buf, midi);
            t += B;  if (t >= L1) t = L0 + (t - L1);
        }
        const auto sel = q.selection();
        CHECK_MSG (sel.ok && sel.complete && sel.coverage == 1.0, "coverage " + String (sel.coverage, 8));
        q.plan.mode = CapturePlan::Mode::loop;
        auto lc = q.prepareCapture (q.plan);
        CHECK_MSG (lc.ok && lc.bake.capture.complete, lc.problem);
        // No silent holes: a never-written sliver would read back as a run of exact zeros. (This host
        // disagrees with itself, so small phase jumps where the positions re-align are unavoidable.)
        bool noHoles = true;
        const auto& ch = lc.bake.audio.channels[0];
        for (size_t i = 2; i < ch.size(); ++i) if (ch[i] == 0.0f && ch[i - 1] == 0.0f && ch[i - 2] == 0.0f) { noHoles = false; break; }
        CHECK (noHoles && ch.size() == (size_t) (sel.end - sel.start));
    }

    // ---- REAPER, as measured in heard_debug.log: 96 kHz, 512-sample blocks, 16 beats at 99.44 bpm,
    // and every pass jumps back ~1072 samples BEFORE the loop end. Must still reach exactly 100 %.
    {
        GnumbatProcessor q;  FakeHost h;  q.setPlayHead (&h);
        q.setRateAndBufferSizeDetails (96000.0, 512);  q.prepareToPlay (96000.0, 512);
        h.sampleRate = 96000.0;  h.bpm = 99.44;
        h.hasLoop = true; h.looping = true; h.loopStart = 32.0; h.loopEnd = 48.0;
        const double spb = 60.0 / 99.44 * 96000.0;
        const juce::int64 L0 = (juce::int64) std::llround (32.0 * spb), L1 = (juce::int64) std::llround (48.0 * spb) - 1072;   // host wraps early
        juce::AudioBuffer<float> buf (2, 512);  juce::MidiBuffer midi;
        juce::int64 t = L0;
        for (int blk = 0; blk < 3 * 1812; ++blk)
        {
            const int n = (int) std::min<juce::int64> (512, L1 - t);                 // host truncates the last block at ITS wrap point
            buf.setSize (2, n, false, false, true);
            h.timeSamples = t;
            for (int i = 0; i < n; ++i) for (int c = 0; c < 2; ++c) buf.setSample (c, i, 0.25f * std::sin ((float) (t + i) * 0.003f));
            q.processBlock (buf, midi);
            t += n;  if (t >= L1) t = L0;
        }
        const auto sel = q.selection();
        CHECK_MSG (sel.ok && sel.complete && sel.coverage == 1.0, "coverage " + String (sel.coverage, 8));
        q.plan.mode = CapturePlan::Mode::loop;
        auto lc = q.prepareCapture (q.plan);
        CHECK_MSG (lc.ok && lc.bake.capture.complete, lc.problem);
        const auto& ch = lc.bake.audio.channels[0];
        CHECK (ch.size() == (size_t) (sel.end - sel.start) && std::abs (ch.back()) < 1.0e-3f);   // faded out to silence, not held
    }

    // ---- block-grid slivers at the selection's edges count as heard; real gaps don't
    {
        GnumbatProcessor q;  FakeHost h;  q.setPlayHead (&h);
        q.setRateAndBufferSizeDetails (48000.0, 512);  q.prepareToPlay (48000.0, 512);
        h.hasLoop = true; h.looping = false; h.loopStart = 2.0; h.loopEnd = 6.0;   // 48000..144000
        run (q, &h, 48000 + 300, 96000 - 300 - 400, 512);                           // misses 300 at the start, 400 at the end (< 1 block each)
        auto sel = q.selection();
        CHECK_MSG (sel.complete && sel.coverage == 1.0 && sel.fractions.size() == 1
                   && sel.fractions[0].first == 0.0 && sel.fractions[0].second == 1.0,
                   "coverage " + String (sel.coverage, 8));
        GnumbatProcessor r;  FakeHost hr;  r.setPlayHead (&hr);
        r.setRateAndBufferSizeDetails (48000.0, 512);  r.prepareToPlay (48000.0, 512);
        hr.hasLoop = true; hr.loopStart = 2.0; hr.loopEnd = 6.0;
        run (r, &hr, 48000, 96000 - 5000, 512);                                      // 5000 short: really unheard
        sel = r.selection();
        CHECK (! sel.complete && sel.coverage < 0.95);
    }

    // ---- notation: #words become tags; the text itself is kept verbatim
    {
        const auto tags = ui::NotationCard::parseTags ("weird ass nosy rise #inharmonic #spiral, #Spiral #attack-decay;#build-up. # end");
        CHECK_MSG (tags.joinIntoString ("|") == "inharmonic|spiral|attack-decay|build-up", tags.joinIntoString ("|"));
        CHECK (ui::NotationCard::withoutTags ("weird ass nosy rise #inharmonic #spiral") == "weird ass nosy rise");
        CHECK (ui::NotationCard::parseTags ("no tags here").isEmpty());
        const auto parsed = notation::parse ("weird ass nosy rise #inharmonic", ui::NotationCard::plainProfile());
        CHECK (parsed.tags.isEmpty() && parsed.error.isEmpty());                     // the notation itself never becomes a tag
    }

    // ---- stopped transport: audio still flows (live monitoring) but is not timeline-addressable
    {
        GnumbatProcessor q;  FakeHost h;  h.playing = false;  q.setPlayHead (&h);
        q.setRateAndBufferSizeDetails (48000.0, 512);  q.prepareToPlay (48000.0, 512);
        run (q, &h, 1000, 96000, 512);
        CHECK (! q.transport().playing);
        q.plan.mode = CapturePlan::Mode::range;  q.plan.in = { 1000, 0, false };  q.plan.out = { 50000, 0, false };
        CHECK (! q.prepareCapture (q.plan).ok);
        q.plan.mode = CapturePlan::Mode::lastSeconds;  q.plan.seconds = 1.0;
        auto lc = q.prepareCapture (q.plan);
        CHECK (lc.ok && lc.bake.audio.frames() == 48000);
        CHECK (! lc.bake.capture.hasTimeline);                                        // no timeline claimed for un-addressable audio
    }

    // ---- no play head at all (standalone / minimal hosts): own counter keeps RANGE working
    {
        GnumbatProcessor q;
        q.setRateAndBufferSizeDetails (44100.0, 256);  q.prepareToPlay (44100.0, 256);
        run (q, nullptr, 0, 44100 * 3, 256);
        CHECK (q.transport().valid && ! q.transport().hostTimeline);
        auto now = q.markerNow();
        CHECK (now.isSet() && now.sample >= 44100 * 3 - 256);
        q.plan.mode = CapturePlan::Mode::range;
        q.plan.in = { 44100, 0, false };  q.plan.out = { 44100 * 2, 0, false };
        auto rc = q.prepareCapture (q.plan);
        CHECK_MSG (rc.ok, rc.problem);
        CHECK (rc.bake.audio.frames() == 44100 && ! rc.bake.capture.hasTimeline);
        CHECK (matchesRange (rc, 44100));
    }

    // ---- mono
    {
        GnumbatProcessor q;
        q.setPlayHead (&host);
        q.setPlayConfigDetails (1, 1, 48000.0, 512);
        q.prepareToPlay (48000.0, 512);
        run (q, &host, 0, 48000, 512, 1);
        q.plan.mode = CapturePlan::Mode::lastSeconds;  q.plan.seconds = 0.5;
        auto mc = q.prepareCapture (q.plan);
        CHECK (mc.ok && mc.bake.audio.numChannels() == 1);
    }

    // ---- prepareToPlay churn: same config keeps the audio; a new sample rate legitimately starts over
    {
        const auto before = p.ring().totalWritten();
        p.prepareToPlay (48000.0, 256);
        CHECK (p.ring().totalWritten() == before);
        p.prepareToPlay (44100.0, 256);
        CHECK (p.ring().totalWritten() == 0);
    }

    // ---- state: markers + ui prefs survive; audio is never in the project file; garbage is ignored
    {
        GnumbatProcessor a;
        a.plan.mode = CapturePlan::Mode::range;  a.plan.in = { 12345, 3.5, true };  a.plan.out = { 99999, 9.5, true };  a.plan.bars = 8;  a.plan.seconds = 7.5;
        a.setUiState ("tab", "map");  a.setUiState ("search", "riser");
        juce::MemoryBlock mb;
        a.getStateInformation (mb);
        CHECK (mb.getSize() < 4096);
        GnumbatProcessor b;
        b.setStateInformation (mb.getData(), (int) mb.getSize());
        CHECK (b.plan.mode == CapturePlan::Mode::range && b.plan.in.sample == 12345 && b.plan.out.sample == 99999 && b.plan.in.hasPpq);
        CHECK (std::abs (b.plan.bars - 8.0) < 1e-9 && std::abs (b.plan.seconds - 7.5) < 1e-9);
        CHECK (b.getUiState ("tab").toString() == "map" && b.getUiState ("search").toString() == "riser");
        GnumbatProcessor c;
        const char junk[] = "not json at all";
        c.setStateInformation (junk, (int) sizeof (junk));
        CHECK (c.plan.mode == CapturePlan::Mode::loop);            // default: a Bake is always the host's loop range
        const char other[] = "{\"schema\":\"someone.else/1\",\"plan\":{\"mode\":\"range\"}}";
        c.setStateInformation (other, (int) sizeof (other) - 1);
        CHECK (c.plan.mode == CapturePlan::Mode::loop);
    }

    // ---- bus layouts: transparent tap, mono or stereo only
    {
        juce::AudioProcessor::BusesLayout l;
        l.inputBuses.add (juce::AudioChannelSet::stereo());  l.outputBuses.add (juce::AudioChannelSet::stereo());
        CHECK (p.isBusesLayoutSupported (l));
        l.outputBuses.set (0, juce::AudioChannelSet::mono());
        CHECK (! p.isBusesLayoutSupported (l));
        l.inputBuses.set (0, juce::AudioChannelSet::create5point1());  l.outputBuses.set (0, juce::AudioChannelSet::create5point1());
        CHECK (! p.isBusesLayoutSupported (l));
    }

    // ---- marker text round trip
    {
        TransportSnapshot ts;  ts.hasPpq = true;  ts.bpm = 120;  ts.tsNum = 4;  ts.tsDen = 4;  ts.sampleRate = 48000;
        Marker m { 96000, 4.0, true };
        auto txt = ui::CapturePanel::formatMarker (m, ts);
        CHECK (txt == "2|1.00");                                    // ppq 4 = bar 2 beat 1
        Marker now { 480000, 20.0, true }, parsed;
        CHECK (ui::CapturePanel::parseMarker (txt, now, ts, parsed) && parsed.sample == 96000);
        CHECK (ui::CapturePanel::parseMarker ("0:02.5", now, ts, parsed) && parsed.sample == 120000);
        CHECK (ui::CapturePanel::parseMarker ("3.25", now, ts, parsed) && parsed.sample == 156000);
        CHECK (! ui::CapturePanel::parseMarker ("bar two", { }, ts, parsed));
        ts.hasPpq = false;
        CHECK (ui::CapturePanel::formatMarker ({ 96000, 0, false }, ts) == "0:02.000");
    }
}

// ---------------------------------------------------------------------------------------------------- shared fixtures for UI
struct Env
{
    juce::File dir = tempDir ("env");
    juce::File lib = dir.getChildFile ("lib");
    Env()
    {
        setEnv ("GNUMBAT_SETTINGS", dir.getChildFile ("settings.json").getFullPathName());
        setEnv ("GNUMBAT_LIBRARY", lib.getFullPathName());
        setEnv ("GNUMBAT_AUTOSTART", "0");
    }
    ~Env() { dir.deleteRecursively(); }
};

static void pumpMessages (int ms)
{
    juce::MessageManager::getInstance()->runDispatchLoopUntil (ms);
}

static void fillDemo (Library& lib, int n, bool withTempo = true)
{
    static const char* words[] = { "rise", "fall", "hits", "drone", "metallic", "riser tension", "dark drone", "bright hits" };
    for (int i = 0; i < n; ++i)
    {
        NewBake nb;
        nb.audio.sampleRate = 44100.0;
        nb.audio.channels.assign (2, std::vector<float> (44100 * 2));
        for (size_t k = 0; k < nb.audio.channels[0].size(); ++k)
            nb.audio.channels[0][k] = nb.audio.channels[1][k] = 0.4f * std::sin ((float) k * 0.01f * (float) (1 + i % 7));
        nb.rawNotation = String (words[i % 8]) + (withTempo && i % 3 == 0 ? "-" + String (100 + i) + " BPM" : String());
        nb.profile = withTempo ? notation::builtinProfile ("np_musical_dash") : var();
        nb.capture.hostName = "test"; nb.capture.tempoBpm = 100 + i;
        nb.submit = false;
        String id;
        lib.createBake (nb, id);
    }
}

// ---------------------------------------------------------------------------------------------------- UI
static void testUi()
{
    Env env;
    Library::init (env.lib);
    Library lib (env.lib);
    fillDemo (lib, 24);

    GnumbatProcessor proc;
    proc.setRateAndBufferSizeDetails (48000.0, 512);
    proc.prepareToPlay (48000.0, 512);
    FakeHost host;
    proc.setPlayHead (&host);
    run (proc, &host, 0, 48000 * 12, 512);

    std::unique_ptr<juce::AudioProcessorEditor> ed (proc.createEditor());
    auto* editor = dynamic_cast<GnumbatEditor*> (ed.get());
    CHECK (editor != nullptr);
    if (editor == nullptr) return;
    editor->setSize (1200, 800);
    auto& model = editor->appModel();
    CHECK (model.hasLibrary());
    CHECK (model.rows().size() == 24 && model.visible().size() == 24);

    // ---- search + chips
    model.setSearch ("drone");
    const auto droneCount = model.visible().size();
    CHECK (droneCount > 0 && droneCount < 24);
    for (int i : model.visible()) CHECK (json::getString (model.rows()[(size_t) i].view, "notation").containsIgnoreCase ("drone"));
    model.setSearch ({});
    model.setChips ({ filter::leaf ("fields/tempo", "between", var (juce::Array<var> { 100, 110 })) });
    CHECK (model.visible().size() > 0 && model.visible().size() < 24);
    for (int i : model.visible()) { auto tv = json::getNumber (model.rows()[(size_t) i].view, "fields/tempo"); CHECK (tv >= 100 && tv <= 110); }
    model.setChips ({ filter::leaf ("fields/tempo", "exists", false) });
    CHECK (model.visible().size() > 0);
    model.setChips ({});
    CHECK (model.visible().size() == 24);

    // ---- sorting
    model.setSort ("notation", true);
    for (size_t i = 1; i < model.visible().size(); ++i)
        CHECK (json::getString (model.rows()[(size_t) model.visible()[i - 1]].view, "notation").toLowerCase() <= json::getString (model.rows()[(size_t) model.visible()[i]].view, "notation").toLowerCase());
    model.setSort ("created", false);
    CHECK (model.rows()[(size_t) model.visible().front()].id > model.rows()[(size_t) model.visible().back()].id);

    // ---- selection + edit through the model (what the inspector/bank buttons call)
    const auto id0 = model.rows()[0].id, id1 = model.rows()[1].id;
    model.setSelection ({ id0, id1 }, id1);
    CHECK (model.selection().size() == 2 && model.primary() == id1);
    SemanticEdit e;  e.addTags.add ("favourite");  e.addGroups.add ("keepers");
    CHECK (model.editSemantic ({ id0, id1 }, e).isEmpty());
    CHECK (json::getStrings (model.rowById (id0)->view, "tags").contains ("favourite"));
    CHECK (json::getStrings (model.rowById (id1)->view, "groups").contains ("keepers"));
    CHECK (model.relatedIds ("group", id0).size() == 2);

    // ---- trash + undo
    CHECK (model.trash ({ id1 }).isEmpty());
    CHECK (model.rows().size() == 23 && model.rowById (id1) == nullptr && ! model.selection().contains (id1));
    CHECK (model.canUndoTrash());
    CHECK (model.undoTrash().isEmpty());
    CHECK (model.rows().size() == 24 && model.rowById (id1) != nullptr);

    // ---- datasets
    CHECK (model.createDatasetWith ("test set", { id0, id1 }).isEmpty());
    CHECK (model.snapshot().datasets.size() == 1 && model.snapshot().datasets[0].members == 2);
    CHECK (JobSubmitter (env.lib).counts().pending >= 1);                // reindex queued for the worker

    // ---- worker absence is visible, and reprocess queues jobs
    CHECK (! model.snapshot().worker.alive);
    CHECK (model.reprocess ({ id0 }, "all").isEmpty());
    CHECK (JobSubmitter (env.lib).counts().pending >= 2);

    // ---- paint everything without crashing (bank, inspector single/multi/none, map without map)
    for (int sel = 0; sel < 3; ++sel)
    {
        model.setSelection (sel == 0 ? juce::StringArray() : sel == 1 ? juce::StringArray { id0 } : juce::StringArray { id0, id1 });
        editor->showTab (false);
        auto img = editor->createComponentSnapshot (editor->getLocalBounds());
        CHECK (img.getWidth() == 1200);
        editor->showTab (true);
        img = editor->createComponentSnapshot (editor->getLocalBounds());
    }

    // ---- map: geometry + hit testing with a real map file (written the way the worker does)
    {
        juce::Array<var> pts;
        for (int i = 0; i < 24; ++i)
            pts.add (json::object ({ { "bake_id", model.rows()[(size_t) i].id }, { "x", std::cos (i * 0.7) * 0.9 }, { "y", std::sin (i * 0.7) * 0.9 } }));
        auto doc = json::object ({ { "schema", "gnumbat.map/0.1" }, { "map_id", "mp_00000000000000000000" }, { "created_at", json::utcNow() },
                                   { "space", json::object ({ { "embedding_id", "em_00000000000000000000" }, { "feature_set_id", "spectral" }, { "label", "Spectral" } }) },
                                   { "method", json::object ({ { "name", "tsne" }, { "params", json::emptyObject() }, { "seed", 0 } }) },
                                   { "points", var (pts) }, { "quality", json::object ({ { "trustworthiness", 0.9 } }) },
                                   { "disclaimer", "test projection" } });
        json::atomicWriteJson (env.lib.getChildFile ("derived/maps/spectral.json"), doc);
        model.refreshNow();
        pumpMessages (100);                                              // ChangeBroadcaster delivers asynchronously
        CHECK (model.map() != nullptr && model.map()->points.size() == 24);
        auto& mv = editor->mapView();
        editor->showTab (true);
        editor->resized();
        mv.fitView();
        const auto w = juce::Point<float> (0.2f, -0.4f);
        const auto s = mv.worldToScreen (w);
        const auto back = mv.screenToWorld (s);
        CHECK (std::abs (back.x - w.x) < 1e-4f && std::abs (back.y - w.y) < 1e-4f);
        const auto target = model.map()->points[5];
        CHECK (mv.pointAt (mv.worldToScreen ({ target.x, target.y })) == target.bakeId);
        CHECK (mv.pointAt ({ -500.f, -500.f }).isEmpty());
        mv.setColourModeByText ("first tag");
        auto img = editor->createComponentSnapshot (editor->getLocalBounds());
        CHECK (img.getHeight() == 800);
        CHECK (mv.colourMode() == "first tag");
    }

    // ---- BAKE through the real dialog: capture -> notation card -> background write -> library.
    // The panel offers no mode choice any more (default CapturePlan::mode is now `loop`): a Bake is always
    // exactly the host's current loop / cycle range, so BAKE-through-the-UI is exercised with the host
    // reporting a loop rather than by poking proc.plan directly.
    {
        editor->showTab (false);
        CHECK (proc.plan.mode == CapturePlan::Mode::loop);
        host.hasLoop = true; host.looping = true; host.loopStart = 4.0; host.loopEnd = 12.0;   // ppq 4..12 = 2s..6s at 120 bpm = samples 96000..288000
        run (proc, &host, 48000 * 12, 512, 512);                                               // one more block so the loop points are published
        const auto before = model.rows().size();
        editor->beginBake();
        CHECK (editor->dialogOpen());
        ui::NotationCard* card = nullptr;
        for (auto* c : editor->getChildren()) if ((card = dynamic_cast<ui::NotationCard*> (c)) != nullptr) break;
        CHECK (card != nullptr);
        if (card != nullptr)
        {
            ui::NotationCard::Result r;
            r.accepted = true;
            r.rawNotation = "  Aggressive   metallic rise ";              // verbatim, odd spacing included
            r.profile = notation::freeformProfile();
            r.decompose = true;
            r.decomposer = "testsplit";
            card->onDone (r);
            for (int i = 0; i < 100 && model.rows().size() == before; ++i) pumpMessages (50);
            CHECK (model.rows().size() == before + 1);
            const auto& newest = model.rows().back();
            CHECK (json::getString (newest.view, "notation") == "  Aggressive   metallic rise ");
            CHECK (json::getString (newest.view, "state") == "CAPTURED");
            CHECK (model.selection().size() == 1 && model.selection()[0] == newest.id);
            auto bakeDoc = lib.readBake (newest.id);
            CHECK (json::getString (bakeDoc, "capture/mode") == "loop");
            CHECK (std::abs (json::getNumber (bakeDoc, "audio/duration_s") - 4.0) < 1e-3);        // loop ppq 4..12 at 120 bpm 4/4 = 4 s
            CHECK (json::getNumber (bakeDoc, "capture/timeline/start_sample") == 96000);
            CHECK (json::getNumber (bakeDoc, "capture/timeline/end_sample") == 288000);
        }
        pumpMessages (300);
        CHECK (! editor->dialogOpen());
    }

    // ---- cancel discards without writing
    {
        const auto before = model.rows().size();
        editor->beginBake();
        ui::NotationCard* card = nullptr;
        for (auto* c : editor->getChildren()) if ((card = dynamic_cast<ui::NotationCard*> (c)) != nullptr) break;
        CHECK (card != nullptr);
        if (card != nullptr) { ui::NotationCard::Result r; r.accepted = false; card->onDone (r); }
        pumpMessages (300);
        CHECK (model.rows().size() == before && ! editor->dialogOpen());
    }

    // ---- EBYS hand-off (de facto -- settings.ebys_root stands in for the compiled-in default here): BAKE (auto) -> file in raw_uploads + Bake says "waiting"
    {
        const auto ebys = env.dir.getChildFile ("EBYS");
        ebys.getChildFile ("src/demucs").createDirectory();
        ebys.getChildFile ("src/demucs/watch_demucs.py").replaceWithText ("# fake\n");
        ebys.getChildFile ("data").createDirectory();
        ebys.getChildFile ("data/current_session.txt").replaceWithText ("ui-session\n");
        CHECK (! editor->handoffActive() && editor->ebysStatusText().startsWith ("EBYS: not found"));
        model.settings().setEbysRoot (ebys);
        model.settings().set ("handoff_raw_uploads", true);
        editor->refreshEbys();
        CHECK (editor->handoffActive() && editor->ebysStatusText().contains ("ui-session"));

        editor->showTab (false);                            // still the host's loop range from the block above; no mode to set any more
        const auto before = model.rows().size();
        editor->beginBake();
        ui::NotationCard* card = nullptr;
        for (auto* c : editor->getChildren()) if ((card = dynamic_cast<ui::NotationCard*> (c)) != nullptr) break;
        CHECK (card != nullptr);
        if (card != nullptr)
        {
            ui::NotationCard::Result r;
            r.accepted = true;  r.rawNotation = "Heavy Riser";  r.profile = notation::freeformProfile();
            r.decompose = true; r.decomposer = "";                       // "auto"
            card->onDone (r);
            for (int i = 0; i < 100 && model.rows().size() == before; ++i) pumpMessages (50);
            CHECK (model.rows().size() == before + 1);
            const auto id = model.rows().back().id;
            const auto file = ebys.getChildFile ("data/sessions/ui-session/raw_uploads/heavy-riser__" + id + ".wav");
            CHECK (file.existsAsFile());
            model.refreshNow();
            for (int i = 0; i < 40 && json::getString (model.rows().back().view, "handoff") != "waiting"; ++i) { pumpMessages (50); model.refreshNow(); }
            CHECK (json::getString (model.rows().back().view, "handoff") == "waiting");

            // The instrument pipeline's progress file (written by watch_demucs.py) shows up on the Bake,
            // with the first unfinished stage spelled out on the status line.
            CHECK (json::getBool (model.rows().back().view, "pipeline_active"));                     // handed off, watcher not started yet
            const auto track = "heavy-riser__" + id;
            const auto pf = ebys.getChildFile ("data/sessions/ui-session/pipeline/" + track + ".json");
            pf.getParentDirectory().createDirectory();
            auto writeStages = [&] (const String& stagesJson)
            {
                pf.replaceWithText ("{\"track\": \"" + track + "\", \"stages\": " + stagesJson + "}");
                for (int i = 0; i < 40; ++i) { pumpMessages (30); model.refreshNow(); if (json::has (model.rowById (id)->view, "pipeline")) break; }
            };
            writeStages (R"({"demucs": {"status": "running", "percent": 57}, "essentia": {"status": "waiting", "percent": 0},
                              "madmom": {"status": "waiting", "percent": 0}, "flucoma": {"status": "waiting", "percent": 0}})");
            {
                const auto& v = model.rowById (id)->view;
                CHECK (json::getNumber (v, "pipeline/demucs/percent") == 57.0 && json::getBool (v, "pipeline_active"));
                CHECK_MSG (ui::BankView::pipelineStatusText (v) == "demucs 57%  (14% total)", ui::BankView::pipelineStatusText (v));
            }
            writeStages (R"({"demucs": {"status": "done", "percent": 100}, "essentia": {"status": "done", "percent": 100},
                              "madmom": {"status": "done", "percent": 100}, "flucoma": {"status": "waiting", "percent": 0, "msg": "waiting for Pd"}})");
            for (int i = 0; i < 40 && ui::BankView::pipelineStatusText (model.rowById (id)->view) != "flucoma waiting for Pd  (75% total)"; ++i) { pumpMessages (30); model.refreshNow(); }
            CHECK_MSG (ui::BankView::pipelineStatusText (model.rowById (id)->view) == "flucoma waiting for Pd  (75% total)", ui::BankView::pipelineStatusText (model.rowById (id)->view));
            writeStages (R"({"demucs": {"status": "done", "percent": 100}, "essentia": {"status": "done", "percent": 100},
                              "madmom": {"status": "done", "percent": 100}, "flucoma": {"status": "done", "percent": 100}})");
            for (int i = 0; i < 40 && json::getBool (model.rowById (id)->view, "pipeline_active"); ++i) { pumpMessages (30); model.refreshNow(); }
            CHECK (! json::getBool (model.rowById (id)->view, "pipeline_active"));
            CHECK (ui::BankView::pipelineStatusText (model.rowById (id)->view) == "analyzed by EBYS");
        }
        pumpMessages (300);

        // ---- anonymous identity: models are created by "local-xxxxxxxx", never the OS login name
        {
            const auto me = Settings::localIdentity();
            CHECK (me.startsWith ("local-") && me.length() == 14 && me == Settings::localIdentity());
            CHECK (me != juce::SystemStats::getLogonName());
            String mid;
            CHECK (createModel (model.root(), "identity test", {}, mid).wasOk());
            bool found = false;
            for (auto& m : listModels (model.root())) if (m.id == mid) { found = true; CHECK (m.creator == me); }
            CHECK (found);
            // the one-time migration swaps an old login name for the identity, in models and votes
            const auto mf = model.root().getChildFile ("models/" + mid + "/model.json");
            auto doc = json::readFile (mf);
            doc.getDynamicObject()->setProperty ("creator", "someone-real");
            doc.getDynamicObject()->setProperty ("votes_up", json::array ({ "someone-real", "other" }));
            json::atomicWriteJson (mf, doc);
            CHECK (replaceIdentity (model.root(), "someone-real", me) >= 1);
            for (auto& m : listModels (model.root())) if (m.id == mid) { CHECK (m.creator == me); CHECK (m.votesUp.contains (me) && ! m.votesUp.contains ("someone-real")); }
        }

        // ---- ModelHub: the shared (EBYS hub) model list -- offline queue, then sync + id remap.
        // The live half needs a running hub: GNUMBAT_TEST_HUB=http://host:port (skipped otherwise).
        {
            const auto hubRoot = model.root().getChildFile ("hubtest");
            hubRoot.deleteRecursively();
            hubRoot.getChildFile ("bakes/bk_T").createDirectory();
            String tid;
            {
                ui::ModelHub off (hubRoot, "http://127.0.0.1:9");           // nothing listens there
                tid = off.createModel ("offline seed", {});
                for (int i = 0; i < 50 && off.connected(); ++i) pumpMessages (20);
                pumpMessages (200);
                CHECK (! off.connected());
                CHECK (tid.startsWith ("pending-") && off.find (tid) != nullptr && off.find (tid)->pending);
                off.vote (tid, 1);
                pumpMessages (200);
                CHECK (off.queued() == 2 && off.find (tid)->up == 1 && off.find (tid)->myVote == 1);
                CHECK (off.statusText() == "hub off (2 queued)");
                CHECK (hubRoot.getChildFile ("hub/pending.json").existsAsFile());
                json::atomicWriteJson (hubRoot.getChildFile ("bakes/bk_T/bake.json"), json::object ({ { "bake_id", "bk_T" }, { "model_id", tid } }));
                pumpMessages (100);
            }
            if (const auto live = juce::SystemStats::getEnvironmentVariable ("GNUMBAT_TEST_HUB", {}); live.isNotEmpty())
            {
                ui::ModelHub on (hubRoot, live);                               // picks the queue up from disk
                for (int i = 0; i < 200 && (on.queued() > 0 || ! on.connected()); ++i) pumpMessages (25);
                pumpMessages (100);
                on.syncNow();
                for (int i = 0; i < 40; ++i) pumpMessages (25);
                const auto real = on.resolve (tid);
                CHECK (on.connected() && on.queued() == 0);
                CHECK_MSG (real != tid && ! real.startsWith ("pending-"), real);
                CHECK (json::getString (json::readFile (hubRoot.getChildFile ("bakes/bk_T/bake.json")), "model_id") == real);
                const auto* m = on.find (real);
                CHECK (m != nullptr && ! m->pending && m->name == "offline seed" && m->up == 1 && m->myVote == 1);
                CHECK (on.statusText() == "hub on");
                // a replayed queue (e.g. a second plugin window with a stale copy) doesn't duplicate anything
                int named = 0;
                for (auto& x : on.models()) if (x.name == "offline seed") ++named;
                CHECK (named == 1);
                // and the website's own list has it (same registry)
                CHECK (hubRoot.getChildFile ("hub/models_cache.json").loadFileAsString().contains (real));
            }
            hubRoot.deleteRecursively();
        }

        // ---- MODEL page: click selects (does NOT enter), arrows move, Enter opens
        {
            if (auto* h = editor->modelHub(); h != nullptr && h->models().empty()) h->createModel ("page test", {});
            pumpMessages (100);
            editor->showModelPage (true);
            pumpMessages (50);
            auto& mp = editor->modelMenu();
            CHECK (editor->modelPageVisible());
            const auto rowY = 6 + 18 + 9;                                                   // first model row (under the column header)
            const juce::Point<float> pt (60.0f, (float) rowY); const auto now = juce::Time::getCurrentTime();
            juce::MouseEvent click (juce::Desktop::getInstance().getMainMouseSource(), pt, juce::ModifierKeys(), 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, &mp, &mp, now, pt, now, 1, false);
            mp.mouseUp (click);
            CHECK (editor->modelPageVisible());                                               // a click only selects
            const auto before = proc.getUiState ("model_name", "").toString();
            mp.keyPressed (juce::KeyPress (juce::KeyPress::downKey));
            mp.keyPressed (juce::KeyPress (juce::KeyPress::upKey));
            CHECK (editor->modelPageVisible() && proc.getUiState ("model_name", "").toString() == before);   // arrows only move
            mp.keyPressed (juce::KeyPress (juce::KeyPress::returnKey));
            pumpMessages (20);
            CHECK (! editor->modelPageVisible());                                             // Enter opens it
            CHECK (proc.getUiState ("model_name", "").toString().isNotEmpty());
        }

        // ---- double-click a Bake: one field over NOTATION + TAGS, saved by clicking elsewhere
        {
            editor->showModelPage (false);
            editor->showTab (false);
            pumpMessages (50);
            auto& bv = editor->bankView();
            const auto id = model.rows()[(size_t) model.visible().front()].id;
            model.setSelection ({ id }, id);
            pumpMessages (30);
            bv.editInline (id);
            pumpMessages (20);
            auto& te = bv.inlineEditor();
            CHECK (te.isVisible() && te.getText().isNotEmpty());                 // prefilled with the Bake's notation (+ #tags)
            te.setText ("weird nosy rise #inharmonic #spiral", true);
            te.onFocusLost();                                                      // "click elsewhere" (no real focus off-screen)
            for (int i = 0; i < 40; ++i) { pumpMessages (30); model.refreshNow(); if (json::getString (model.rowById (id)->view, "notation") == "weird nosy rise #inharmonic #spiral") break; }
            CHECK (! te.isVisible());
            CHECK_MSG (json::getString (model.rowById (id)->view, "notation") == "weird nosy rise #inharmonic #spiral", json::getString (model.rowById (id)->view, "notation"));
            CHECK (json::getStrings (model.rowById (id)->view, "tags").joinIntoString ("|") == "inharmonic|spiral");
            // Escape cancels
            bv.editInline (id);
            te.setText ("should not be saved", true);
            te.onEscapeKey();
            pumpMessages (50); model.refreshNow();
            CHECK (json::getString (model.rowById (id)->view, "notation") == "weird nosy rise #inharmonic #spiral");
        }

        // ---- login fields: typed text lands exactly on the "Username"/"Password" hints, and the
        // fields never move while typing.
        if (! editor->userAccount().loggedIn())
        {
            auto& bar = editor->loginFields();
            juce::Array<juce::TextEditor*> f;
            for (auto* c : bar.getChildren()) if (auto* t = dynamic_cast<juce::TextEditor*> (c); t != nullptr && t->getWantsKeyboardFocus()) f.add (t);   // the real fields, not the hint views
            CHECK (f.size() == 2);
            if (f.size() == 2 && bar.getWidth() > 0)
            {
                // ink bounds (anything non-black) of one field's area of the bar
                auto ink = [&] (juce::TextEditor* t)
                {
                    // what the user sees: the editor's snapshot (with its threshold effect), cropped to the bar
                    auto img = editor->createComponentSnapshot (editor->getLocalArea (&bar, bar.getLocalBounds()), true, 1.0f);
                    juce::Rectangle<int> b;
                    auto area = t->getBounds().withWidth (juce::GlyphArrangement::getStringWidthInt (ui::mono(), "Username") + 12);
                    float peak = 0.0f;                       // threshold relative to the text's own brightness
                    for (int y = area.getY(); y < area.getBottom(); ++y)
                        for (int x = area.getX(); x < juce::jmin (area.getRight(), img.getWidth()); ++x)
                            peak = juce::jmax (peak, img.getPixelAt (x, y).getBrightness());
                    for (int y = area.getY(); y < area.getBottom(); ++y)
                        for (int x = area.getX(); x < juce::jmin (area.getRight(), img.getWidth()); ++x)
                            if (img.getPixelAt (x, y).getBrightness() > 0.2f)
                                b = b.isEmpty() ? juce::Rectangle<int> (x, y, 1, 1) : b.getUnion ({ x, y, 1, 1 });
                    return b;
                };
                f[0]->setCaretVisible (false);   // measure text only
                const auto b0 = f[0]->getBounds(), b1 = f[1]->getBounds();
                // Measure the hint drawn in the typed text's colour, so antialiasing matches too.
                juce::TextEditor* hintView = nullptr;
                for (auto* c : bar.getChildren()) if (auto* t = dynamic_cast<juce::TextEditor*> (c); t != nullptr && ! t->getWantsKeyboardFocus() && t->getBounds() == f[0]->getBounds()) hintView = t;
                CHECK (hintView != nullptr);
                const auto hintCol = hintView != nullptr ? hintView->findColour (juce::TextEditor::textColourId) : juce::Colour();
                if (hintView != nullptr) hintView->applyColourToAllText (f[0]->findColour (juce::TextEditor::textColourId), true);
                pumpMessages (20);
                const auto hint = ink (f[0]);
                f[0]->setText ("Username", true);           // type exactly the hint's word
                pumpMessages (20);
                const auto typed = ink (f[0]);
                CHECK_MSG (hint == typed && ! hint.isEmpty(), hint.toString() + " vs " + typed.toString());
                f[0]->setText ("someone", true);
                pumpMessages (20);
                CHECK (f[0]->getBounds() == b0 && f[1]->getBounds() == b1);
                f[0]->clear();
                f[0]->setCaretVisible (true);
                if (hintView != nullptr) hintView->applyColourToAllText (hintCol, true);
                pumpMessages (20);
            }
        }

        // ---- accounts: log in / register (2 steps) / forgot / log out through the real UI.
        // Needs a backend: set GNUMBAT_TEST_BACKEND=http://host:port (skipped otherwise).
        if (const auto backend = juce::SystemStats::getEnvironmentVariable ("GNUMBAT_TEST_BACKEND", {}); backend.isNotEmpty())
        {
            model.settings().set ("backend_url", backend);
            auto& acc = editor->userAccount();
            auto& bar = editor->loginFields();
            if (acc.loggedIn()) { acc.logout(); pumpMessages (50); }
            juce::Array<juce::TextEditor*> f;
            for (auto* c : bar.getChildren()) if (auto* t = dynamic_cast<juce::TextEditor*> (c); t != nullptr && t->getWantsKeyboardFocus()) f.add (t);   // the real fields, not the hint views
            CHECK (f.size() == 2);
            auto waitIdle = [&] { for (int i = 0; i < 200 && acc.busy(); ++i) pumpMessages (20); pumpMessages (30); };
            if (f.size() == 2)
            {
                CHECK (f[0]->getTextToShowWhenEmpty() == "Username" && f[1]->getTextToShowWhenEmpty() == "Password");
                // register, step 1: email + username
                acc.beginRegister(); pumpMessages (20);
                CHECK (acc.mode() == ui::Account::Mode::registerIdentity && f[0]->getTextToShowWhenEmpty() == "Email address" && f[1]->getTextToShowWhenEmpty() == "Username");
                f[0]->setText ("not-an-email"); f[1]->setText ("bugz"); f[1]->onReturnKey();
                CHECK (acc.mode() == ui::Account::Mode::registerIdentity);                    // bad email: stays on step 1
                f[0]->setText ("bugz@example.com"); f[1]->onReturnKey(); pumpMessages (20);
                // step 2: the same boxes now ask for the password twice
                CHECK (acc.mode() == ui::Account::Mode::registerPassword && f[0]->getText().isEmpty() && f[1]->getTextToShowWhenEmpty() == "Password again");
                f[0]->setText ("longenough1"); f[1]->setText ("different1"); f[1]->onReturnKey(); waitIdle();
                CHECK (! acc.loggedIn() && acc.mode() == ui::Account::Mode::registerPassword);   // mismatch refused locally
                f[1]->setText ("longenough1"); f[1]->onReturnKey(); waitIdle();
                CHECK_MSG (acc.loggedIn() && acc.username() == "bugz", "after register: " + acc.username());
                CHECK (! f[0]->isVisible());                                                      // fields give way to "Yo bugz!"
                acc.logout(); pumpMessages (30);
                CHECK (! acc.loggedIn() && f[0]->isVisible() && f[0]->getTextToShowWhenEmpty() == "Username");
                // log in: wrong, then right
                f[0]->setText ("bugz"); f[1]->setText ("nope-nope"); f[1]->onReturnKey(); waitIdle();
                CHECK (! acc.loggedIn());
                f[1]->setText ("longenough1"); f[1]->onReturnKey(); waitIdle();
                CHECK (acc.loggedIn() && acc.username() == "bugz");
                CHECK (Settings::load().get ("auth_username", "").toString() == "bugz");       // survives a restart
                acc.logout(); pumpMessages (30);
                acc.forgotPassword ("bugz"); waitIdle();
                CHECK (! acc.loggedIn());
            }
        }

        // unlinked again: BAKE writes nothing into the instrument
        model.settings().setEbysRoot ({});
        editor->refreshEbys();
        CHECK (! editor->handoffActive() && editor->ebysStatusText().startsWith ("EBYS: not found"));
        model.settings().set ("handoff_raw_uploads", true);
    }

    // ---- an empty capture is refused with a message, no dialog
    {
        GnumbatProcessor fresh;
        std::unique_ptr<juce::AudioProcessorEditor> e2 (fresh.createEditor());
        auto* ge = dynamic_cast<GnumbatEditor*> (e2.get());
        ge->beginBake();
        CHECK (! ge->dialogOpen());
    }

    // ---- editor state is written back to the processor
    editor->showTab (true);
    model.setSearch ("abc");
    ed.reset();
    CHECK (proc.getUiState ("tab").toString() == "map" && proc.getUiState ("search").toString() == "abc");
}

// ---------------------------------------------------------------------------------------------------- snapshots
static void snapshots (const juce::File& outDir, const juce::File& libRoot)
{
    outDir.createDirectory();
    setEnv ("GNUMBAT_SETTINGS", outDir.getChildFile ("settings.json").getFullPathName());
    setEnv ("GNUMBAT_LIBRARY", libRoot.getFullPathName());

    GnumbatProcessor proc;
    proc.setRateAndBufferSizeDetails (48000.0, 512);
    proc.prepareToPlay (48000.0, 512);
    FakeHost host;
    host.ppqAt0 = 64.0;
    proc.setPlayHead (&host);
    run (proc, &host, 48000 * 4, 48000 * 21, 512);
    host.hasLoop = true; host.looping = true; host.loopStart = 80.0; host.loopEnd = 96.0;   // same span the old range demo used
    run (proc, &host, 48000 * 25, 512, 512);                                                // one more block so the loop points are published
    proc.setUiState ("tab", "bank");

    std::unique_ptr<juce::AudioProcessorEditor> ed (proc.createEditor());
    auto* editor = dynamic_cast<GnumbatEditor*> (ed.get());
    editor->setSize (1280, 800);
    pumpMessages (200);
    auto& model = editor->appModel();

    auto save = [&] (const String& name)
    {
        pumpMessages (100);
        auto img = editor->createComponentSnapshot (editor->getLocalBounds(), true, 1.0f);
        juce::PNGImageFormat png;
        juce::FileOutputStream out (outDir.getChildFile (name));
        out.setPosition (0); out.truncate();
        png.writeImageToStream (img, out);
        std::cout << "  wrote " << name << " (" << img.getWidth() << "x" << img.getHeight() << ")\n";
    };

    editor->showTab (false);
    if (model.rows().size() > 3)
        model.setSelection ({ model.rows()[3].id }, model.rows()[3].id);
    save ("bank.png");

    model.setChips ({ filter::leaf ("state", "eq", "READY") });
    model.setSearch ("rise");
    model.setSelection ({});
    save ("bank_filtered.png");
    model.setSearch ({});  model.setChips ({});

    editor->showTab (true);
    editor->mapView().setColourModeByText ("first tag");
    if (model.map() != nullptr)
    {
        juce::StringArray sel;
        for (size_t i = 0; i < model.map()->points.size() && sel.size() < 6; i += 3) sel.add (model.map()->points[i].bakeId);
        model.setSelection (sel);
        model.setHover (model.map()->points[7].bakeId);
    }
    save ("map.png");
    model.setHover ({});

    // MODEL page + main page at the default window size, with the hub indicator
    {
        editor->setSize (640, 318);
        if (auto* h = editor->modelHub()) { h->syncNow(); for (int i = 0; i < 40; ++i) pumpMessages (25); }
        editor->showModelPage (true);
        save ("model_page.png");
        editor->showModelPage (false);
        save ("main_hub.png");
    }
    editor->setSize (1280, 800);
    editor->showTab (false);
    editor->beginBake();
    save ("bake_dialog.png");
}

// ---------------------------------------------------------------------------------------------------- interop through the plugin path
static void interopWrite (const juce::File& libRoot)
{
    setEnv ("GNUMBAT_SETTINGS", libRoot.getSiblingFile ("plugin_settings.json").getFullPathName());
    libRoot.deleteRecursively();
    Library::init (libRoot);
    Library lib (libRoot);

    GnumbatProcessor proc;
    FakeHost host;
    proc.setPlayHead (&host);
    proc.setRateAndBufferSizeDetails (48000.0, 512);
    proc.prepareToPlay (48000.0, 512);
    run (proc, &host, 0, 48000 * 20, 512);

    const char* notes[] = { "  rise / tension  ", "", "kick-128 BPM-4 bars" };
    for (int i = 0; i < 3; ++i)
    {
        proc.plan.mode = CapturePlan::Mode::range;
        proc.plan.in = { 48000 * (2 + 4 * i), 4.0 + 8.0 * i, true };
        proc.plan.out = { 48000 * (2 + 4 * i) + 48000 * 3, 4.0 + 8.0 * i + 6.0, true };
        auto pc = proc.prepareCapture (proc.plan);
        CHECK_MSG (pc.ok, pc.problem);
        auto nb = std::move (pc.bake);
        nb.rawNotation = notes[i];
        nb.profile = i == 2 ? notation::builtinProfile ("np_musical_dash") : notation::freeformProfile();
        nb.decomposer = "testsplit";
        nb.processParams = json::object ({ { "auto_map", i != 2 } });
        String id;
        auto r = lib.createBake (nb, id);
        CHECK_MSG (r.wasOk(), r.getErrorMessage());
    }
    std::cout << "  plugin path wrote " << lib.listBakeIds().size() << " Bakes\n";
}

static void interopVerify (const juce::File& libRoot)
{
    Library lib (libRoot);
    const auto ids_ = lib.listBakeIds();
    CHECK (ids_.size() == 3);
    const char* notes[] = { "  rise / tension  ", "", "kick-128 BPM-4 bars" };
    for (int i = 0; i < ids_.size(); ++i)
    {
        const auto st = lib.readState (ids_[i]);
        CHECK_MSG (json::getString (st, "state") == "READY", ids_[i] + " " + json::getString (st, "state") + " " + juce::JSON::toString (st.getProperty ("error", {}), true));
        CHECK (json::getString (lib.readSemantic (ids_[i]), "raw_notation") == String (notes[i]));         // verbatim through capture -> Python worker -> back
        const auto bake = lib.readBake (ids_[i]);
        CHECK (json::getNumber (bake, "capture/timeline/start_sample") == 48000 * (2 + 4 * i));
        CHECK (json::getBool (bake, "capture/complete"));
        CHECK (json::getNumber (bake, "capture/tempo_bpm") == 120.0);
        CHECK (std::abs (json::getNumber (bake, "audio/duration_s") - 3.0) < 1e-6);
        CHECK (lib.readAnalysis (ids_[i]).getDynamicObject() != nullptr);
        CHECK (lib.stemFiles (ids_[i]).size() == 4);
    }
    auto sem = lib.readSemantic (ids_[2]);
    CHECK (json::getNumber (sem, "fields/tempo") == 128 && json::getNumber (sem, "fields/duration_bars") == 4);
    CHECK (json::getStrings (lib.readSemantic (ids_[1]), "tags").isEmpty());
    std::cout << "  plugin-path Bakes verified after the Python worker\n";
}

int main (int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI gui;
    juce::File snapDir, snapLib, iw, iv;
    for (int i = 1; i < argc; ++i)
    {
        const String a (argv[i]);
        if (a == "--snapshot" && i + 2 < argc) { snapDir = juce::File (argv[i + 1]); snapLib = juce::File (argv[i + 2]); i += 2; }
        else if (a == "--interop-write" && i + 1 < argc) iw = juce::File (argv[++i]);
        else if (a == "--interop-verify" && i + 1 < argc) iv = juce::File (argv[++i]);
    }
    if (snapDir != juce::File()) snapshots (snapDir, snapLib);
    else if (iw != juce::File()) interopWrite (iw);
    else if (iv != juce::File()) interopVerify (iv);
    else
    {
        std::cout << "processor\n"; testProcessor();
        std::cout << "ui\n";        testUi();
    }
    std::cout << (g_fail == 0 ? "plugin: all tests passed" : "plugin: FAILURES") << "  (" << g_checks << " checks, " << g_fail << " failed)\n";
    return g_fail == 0 ? 0 : 1;
}
