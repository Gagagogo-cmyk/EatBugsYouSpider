#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <atomic>
#include <utility>
#include "../core/CaptureBuffer.h"
#include "../core/TimelineTape.h"
#include "../core/Library.h"

namespace gnumbat
{
    /** A position the user marked on the host timeline. Samples are host timeline samples (or, in a host
        that reports no timeline, the plugin's own running sample counter). PPQ is kept when the host gave it. */
    struct Marker
    {
        juce::int64 sample = -1;
        double ppq = 0.0;
        bool hasPpq = false;
        bool isSet() const noexcept { return sample >= 0; }
    };

    struct CapturePlan
    {
        enum class Mode { range, lastBars, loop, lastSeconds };
        // The panel only ever drives `loop`: a Bake is always exactly the host's current loop / cycle range.
        // The other modes stay implemented in prepareCapture() below (tested, and available to direct/scripted
        // use of the processor) but nothing in the shipped UI can select them any more.
        Mode mode = Mode::loop;
        Marker in, out;
        double bars = 4.0;
        double seconds = 10.0;
        static const char* modeName (Mode m) { return m == Mode::range ? "range" : m == Mode::lastBars ? "last_bars" : m == Mode::loop ? "loop" : "last_seconds"; }
    };

    /** Everything the UI needs to know about the host transport. Written by the audio thread, read by the UI
        (individual atomics: the UI tolerates a value or two being from adjacent blocks). */
    struct TransportSnapshot
    {
        bool valid = false;               // the plugin has processed at least one block
        bool hostTimeline = false;        // false => timeline is the plugin's own running counter (standalone / hosts without a playhead)
        bool playing = false, recording = false, looping = false, offline = false, hasLoop = false;
        juce::int64 samples = -1;         // current timeline position
        bool hasPpq = false;  double ppq = 0.0;
        double bpm = 0.0;     int tsNum = 0, tsDen = 0;
        double loopStartPpq = 0.0, loopEndPpq = 0.0;
        double sampleRate = 0.0;
        juce::int64 written = 0;          // total samples pushed into the ring
        double level[2] = { 0.0, 0.0 };   // recent peak per channel, linear
    };

    struct PreparedCapture
    {
        bool ok = false;
        juce::String problem;             // why not ok
        NewBake bake;                     // audio + capture meta filled in; notation is added by the caller
        double coverage = 0.0;            // fraction of the requested span that was actually heard
        double seconds = 0.0;
        juce::String summary;             // "8.00 s · bars 17–21 · 100 %"
    };

    /** Tracks, in absolute host-timeline sample coordinates, every span that has actually been
        played through the plugin -- independent of the capture ring's own fixed-size rolling
        window. CaptureBuffer can only physically hold `ringSeconds` of actual audio, so coverage
        computed from what's still resident there forgets earlier passes the moment the ring
        wraps past them: a loop (or any queried range) longer than the ring, or just played for
        longer than the ring holds, would visibly "un-hear" itself as playback continued. This
        holds no audio at all, just a small, bounded list of played [start,end) runs, so it can
        answer "how much of THIS range was heard" for any range at all -- the live UI's current
        loop, or (as the tests exercise) an arbitrary manually-specified range -- for as long as
        the processor lives, not just while a particular loop stays selected. */
    struct HeardTracker
    {
        struct Interval { juce::int64 start = 0, end = 0; };

        static constexpr int kMaxIntervals = 4096;
        std::atomic<juce::int64> starts[kMaxIntervals] {};
        std::atomic<juce::int64> ends[kMaxIntervals] {};
        std::atomic<int> count { 0 };
        int current = -1;   // audio thread only: the run the playhead is currently extending

        /** Audio thread only, single producer, wait-free: records [blockStart, blockStart +
            numSamples) as played. Continuous playback extends the run the playhead is currently
            in. A jump (stop + play elsewhere, a loop wrap, a seek) looks for an existing run the
            new position lands inside/at the end of and continues THAT one, otherwise appends a
            new run -- so cycling a loop or stop/starting inside an already-heard zone doesn't
            burn a new entry every time. (The old version only compared against the most recent
            run's END, so jumping BACKWARDS -- e.g. playing from the start of the selection after
            having already heard a later part -- was mistaken for "overlapping", and nothing was
            recorded until the playhead passed the old run's end again.) Overlaps between runs
            are left for the reader to merge. */
        void noteBlock (juce::int64 blockStart, int numSamples) noexcept;
        /** Only on prepareToPlay with a new sample rate (sample positions stop meaning the same
            thing) -- changing the loop/time selection does NOT reset: heard history is kept for the
            whole session, and each selection simply queries its own range out of it. */
        void reset() noexcept;
        // Message/UI thread. Clips and merges the recorded runs against [a, b) on demand, so any
        // range can be queried -- the live UI's current loop bounds, or an arbitrary range.
        double coverageOf (juce::int64 a, juce::int64 b) const;
        std::vector<std::pair<double, double>> fractionsOf (juce::int64 a, juce::int64 b) const;
        /** The heard runs clipped to [a, b), merged, ascending (absolute positions). */
        std::vector<Interval> intervalsOf (juce::int64 a, juce::int64 b) const { return mergedClipped (a, b); }

    private:
        std::vector<Interval> mergedClipped (juce::int64 a, juce::int64 b) const;
    };

    /** The host's current loop / time selection as it sits on the TimelineTape -- what the heard
        bar draws and what a loop Bake exports. Start/end come straight from the host's own loop
        ppq points through the tape's one ppq->position formula, so the bar is always exactly the
        selection: same start, same length, no drift. */
    struct SelectionState
    {
        bool ok = false;
        double startPpq = 0.0, endPpq = 0.0;
        juce::int64 start = 0, end = 0;          // tape positions (samples at the tape's tempo)
        double seconds = 0.0;
        double coverage = 0.0;                   // fraction of the selection whose audio is on the tape
        std::vector<std::pair<double, double>> fractions;   // where, as (start, end) fractions of the selection
        bool complete = false;                   // the whole selection counts as heard (coverage == 1)
        std::vector<std::pair<juce::int64, juce::int64>> spans;   // heard spans after sliver-merging (tape positions)
        bool tapeFull = false;                   // memory cap reached: newly played audio isn't being kept
    };

    class GnumbatProcessor final : public juce::AudioProcessor
    {
    public:
        GnumbatProcessor();
        ~GnumbatProcessor() override = default;

        // ---- AudioProcessor
        void prepareToPlay (double sampleRate, int samplesPerBlock) override;
        void releaseResources() override {}
        bool isBusesLayoutSupported (const BusesLayout&) const override;
        void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
        using AudioProcessor::processBlock;
        juce::AudioProcessorEditor* createEditor() override;
        bool hasEditor() const override { return true; }
        const juce::String getName() const override { return "M-RLCF"; }
        bool acceptsMidi() const override { return false; }
        bool producesMidi() const override { return false; }
        double getTailLengthSeconds() const override { return 0.0; }
        int getNumPrograms() override { return 1; }
        int getCurrentProgram() override { return 0; }
        void setCurrentProgram (int) override {}
        const juce::String getProgramName (int) override { return {}; }
        void changeProgramName (int, const juce::String&) override {}
        void getStateInformation (juce::MemoryBlock&) override;
        void setStateInformation (const void*, int) override;
        void updateTrackProperties (const TrackProperties&) override;

        // ---- for the UI (message thread)
        TransportSnapshot transport() const;
        juce::String hostName() const;
        juce::String trackName() const;
        bool isStandalone() const { return wrapperType == wrapperType_Standalone; }
        const CaptureBuffer& ring() const noexcept { return capture; }

        /** Take a snapshot of the audio the plan describes. Copies out of the ring; call on the message thread. */
        PreparedCapture prepareCapture (const CapturePlan&) const;

        /** Marker at the current transport position (unset if nothing has been processed yet). */
        Marker markerNow() const;
        /** Convert a bar count / beat count to samples with the current tempo (constant-tempo assumption). */
        juce::int64 samplesForBeats (double beats) const;
        /** Host loop range as markers. The sample bounds are derived once per distinct pair of
            loop ppq points and cached (see the fields below) -- not re-derived from the current
            transport position on every call, which used to let floating-point rounding move the
            reported start/end by a sample or two tick to tick even while the loop itself stayed
            put. False if the host has no loop. */
        bool loopMarkers (Marker& start, Marker& end) const;
        /** Fraction of [in,out] that has been heard (0..1); the coverage bar in the UI. */
        double coverageOf (const Marker& in, const Marker& out) const;
        /** The actually-heard sub-ranges of [in,out), each as a (startFraction, endFraction) pair
            relative to that span -- so the UI can draw *where* within the range audio was heard
            (e.g. "first 5 s" and "last 5 s" as two separate filled zones with a gap between them)
            instead of collapsing everything into one left-aligned fill. Ascending, non-overlapping,
            empty if the range is invalid or nothing has been captured yet. */
        std::vector<std::pair<double, double>> coveredFractionsOf (const Marker& in, const Marker& out) const;
        /** The host loop on the TimelineTape: exact bounds + how much of its audio is in memory. */
        SelectionState selection() const;
        /** Diagnostics: writes the selection's raw heard runs, gaps and transport details to `f`
            (used when the bar stalls short of 100 %, see CapturePanel::timerCallback). */
        void writeHeardDebug (const juce::File& f) const;

        // ---- persisted UI/session state (JSON object). Audio itself is never persisted.
        CapturePlan plan;
        juce::var uiState() const;
        void setUiState (const juce::String& key, const juce::var& value);
        juce::var getUiState (const juce::String& key, const juce::var& fallback = {}) const;

        static constexpr int kMaxCaptureChannels = 2;

    private:
        CaptureBuffer capture;
        double preparedRate = 0.0;
        int preparedChannels = 0;
        double preparedRing = 0.0;
        double ringSeconds = 120.0;
        const juce::String sessionId;

        // audio-thread -> UI mailbox
        std::atomic<bool> tValid { false }, tHostTimeline { false }, tPlaying { false }, tRecording { false }, tLooping { false }, tOffline { false }, tHasLoop { false }, tHasPpq { false };
        std::atomic<juce::int64> tSamples { -1 };
        std::atomic<double> tPpq { 0.0 }, tBpm { 0.0 }, tLoopStart { 0.0 }, tLoopEnd { 0.0 }, tSampleRate { 0.0 };
        // Host timeline sample position of ppq 0, computed on the audio thread from ONE block's
        // (timeInSamples, ppq, bpm) triple -- a single atomic, so loopMarkers() can map the loop's
        // ppq points onto the same sample timeline HeardTracker records in without tearing. Deriving
        // it on the UI thread from tSamples + tPpq (two separate atomics that can come from
        // different blocks) could put the loop a whole block (~512 samples) off, and the cache
        // then kept that wrong offset for as long as the loop stayed put.
        std::atomic<double> tAnchor { 0.0 };
        std::atomic<bool> tAnchorValid { false };
        std::atomic<int> tNum { 0 }, tDen { 0 };
        std::atomic<float> level[2] { { 0.0f }, { 0.0f } };
        juce::int64 ownTimeline = 0;                    // audio thread only
        // Session-long heard history in host-timeline samples. Never reset by a selection change:
        // what was heard stays heard, whichever loop/time selection is queried afterwards.
        HeardTracker heardTracker;

        // The TimelineTape (see core/TimelineTape.h) and what's been stored on it, in tape positions.
        // This -- not heardTracker/the ring -- is what the heard bar and a loop Bake use.
        TimelineTape tape;
        HeardTracker tapeHeard;
        static constexpr double kTapeMaxSeconds = 20.0 * 60.0;   // same 20-minute ceiling as imports
        double tapeBpm = 0.0, tapeRate = 0.0;                    // audio thread only
        juce::int64 tapeLastEnd = -1;                            // audio thread only
        std::atomic<double> tTapeBpm { 0.0 }, tTapeRate { 0.0 };
        std::atomic<int> tMaxBlock { 0 };
        // diagnostics (audio thread writes, UI reads)
        std::atomic<int> dSplits { 0 }, dSnaps { 0 }, dJumps { 0 };
        std::atomic<juce::int64> dMaxSnapMiss { 0 }, dLastPos { 0 };
        std::atomic<double> dLastPpq { 0.0 }, dHostBpm { 0.0 };
        std::atomic<bool> dLooping { false };                        // largest host block seen (edge tolerance, see selection())
        struct TapeTopUp : juce::Timer { TimelineTape* t = nullptr; void timerCallback() override { if (t != nullptr) t->topUp(); } } tapeTopUp;
        // loopMarkers()'s cache -- message thread only (every call site is UI/message-thread),
        // so no lock is needed. Keyed by the loop's own ppq bounds (a fixed choice the user
        // made), never by the derived sample bounds, which is exactly what must NOT be allowed
        // to trigger a recompute -- see loopMarkers()'s doc comment above.
        mutable double cachedLoopStartPpq = -1.0, cachedLoopEndPpq = -1.0;
        mutable juce::int64 cachedLoopStartSample = 0, cachedLoopEndSample = 0;
        mutable double cachedAnchor = 0.0, cachedBpm = 0.0;
        mutable bool cachedLoopValid = false;

        mutable juce::CriticalSection metaLock;         // message thread only
        juce::String track;
        juce::var ui = juce::var (new juce::DynamicObject());

        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GnumbatProcessor)
    };
}
