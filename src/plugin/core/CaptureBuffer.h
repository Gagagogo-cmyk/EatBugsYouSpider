#pragma once
// Gnumbat capture ring: real-time-safe, timeline-addressed audio capture.
//
// Audio thread (single producer): push()  — wait-free, no allocation, no locks, no I/O.
// Any other thread:               readRange / readLast / coverage — lock-free, validated after copy.
//
// The ring stores audio in ARRIVAL order. A small table of "segments" records, for each run of
// contiguous host-timeline positions, where it starts in the ring and on the host timeline.
// That is what lets a Bake be addressed by *timeline range* even though a plugin can only ever
// see audio as the host streams it through: multiple passes, loop wraps and partial takes all
// assemble correctly (the newest pass wins where passes overlap).
//
// Ring elements are relaxed std::atomic<float>: plain loads/stores on x86/ARM, but the
// concurrent read-while-writing the reader does is then formally race-free. Consistency is
// established by publishing counters with release/acquire and validating that the region
// copied was not overwritten meanwhile.
//
// No JUCE dependency, so it can be tested with ThreadSanitizer and reused by every frontend.
#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace gnumbat
{
class CaptureBuffer
{
public:
    struct Interval
    {
        int64_t start = 0, end = 0; // [start, end) in timeline samples
        int64_t length() const { return end - start; }
    };

    struct Snapshot
    {
        std::vector<std::vector<float>> channels; // [channel][sample], length == requested range length
        std::vector<Interval> covered;            // merged, ascending, within [start, end)
        int64_t start = 0, end = 0;               // requested range (timeline samples), or -1/-1 for readLast without timeline
        int64_t timelineStart = -1;               // readLast: timeline position of channels[*][0] if the span is one timeline-contiguous run
        int64_t coveredSamples = 0;
        bool overrun = false;                     // some data was overwritten while (or before) we read it
        double sampleRate = 0.0;
        double coverageFraction() const { return end > start ? double (coveredSamples) / double (end - start) : 0.0; }
    };

    CaptureBuffer();
    ~CaptureBuffer();
    CaptureBuffer (const CaptureBuffer&) = delete;
    CaptureBuffer& operator= (const CaptureBuffer&) = delete;

    /** NOT real-time safe. Call with the audio thread stopped (e.g. from prepareToPlay).
        Discards previously captured audio. */
    void prepare (double sampleRate, int numChannels, double seconds, int maxSegments = 2048);

    /** Audio thread only. timelineStart < 0 means "host position unknown" (audio is kept
        for readLast, but cannot be addressed by timeline range). */
    void push (const float* const* channels, int numChannels, int numSamples, int64_t timelineStart) noexcept;

    Snapshot readRange (int64_t start, int64_t end) const;
    Snapshot readLast (int64_t numSamples) const;
    std::vector<Interval> coverage (int64_t start, int64_t end) const;

    int64_t totalWritten() const;
    int64_t usableSamples() const;      // how far back readLast/readRange can reach
    double sampleRate() const;
    int numChannels() const;
    bool isPrepared() const;

private:
    struct Storage;
    struct Segment;
    struct ReaderGuard;
    std::atomic<Storage*> current { nullptr };
    mutable std::atomic<int> readersActive { 0 };
    std::vector<std::unique_ptr<Storage>> retired;

    struct SegCopy { int64_t index, ringStart, timelineStart, length; };
    static bool copySegments (const Storage&, std::vector<SegCopy>&);
    static int64_t ringIndex (const Storage&, int64_t absolute);
    Snapshot readImpl (const Storage&, int64_t start, int64_t end, bool copyAudio) const;
};
} // namespace gnumbat
