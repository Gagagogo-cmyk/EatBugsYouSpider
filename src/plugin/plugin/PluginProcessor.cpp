#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "../core/Ids.h"
#include "../core/JsonIo.h"
#include "../core/Settings.h"
#include <algorithm>
#include <cmath>

#ifndef GNUMBAT_VERSION
 #define GNUMBAT_VERSION "0.1.0"
#endif

namespace gnumbat
{
    void HeardTracker::noteBlock (juce::int64 blockStart, int numSamples) noexcept
    {
        if (blockStart < 0 || numSamples <= 0) return;
        const juce::int64 blockEnd = blockStart + numSamples;
        const int n = count.load (std::memory_order_relaxed);

        auto extend = [this, blockEnd] (int i)
        {
            if (blockEnd > ends[i].load (std::memory_order_relaxed))
                ends[i].store (blockEnd, std::memory_order_release);
            current = i;
        };

        // Common case: continuous playback -- the block starts inside (or right at the end of)
        // the run the playhead is already in. Must check the START too: a backwards jump lands
        // before that run and is NOT a continuation of it.
        if (current >= 0 && current < n
            && blockStart >= starts[current].load (std::memory_order_relaxed)
            && blockStart <= ends[current].load (std::memory_order_relaxed))
        {
            extend (current);
            return;
        }

        // A jump: continue any run this position already sits inside / at the end of (a loop
        // wrap back to its start, stop and play again from an already-heard spot) ...
        for (int i = n - 1; i >= 0; --i)
            if (blockStart >= starts[i].load (std::memory_order_relaxed)
                && blockStart <= ends[i].load (std::memory_order_relaxed))
            {
                extend (i);
                return;
            }

        // ... otherwise it's somewhere never heard before: a new run.
        if (n >= kMaxIntervals)
        {
            // Vanishingly unlikely (thousands of disjoint, never-revisited spots in one session):
            // drop the oldest run rather than allocating or blocking.
            for (int i = 1; i < kMaxIntervals; ++i)
            {
                starts[i - 1].store (starts[i].load (std::memory_order_relaxed), std::memory_order_relaxed);
                ends[i - 1].store (ends[i].load (std::memory_order_relaxed), std::memory_order_relaxed);
            }
            starts[kMaxIntervals - 1].store (blockStart, std::memory_order_relaxed);
            ends[kMaxIntervals - 1].store (blockEnd, std::memory_order_release);
            current = kMaxIntervals - 1;
            return;
        }

        starts[n].store (blockStart, std::memory_order_relaxed);
        ends[n].store (blockEnd, std::memory_order_release);
        count.store (n + 1, std::memory_order_release);
        current = n;
    }

    void HeardTracker::reset() noexcept
    {
        count.store (0, std::memory_order_relaxed);
        current = -1;
    }

    std::vector<HeardTracker::Interval> HeardTracker::mergedClipped (juce::int64 a, juce::int64 b) const
    {
        std::vector<Interval> v;
        const int n = count.load (std::memory_order_acquire);
        v.reserve ((size_t) n);
        for (int i = 0; i < n; ++i)
        {
            const juce::int64 s = juce::jmax (a, starts[i].load (std::memory_order_relaxed));
            const juce::int64 e = juce::jmin (b, ends[i].load (std::memory_order_relaxed));
            if (e > s) v.push_back ({ s, e });
        }
        std::sort (v.begin(), v.end(), [] (const Interval& x, const Interval& y) { return x.start < y.start; });

        std::vector<Interval> merged;
        merged.reserve (v.size());
        for (auto& iv : v)
        {
            if (! merged.empty() && iv.start <= merged.back().end)
                merged.back().end = juce::jmax (merged.back().end, iv.end);
            else
                merged.push_back (iv);
        }
        return merged;
    }

    double HeardTracker::coverageOf (juce::int64 a, juce::int64 b) const
    {
        if (b <= a) return 0.0;
        juce::int64 covered = 0;
        for (auto& iv : mergedClipped (a, b)) covered += (iv.end - iv.start);
        return juce::jlimit (0.0, 1.0, (double) covered / (double) (b - a));
    }

    std::vector<std::pair<double, double>> HeardTracker::fractionsOf (juce::int64 a, juce::int64 b) const
    {
        std::vector<std::pair<double, double>> out;
        if (b <= a) return out;
        const double len = (double) (b - a);
        for (auto& iv : mergedClipped (a, b))
            out.emplace_back ((double) (iv.start - a) / len, (double) (iv.end - a) / len);
        return out;
    }

    GnumbatProcessor::GnumbatProcessor()
        : AudioProcessor (BusesProperties().withInput ("Input", juce::AudioChannelSet::stereo(), true)
                                           .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
          sessionId (ids::ulid())
    {
        ringSeconds = Settings::load().ringSeconds();
        tapeTopUp.t = &tape;
        tapeTopUp.startTimerHz (4);   // keeps spare tape chunks ready so the audio thread never allocates
    }

    bool GnumbatProcessor::isBusesLayoutSupported (const BusesLayout& l) const
    {
        // A transparent tap: output layout == input layout, mono or stereo.
        const auto in = l.getMainInputChannelSet(), out = l.getMainOutputChannelSet();
        return in == out && (in == juce::AudioChannelSet::mono() || in == juce::AudioChannelSet::stereo());
    }

    void GnumbatProcessor::prepareToPlay (double sampleRate, int)
    {
        const int nch = juce::jlimit (1, kMaxCaptureChannels, getTotalNumInputChannels());
        // Hosts call prepareToPlay on every transport start; only rebuild (= discard captured audio) when something changed.
        if (! capture.isPrepared() || std::abs (preparedRate - sampleRate) > 0.5 || preparedChannels != nch || std::abs (preparedRing - ringSeconds) > 0.5)
        {
            capture.prepare (sampleRate, nch, ringSeconds);
            preparedRate = sampleRate;  preparedChannels = nch;  preparedRing = ringSeconds;
            ownTimeline = 0;
            heardTracker.reset();   // a fresh capture session starts fresh coverage too
            tape.prepare (sampleRate, nch, kTapeMaxSeconds);
            tapeHeard.reset();
            tapeBpm = 0.0; tapeRate = 0.0; tapeLastEnd = -1;
            tTapeBpm.store (0.0); tTapeRate.store (0.0);
            cachedLoopValid = false;   // stale sample bounds from the old sample rate
        }
        tSampleRate.store (sampleRate, std::memory_order_relaxed);
    }

    void GnumbatProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
    {
        juce::ScopedNoDenormals noDenormals;
        const int n = buffer.getNumSamples();
        if (n > tMaxBlock.load (std::memory_order_relaxed)) tMaxBlock.store (n, std::memory_order_relaxed);
        const int inCh = juce::jmin (getTotalNumInputChannels(), buffer.getNumChannels());

        // ---- host transport (RT-safe reads of the play head; nothing allocates)
        bool playing = false, recording = false, looping = false, hasLoop = false, hasPpq = false, hostTimeline = false;
        juce::int64 timeSamples = -1;
        double ppq = 0.0, bpm = 0.0, loopStart = 0.0, loopEnd = 0.0;
        int num = 0, den = 0;

        if (auto* ph = getPlayHead())
            if (auto pos = ph->getPosition())
            {
                playing = pos->getIsPlaying();
                recording = pos->getIsRecording();
                looping = pos->getIsLooping();
                if (auto t = pos->getTimeInSamples()) { timeSamples = *t; hostTimeline = true; }
                if (auto p = pos->getPpqPosition()) { ppq = *p; hasPpq = true; }
                if (auto b = pos->getBpm()) bpm = *b;
                if (auto ts = pos->getTimeSignature()) { num = ts->numerator; den = ts->denominator; }
                if (auto lp = pos->getLoopPoints()) { loopStart = lp->ppqStart; loopEnd = lp->ppqEnd; hasLoop = lp->ppqEnd > lp->ppqStart; }
            }

        // Timeline addressing: with a host timeline only PLAYING blocks are addressable (a stopped transport
        // repeats the same position). Without one, the plugin counts its own samples so range capture still works.
        juce::int64 tl = -1;
        if (hostTimeline) tl = playing ? timeSamples : -1;
        else { tl = ownTimeline; timeSamples = ownTimeline; }
        ownTimeline += n;

        if (inCh > 0)
            capture.push (buffer.getArrayOfReadPointers(), inCh, n, tl);

        // Coverage tracking is independent of the ring's own fixed-size storage above (see
        // HeardTracker's doc comment) -- fed from the same addressable position, so it only
        // marks positions that were actually played, exactly like the ring push does. Unlike the
        // ring, it isn't limited to loop playback: any addressable position counts, so an
        // arbitrary queried range (not just the host's current loop) accumulates heard history too.
        if (tl >= 0)
            heardTracker.noteBlock (tl, n);

        // ---- the TimelineTape: store this block's actual audio at its MUSICAL position (the host's
        // own ppq for this block), so whatever order the timeline is played in, each section lands
        // in exactly one place and stays in memory. Only while the host is really playing.
        if (hostTimeline && playing && hasPpq && bpm > 0.0 && ppq >= 0.0 && inCh > 0 && tape.isPrepared())
        {
            const double rate = juce::jmax (1.0, getSampleRate());
            // Only a REAL tempo change restarts the tape. Hosts report bpm with a little float
            // jitter block to block; that must never wipe what's been heard. Positions always use
            // the tape's own fixed tempo (tapeBpm), never the block's jittery value, so the
            // selection (mapped with the same tapeBpm in selection()) and the stored audio agree.
            if (tapeBpm <= 0.0 || std::abs (bpm - tapeBpm) > 0.01 || std::abs (rate - tapeRate) > 0.5)
            {
                tape.clear(); tapeHeard.reset();
                tapeBpm = bpm; tapeRate = rate; tapeLastEnd = -1;
                tTapeBpm.store (bpm, std::memory_order_relaxed);
                tTapeRate.store (rate, std::memory_order_relaxed);
            }
            const double spb = 60.0 / tapeBpm * rate;
            const float* const* src = buffer.getArrayOfReadPointers();

            auto store = [&] (const float* const* chans, int count, juce::int64 at)
            {
                // Continuous playback: this block's ppq can round a sample either side of where the
                // previous one ended -- snap so runs stay seamless (bounded to 2 samples; every block
                // re-anchors on the host's own ppq, so nothing accumulates).
                // Tolerance: an eighth of a block (min 2 samples) -- a host's ppq and this tape's
                // position maths can disagree by more than a sample or two at block edges and loop
                // wraps, and anything that small is rounding, never a real seek.
                if (tapeLastEnd >= 0)
                {
                    const auto miss = std::llabs (at - tapeLastEnd);
                    if (miss <= juce::jmax<juce::int64> (2, count / 8)) { at = tapeLastEnd; dSnaps.fetch_add (1, std::memory_order_relaxed); }
                    else dJumps.fetch_add (1, std::memory_order_relaxed);
                    if (miss < 4096 && miss > dMaxSnapMiss.load (std::memory_order_relaxed)) dMaxSnapMiss.store (miss, std::memory_order_relaxed);
                }
                const int stored = tape.write (chans, inCh, count, at);
                if (stored > 0) tapeHeard.noteBlock (at, stored);
                tapeLastEnd = at + count;
            };

            const auto pos = (juce::int64) std::llround (ppq * spb);
            // A cycling host often hands over one block that straddles the loop end: its tail is
            // really the START of the loop again. Filed past the loop end (as before), the first
            // few ms of the selection were never recorded on any pass -- which is why the bar
            // could sit at 99 % forever. Split it: head up to the loop end, tail at the loop start.
            // (loopEnd * spb is exactly where selection() puts the selection's end.)
            const juce::int64 cut = (looping && hasLoop && ppq < loopEnd)
                                      ? (juce::int64) std::llround (loopEnd * spb) - pos
                                      : (juce::int64) n;
            dLastPpq.store (ppq, std::memory_order_relaxed);
            dLastPos.store (pos, std::memory_order_relaxed);
            dHostBpm.store (bpm, std::memory_order_relaxed);
            dLooping.store (looping, std::memory_order_relaxed);
            if (cut > 0 && cut < n)
            {
                dSplits.fetch_add (1, std::memory_order_relaxed);
                store (src, (int) cut, pos);
                const float* tail[kMaxCaptureChannels] = {};
                for (int c = 0; c < inCh && c < kMaxCaptureChannels; ++c) tail[c] = src[c] + cut;
                tapeLastEnd = -1;   // a wrap is a jump, never a continuation
                store (tail, n - (int) cut, (juce::int64) std::llround (juce::jmax (0.0, loopStart) * spb));
            }
            else
            {
                store (src, n, pos);
            }
        }
        else
        {
            tapeLastEnd = -1;
        }

        // ---- pass-through (in place): nothing to do for shared channels; silence any extra outputs
        for (int c = getTotalNumInputChannels(); c < getTotalNumOutputChannels(); ++c)
            buffer.clear (c, 0, n);

        // ---- meters (decaying peak)
        for (int c = 0; c < juce::jmin (2, inCh); ++c)
        {
            const float pk = buffer.getMagnitude (c, 0, n);
            const float prev = level[c].load (std::memory_order_relaxed);
            level[c].store (pk > prev ? pk : prev * std::pow (0.5f, (float) n / (float) juce::jmax (1.0, getSampleRate() * 0.25)), std::memory_order_relaxed);
        }

        // ---- mailbox to the UI
        tHostTimeline.store (hostTimeline, std::memory_order_relaxed);
        tPlaying.store (hostTimeline ? playing : true, std::memory_order_relaxed);
        tRecording.store (recording, std::memory_order_relaxed);
        tLooping.store (looping, std::memory_order_relaxed);
        tOffline.store (isNonRealtime(), std::memory_order_relaxed);
        tHasLoop.store (hasLoop, std::memory_order_relaxed);
        tHasPpq.store (hasPpq, std::memory_order_relaxed);
        // "now" = the END of this block: a marker set from it points at audio that has already been captured
        const double sr = juce::jmax (1.0, getSampleRate());
        tSamples.store (hostTimeline ? timeSamples + (playing ? n : 0) : ownTimeline, std::memory_order_relaxed);
        tPpq.store (playing && bpm > 0.0 ? ppq + (double) n / sr * bpm / 60.0 : ppq, std::memory_order_relaxed);
        tBpm.store (bpm, std::memory_order_relaxed);
        tNum.store (num, std::memory_order_relaxed);
        tDen.store (den, std::memory_order_relaxed);
        tLoopStart.store (loopStart, std::memory_order_relaxed);
        tLoopEnd.store (loopEnd, std::memory_order_relaxed);
        if (hostTimeline && hasPpq && bpm > 0.0)
        {
            // ppq and timeInSamples both describe the START of this block, so this pair is
            // self-consistent (unlike tSamples/tPpq read separately on the UI thread).
            tAnchor.store ((double) timeSamples - ppq * 60.0 / bpm * sr, std::memory_order_relaxed);
            tAnchorValid.store (true, std::memory_order_relaxed);
        }
        tValid.store (true, std::memory_order_release);
    }

    // ---------------------------------------------------------------------------------------- UI-facing
    TransportSnapshot GnumbatProcessor::transport() const
    {
        TransportSnapshot t;
        t.valid = tValid.load (std::memory_order_acquire);
        t.hostTimeline = tHostTimeline.load (std::memory_order_relaxed);
        t.playing = tPlaying.load (std::memory_order_relaxed);
        t.recording = tRecording.load (std::memory_order_relaxed);
        t.looping = tLooping.load (std::memory_order_relaxed);
        t.offline = tOffline.load (std::memory_order_relaxed);
        t.hasLoop = tHasLoop.load (std::memory_order_relaxed);
        t.samples = tSamples.load (std::memory_order_relaxed);
        t.hasPpq = tHasPpq.load (std::memory_order_relaxed);
        t.ppq = tPpq.load (std::memory_order_relaxed);
        t.bpm = tBpm.load (std::memory_order_relaxed);
        t.tsNum = tNum.load (std::memory_order_relaxed);
        t.tsDen = tDen.load (std::memory_order_relaxed);
        t.loopStartPpq = tLoopStart.load (std::memory_order_relaxed);
        t.loopEndPpq = tLoopEnd.load (std::memory_order_relaxed);
        t.sampleRate = capture.isPrepared() ? capture.sampleRate() : tSampleRate.load (std::memory_order_relaxed);
        t.written = capture.totalWritten();
        t.level[0] = level[0].load (std::memory_order_relaxed);
        t.level[1] = level[1].load (std::memory_order_relaxed);
        return t;
    }

    juce::String GnumbatProcessor::hostName() const
    {
        if (isStandalone()) return "Standalone";
        const juce::String d (juce::PluginHostType().getHostDescription());
        return d.isEmpty() || d == "Unknown" ? juce::String ("Unknown host") : d;
    }

    juce::String GnumbatProcessor::trackName() const { const juce::ScopedLock sl (metaLock); return track; }

    void GnumbatProcessor::updateTrackProperties (const TrackProperties& p)
    {
        const juce::ScopedLock sl (metaLock);
        track = p.name.value_or (juce::String());
    }

    Marker GnumbatProcessor::markerNow() const
    {
        const auto t = transport();
        Marker m;
        if (! t.valid || t.samples < 0) return m;
        m.sample = t.samples; m.ppq = t.ppq; m.hasPpq = t.hasPpq;
        return m;
    }

    juce::int64 GnumbatProcessor::samplesForBeats (double beats) const
    {
        const auto t = transport();
        const double bpm = t.bpm > 0.0 ? t.bpm : 120.0;
        return (juce::int64) std::llround (beats * 60.0 / bpm * juce::jmax (1.0, t.sampleRate));
    }

    bool GnumbatProcessor::loopMarkers (Marker& a, Marker& b) const
    {
        const auto t = transport();
        if (! t.valid || ! t.hasLoop || ! t.hasPpq || t.samples < 0 || t.bpm <= 0.0) return false;

        // Only re-derive the sample bounds when the loop's own ppq points actually changed --
        // compared with a tolerance, not exact equality. Re-deriving them fresh on every call
        // (anchoring on wherever the transport happens to be *right now* and walking to the loop
        // points at the current tempo) used to let floating-point rounding on that extrapolation
        // move the reported start/end by a sample or two tick to tick even though the loop itself
        // never moved. Comparing the host's own loopStartPpq/loopEndPpq with exact `!=` was meant
        // to fix that, but most hosts re-derive ppq loop points from their own internally-stored
        // sample/time bounds on every query, so the reported ppq carries its own sub-beat jitter
        // even when the loop truly hasn't moved -- exact equality kept failing and the cache kept
        // invalidating and recomputing anyway, which is exactly why only the far side of the
        // loop (well clear of the boundary) ever looked stable: a boundary that's still silently
        // shifting a sample or so every tick clips a "heard" run right at its own edge
        // differently call to call, so only the first sliver near loop start ever visibly
        // flickered in and out of "heard". The tolerance below is a couple of samples' worth of
        // ppq -- comfortably past that host-side noise floor, but still far tighter than any
        // deliberate loop-boundary drag, so a real change is still caught immediately.
        if (! tAnchorValid.load (std::memory_order_relaxed)) return false;
        const double anchor = tAnchor.load (std::memory_order_relaxed);
        const double sPerBeat = 60.0 / t.bpm * t.sampleRate;
        const double loopPpqEps = sPerBeat > 0.0 ? 2.0 / sPerBeat : 1.0e-6;
        // Re-derive only when something that actually moves the loop on the sample timeline
        // changed: its own ppq points (with a tolerance -- hosts re-derive them from internal
        // sample bounds on every query, so they carry a little sub-sample jitter), the tempo, or
        // the timeline's ppq<->sample anchor (a tempo change earlier in the song, a host that
        // re-bases its sample counter). A wrong cached value is never kept just because the
        // loop's ppq points stayed put.
        if (! cachedLoopValid
            || std::abs (t.loopStartPpq - cachedLoopStartPpq) > loopPpqEps
            || std::abs (t.loopEndPpq - cachedLoopEndPpq) > loopPpqEps
            || std::abs (t.bpm - cachedBpm) > 1.0e-6
            || std::abs (anchor - cachedAnchor) > 2.0)
        {
            // Clamped to 0: a loop at the very start of the timeline can round a sample or two
            // negative, and there's no negative sample to capture.
            const auto s0 = juce::jmax<juce::int64> (0, (juce::int64) std::llround (anchor + t.loopStartPpq * sPerBeat));
            const auto s1 = juce::jmax<juce::int64> (0, (juce::int64) std::llround (anchor + t.loopEndPpq * sPerBeat));
            if (s1 <= s0) { cachedLoopValid = false; return false; }
            // No heardTracker.reset() here any more: a new selection just queries its own range
            // out of the session-long history, so anything already heard inside it shows up.
            cachedLoopStartSample = s0; cachedLoopEndSample = s1;
            cachedLoopStartPpq = t.loopStartPpq; cachedLoopEndPpq = t.loopEndPpq;
            cachedBpm = t.bpm; cachedAnchor = anchor;
            cachedLoopValid = true;
        }

        a.sample = cachedLoopStartSample; b.sample = cachedLoopEndSample;
        a.ppq = t.loopStartPpq; b.ppq = t.loopEndPpq; a.hasPpq = b.hasPpq = true;
        return true;
    }

    // Both of these read HeardTracker now, not the capture ring's own (fixed-size, rolling)
    // segment table -- `in`/`out` still gate on being a valid, non-empty range (the same
    // contract callers already rely on), but the actual "how much of it has been heard" data no
    // longer forgets earlier passes just because the ring physically overwrote that audio. What
    // can still be *exported* as a Bake's audio is a separate question -- prepareCapture() below
    // is unchanged, and still depends on what the ring actually, physically holds.
    double GnumbatProcessor::coverageOf (const Marker& in, const Marker& out) const
    {
        if (! in.isSet() || ! out.isSet() || out.sample <= in.sample) return 0.0;
        return heardTracker.coverageOf (in.sample, out.sample);
    }

    std::vector<std::pair<double, double>> GnumbatProcessor::coveredFractionsOf (const Marker& in, const Marker& out) const
    {
        if (! in.isSet() || ! out.isSet() || out.sample <= in.sample) return {};
        return heardTracker.fractionsOf (in.sample, out.sample);
    }

    SelectionState GnumbatProcessor::selection() const
    {
        SelectionState st;
        const auto t = transport();
        if (! t.valid || ! t.hasLoop || ! t.hasPpq) return st;
        double bpm = tTapeBpm.load (std::memory_order_relaxed), rate = tTapeRate.load (std::memory_order_relaxed);
        if (bpm <= 0.0) bpm = t.bpm;
        if (rate <= 0.0) rate = t.sampleRate;
        if (bpm <= 0.0 || rate <= 0.0) return st;
        const double spb = 60.0 / bpm * rate;
        st.startPpq = juce::jmax (0.0, t.loopStartPpq);
        st.endPpq = t.loopEndPpq;
        // The exact formula processBlock() uses to place audio on the tape.
        st.start = (juce::int64) std::llround (st.startPpq * spb);
        st.end = (juce::int64) std::llround (st.endPpq * spb);
        if (st.end <= st.start) return st;
        st.seconds = (double) (st.end - st.start) / rate;
        // Hosts wrap a cycling loop (and start/stop playback) on their own audio-block grid, so
        // the last (or first) few ms of a selection can simply never be played by the host at all
        // -- a sliver of up to one block that no amount of looping will ever fill, leaving the bar
        // stuck a few pixels short. A gap no longer than one host block touching either EDGE of the
        // selection therefore counts as heard (it stays silence in the Bake). Gaps anywhere else,
        // or longer than a block, are real and stay unheard.
        auto iv = tapeHeard.intervalsOf (st.start, st.end);
        const int maxBlock = tMaxBlock.load (std::memory_order_relaxed);
        const juce::int64 tol = juce::jmax (64, maxBlock);
        // Edges get more room than the interior: hosts jump back from a cycling loop's end on
        // their own schedule. Measured in REAPER (96 kHz, 512-sample blocks): every pass wrapped
        // ~1070 samples (~11 ms, two blocks) before the loop end, so the last sliver is never
        // played through the plugin at all -- with a one-block tolerance the bar sat at 99.88 %
        // forever. Allow the larger of four blocks or 50 ms at either edge: imperceptible, and
        // far below any gap left by genuinely not playing part of the selection.
        const juce::int64 edgeTol = juce::jmax<juce::int64> (4 * (juce::int64) juce::jmax (64, maxBlock),
                                                            (juce::int64) std::llround (0.05 * rate));
        // Slivers shorter than one host block, anywhere, are rounding between the host's ppq and
        // the tape's position maths (block edges, loop wraps) -- never a real seek, which always
        // skips far more than a block. Merge them, so a fully played selection reads 100 %.
        std::vector<HeardTracker::Interval> merged;
        for (auto& r : iv)
        {
            if (! merged.empty() && r.start - merged.back().end <= tol) merged.back().end = juce::jmax (merged.back().end, r.end);
            else merged.push_back (r);
        }
        if (! merged.empty())
        {
            if (merged.front().start - st.start <= edgeTol) merged.front().start = st.start;
            if (st.end - merged.back().end <= edgeTol)     merged.back().end = st.end;
        }
        juce::int64 covered = 0;
        const double len = (double) (st.end - st.start);
        for (auto& r : merged)
        {
            covered += r.end - r.start;
            st.spans.emplace_back (r.start, r.end);
            st.fractions.emplace_back ((double) (r.start - st.start) / len, (double) (r.end - st.start) / len);
        }
        st.coverage = juce::jlimit (0.0, 1.0, (double) covered / len);
        st.complete = covered >= (st.end - st.start);
        st.tapeFull = tape.full();
        st.ok = true;
        return st;
    }

    void GnumbatProcessor::writeHeardDebug (const juce::File& f) const
    {
        const auto t = transport();
        const auto sel = selection();
        juce::String o;
        o << juce::Time::getCurrentTime().toISO8601 (true) << "  host=" << hostName() << "\n";
        o << "loop ppq " << juce::String (t.loopStartPpq, 6) << " .. " << juce::String (t.loopEndPpq, 6) << "  hasLoop=" << (int) t.hasLoop
          << "  looping(block)=" << (int) dLooping.load() << "  playing=" << (int) t.playing << "\n";
        o << "bpm host=" << juce::String (dHostBpm.load(), 6) << " tape=" << juce::String (tTapeBpm.load(), 6) << "  rate=" << tTapeRate.load()
          << "  maxBlock=" << tMaxBlock.load() << "\n";
        o << "selection tape pos " << sel.start << " .. " << sel.end << " (" << (sel.end - sel.start) << " samples)  coverage=" << juce::String (sel.coverage, 8)
          << "  complete=" << (int) sel.complete << "\n";
        o << "splits=" << dSplits.load() << " snaps=" << dSnaps.load() << " jumps=" << dJumps.load() << " maxSnapMiss=" << dMaxSnapMiss.load()
          << "  lastPpq=" << juce::String (dLastPpq.load(), 6) << " lastPos=" << dLastPos.load() << "  tapeFull=" << (int) tape.full()
          << " chunks=" << (int) tape.chunksInUse() << "\n";
        const auto raw = tapeHeard.intervalsOf (sel.start, sel.end);
        o << "raw heard runs in selection: " << (int) raw.size() << "\n";
        juce::int64 p = sel.start; int shown = 0;
        for (auto& r : raw)
        {
            if (r.start > p && shown++ < 60) o << "  GAP " << (p - sel.start) << " .. " << (r.start - sel.start) << "  (" << (r.start - p) << " samples)\n";
            p = r.end;
        }
        if (p < sel.end) o << "  GAP " << (p - sel.start) << " .. " << (sel.end - sel.start) << "  (" << (sel.end - p) << " samples)  [end]\n";
        o << "merged spans: " << (int) sel.spans.size() << "\n\n";
        f.appendText (o);
    }

    PreparedCapture GnumbatProcessor::prepareCapture (const CapturePlan& p) const
    {
        PreparedCapture pc;
        if (! capture.isPrepared() || ! transport().valid)
        {
            pc.problem = "Nothing has flowed through the plugin yet. Press play in the host (or feed the standalone input).";
            return pc;
        }
        const auto t = transport();
        const double sr = capture.sampleRate();
        CaptureBuffer::Snapshot snap;
        Marker from, to;
        double wantSamples = 0.0;
        bool timelineKnown = false;

        switch (p.mode)
        {
            case CapturePlan::Mode::loop:
            {
                // Straight off the TimelineTape: exactly the host selection, exactly the audio the
                // heard bar shows as grey. Anything not yet played is silence (and makes it partial).
                const auto sel = selection();
                if (! sel.ok) { pc.problem = "The host is not reporting loop points."; return pc; }
                if (! tape.read (sel.start, sel.end, snap.channels)) { pc.problem = "The tempo changed while copying -- play the selection again."; return pc; }
                auto zero = [&] (juce::int64 a, juce::int64 b)
                {
                    for (auto& ch : snap.channels)
                        std::fill (ch.begin() + (a - sel.start), ch.begin() + (b - sel.start), 0.0f);
                };
                // Unheard stretches: silence.
                juce::int64 prev = sel.start;
                for (auto& sp : sel.spans) { if (sp.first > prev) zero (prev, sp.first); prev = sp.second; }
                if (prev < sel.end) zero (prev, sel.end);
                // Rounding slivers merged into a heard span but never actually written: bridge them
                // with a straight line between their neighbours, so the Bake has no dropout/click.
                {
                    const auto raw = tapeHeard.intervalsOf (sel.start, sel.end);
                    juce::int64 p = sel.start;
                    auto bridge = [&] (juce::int64 a, juce::int64 b)
                    {
                        for (auto& sp : sel.spans)
                        {
                            const auto x0 = juce::jmax (a, sp.first), x1 = juce::jmin (b, sp.second);
                            if (x1 <= x0) continue;
                            for (auto& ch : snap.channels)
                            {
                                // At the selection's own edges there's no neighbour on the far side:
                                // fade from/to silence rather than holding a value (no click, no DC).
                                const float v0 = x0 > sel.start ? ch[(size_t) (x0 - 1 - sel.start)] : 0.0f;
                                const float v1 = x1 < sel.end ? ch[(size_t) (x1 - sel.start)] : 0.0f;
                                const auto w = (double) (x1 - x0 + 1);
                                for (auto x = x0; x < x1; ++x)
                                    ch[(size_t) (x - sel.start)] = (float) (v0 + (v1 - v0) * (double) (x - x0 + 1) / w);
                            }
                        }
                    };
                    for (auto& r : raw) { if (r.start > p) bridge (p, r.start); p = r.end; }
                    if (p < sel.end) bridge (p, sel.end);
                }
                wantSamples = (double) (sel.end - sel.start);
                snap.coveredSamples = sel.complete ? (juce::int64) (sel.end - sel.start)
                                                   : (juce::int64) std::llround (sel.coverage * wantSamples);
                // Timeline metadata: the host's own sample clock where it has one, else tape positions.
                if (! loopMarkers (from, to)) { from.sample = sel.start; to.sample = sel.end; }
                from.ppq = sel.startPpq; to.ppq = sel.endPpq; from.hasPpq = to.hasPpq = true;
                timelineKnown = true;
                break;
            }
            case CapturePlan::Mode::range:
            {
                from = p.in; to = p.out;
                if (! from.isSet() || ! to.isSet() || to.sample <= from.sample) { pc.problem = "Set IN and OUT first (IN must be before OUT)."; return pc; }
                snap = capture.readRange (from.sample, to.sample);
                wantSamples = (double) (to.sample - from.sample);
                timelineKnown = true;
                break;
            }
            case CapturePlan::Mode::lastBars:
            case CapturePlan::Mode::lastSeconds:
            {
                double secs = p.seconds;
                if (p.mode == CapturePlan::Mode::lastBars)
                {
                    const double bpm = t.bpm > 0.0 ? t.bpm : 120.0;
                    const double beatsPerBar = (t.tsNum > 0 && t.tsDen > 0) ? t.tsNum * 4.0 / t.tsDen : 4.0;
                    secs = p.bars * beatsPerBar * 60.0 / bpm;
                }
                wantSamples = std::round (secs * sr);
                snap = capture.readLast ((juce::int64) wantSamples);
                if (snap.timelineStart >= 0) { from.sample = snap.timelineStart; to.sample = snap.timelineStart + (juce::int64) snap.channels[0].size(); timelineKnown = true; }
                break;
            }
        }

        if (snap.overrun) { pc.problem = "The capture ring was overwritten while copying (range too old for the ring, or the buffer is very short). Try a shorter or more recent range."; return pc; }
        if (snap.channels.empty() || snap.channels[0].empty() || snap.coveredSamples <= 0)
        {
            pc.problem = p.mode == CapturePlan::Mode::range || p.mode == CapturePlan::Mode::loop
                       ? "None of that range has passed through the plugin. Play it in the host once (capture is by playing through)."
                       : "Nothing captured yet.";
            return pc;
        }

        pc.coverage = juce::jlimit (0.0, 1.0, (double) snap.coveredSamples / wantSamples);
        pc.bake.audio.channels = std::move (snap.channels);
        pc.bake.audio.sampleRate = sr;
        pc.seconds = (double) pc.bake.audio.frames() / sr;

        auto& m = pc.bake.capture;
        m.hostName = hostName();
        m.pluginVersion = GNUMBAT_VERSION;
        m.session = sessionId;
        m.trackName = trackName();
        m.tempoBpm = t.bpm;
        m.timeSigNum = t.tsNum; m.timeSigDen = t.tsDen;
        m.coverage = pc.coverage;
        m.complete = pc.coverage >= 0.999;
        m.offline = t.offline;
        m.mode = CapturePlan::modeName (p.mode);
        if (timelineKnown && t.hostTimeline)
        {
            m.hasTimeline = true;
            m.startSample = from.sample; m.endSample = to.sample; m.timelineSampleRate = sr;
            if (from.hasPpq && to.hasPpq) { m.hasPpq = true; m.startPpq = from.ppq; m.endPpq = to.ppq; }
        }
        pc.bake.isImport = false;
        pc.ok = true;
        pc.summary = juce::String (pc.seconds, 2) + " s  ·  " + juce::String (juce::roundToInt (pc.coverage * 100.0)) + " % heard";
        return pc;
    }

    // ---------------------------------------------------------------------------------------- state
    juce::var GnumbatProcessor::uiState() const { const juce::ScopedLock sl (metaLock); return ui.clone(); }
    void GnumbatProcessor::setUiState (const juce::String& key, const juce::var& v) { const juce::ScopedLock sl (metaLock); ui.getDynamicObject()->setProperty (key, v); }
    juce::var GnumbatProcessor::getUiState (const juce::String& key, const juce::var& fb) const { const juce::ScopedLock sl (metaLock); return ui.hasProperty (key) ? ui.getProperty (key, fb) : fb; }

    static juce::var markerVar (const Marker& m)
    {
        return m.isSet() ? json::object ({ { "sample", (juce::int64) m.sample }, { "ppq", m.ppq }, { "has_ppq", m.hasPpq } }) : juce::var();
    }
    static Marker markerFrom (const juce::var& v)
    {
        Marker m;
        if (v.getDynamicObject() == nullptr) return m;
        m.sample = (juce::int64) json::getNumber (v, "sample", -1);
        m.ppq = json::getNumber (v, "ppq");
        m.hasPpq = json::getBool (v, "has_ppq");
        return m;
    }

    void GnumbatProcessor::getStateInformation (juce::MemoryBlock& dest)
    {
        // Only markers and UI preferences are session state. Audio and Bakes live in the library, never in the project file.
        auto planVar = json::object ({ { "mode", CapturePlan::modeName (plan.mode) }, { "in", markerVar (plan.in) }, { "out", markerVar (plan.out) },
                                       { "bars", plan.bars }, { "seconds", plan.seconds } });
        auto doc = json::object ({ { "schema", "gnumbat.plugin_state/0.1" }, { "plan", planVar }, { "ui", uiState() } });
        const auto text = json::toText (doc, false);
        dest.append (text.toRawUTF8(), std::strlen (text.toRawUTF8()));
    }

    void GnumbatProcessor::setStateInformation (const void* data, int size)
    {
        juce::var doc;
        if (size <= 0 || ! juce::JSON::parse (juce::String::fromUTF8 (static_cast<const char*> (data), size), doc).wasOk()) return;
        if (! json::getString (doc, "schema").startsWith ("gnumbat.plugin_state/")) return;
        const auto pv = json::get (doc, "plan");
        const auto mode = json::getString (pv, "mode", "last_bars");
        plan.mode = mode == "range" ? CapturePlan::Mode::range : mode == "loop" ? CapturePlan::Mode::loop
                  : mode == "last_seconds" ? CapturePlan::Mode::lastSeconds : CapturePlan::Mode::lastBars;
        plan.in = markerFrom (json::get (pv, "in"));
        plan.out = markerFrom (json::get (pv, "out"));
        plan.bars = juce::jlimit (0.25, 512.0, json::getNumber (pv, "bars", 4.0));
        plan.seconds = juce::jlimit (0.1, 900.0, json::getNumber (pv, "seconds", 10.0));
        if (auto* o = json::get (doc, "ui").getDynamicObject())
        {
            const juce::ScopedLock sl (metaLock);
            ui = json::get (doc, "ui").clone();
            (void) o;
        }
    }

    juce::AudioProcessorEditor* GnumbatProcessor::createEditor() { return new GnumbatEditor (*this); }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new gnumbat::GnumbatProcessor(); }
