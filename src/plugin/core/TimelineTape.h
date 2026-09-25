#pragma once
// Gnumbat timeline tape: the actual audio of the host's timeline, stored by MUSICAL position.
//
// Position on the tape = the host's own ppq (beats) for each block, times samples-per-beat at the
// tape's tempo -- nothing else. The host's loop/time selection maps onto the tape with exactly the
// same formula, so the selection, the heard bar and the stored audio can never drift apart or
// differ in length: all three are the same numbers. (Mapping ppq onto the host's timeInSamples
// clock instead, as the plugin used to, re-derived the relation every block from a rounded tempo,
// which is what made the heard bar's start creep.)
//
// Storage is sparse: fixed-size chunks allocated only where audio actually played, so a whole
// song's worth of timeline costs nothing until it's heard. Unlike the rolling CaptureBuffer ring,
// nothing already heard is ever overwritten by later playback elsewhere -- a section stays in
// memory (for the Bake / render / stem decomposition / analysis) until the tape is cleared.
//
// Threads: write() / clear() on the audio thread only (wait-free, no allocation -- chunks come
// from a pool the message thread keeps topped up via topUp()). read() on any other thread.
// No JUCE dependency.
#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace gnumbat
{
class TimelineTape
{
public:
    static constexpr int kChunkBits = 14;
    static constexpr int64_t kChunk = int64_t (1) << kChunkBits;   // 16384 samples per chunk
    static constexpr int64_t kMaxTableChunks = int64_t (1) << 17;  // ~12 h of timeline at 48 kHz

    TimelineTape() = default;
    TimelineTape (const TimelineTape&) = delete;
    TimelineTape& operator= (const TimelineTape&) = delete;

    /** NOT real-time safe; call with the audio thread stopped (prepareToPlay). Discards everything.
        maxStoredSeconds caps total memory; initialSpareChunks are allocated right away. */
    void prepare (double sampleRate, int numChannels, double maxStoredSeconds, int initialSpareChunks = 128);
    bool isPrepared() const noexcept { return channels > 0; }
    int numChannels() const noexcept { return channels; }

    /** Message thread: keep at least `spare` unused chunks ready for the audio thread. */
    void topUp (int spare = 64);

    /** Audio thread. Stores [pos, pos + n) (tape positions). Returns how many samples from pos
        were actually stored (fewer only if the memory cap/pool ran out or pos is off the tape). */
    int write (const float* const* src, int numSrcChannels, int n, int64_t pos) noexcept;

    /** Audio thread: forget everything (e.g. the tempo changed, so every position moved). */
    void clear() noexcept;

    /** Any non-audio thread: copy [a, b) into out[channel][...]. Never-written spans read as
        silence (the caller zeroes anything its heard-tracking says wasn't played). False if the
        tape was cleared mid-copy. */
    bool read (int64_t a, int64_t b, std::vector<std::vector<float>>& out) const;

    uint64_t generation() const noexcept { return gen.load (std::memory_order_acquire); }
    int64_t chunksInUse() const noexcept { return used.load (std::memory_order_relaxed); }
    bool full() const noexcept { return exhausted.load (std::memory_order_relaxed); }

private:
    int channels = 0;
    int maxPool = 0;
    std::unique_ptr<std::atomic<int32_t>[]> table;                 // chunk index -> pool slot, -1 = none
    std::vector<std::unique_ptr<std::atomic<float>[]>> pool;       // sized once in prepare(); entries filled by topUp()
    std::atomic<int> allocated { 0 };                              // pool[0..allocated) exist (message thread publishes)
    std::atomic<int> used { 0 };                                   // pool[0..used) handed out (audio thread)
    std::atomic<uint64_t> gen { 0 };
    std::atomic<bool> exhausted { false };
};
}
