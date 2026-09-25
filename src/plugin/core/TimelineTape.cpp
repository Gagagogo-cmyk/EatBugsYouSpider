#include "TimelineTape.h"
#include <algorithm>
#include <cmath>

namespace gnumbat
{
void TimelineTape::prepare (double sampleRate, int numChannels, double maxStoredSeconds, int initialSpareChunks)
{
    channels = std::max (1, numChannels);
    maxPool = (int) std::max<int64_t> (1, (int64_t) std::ceil (std::max (1.0, maxStoredSeconds) * std::max (1.0, sampleRate) / (double) kChunk));
    table.reset (new std::atomic<int32_t>[(size_t) kMaxTableChunks]);
    for (int64_t i = 0; i < kMaxTableChunks; ++i) table[(size_t) i].store (-1, std::memory_order_relaxed);
    pool.clear();
    pool.resize ((size_t) maxPool);
    allocated.store (0, std::memory_order_relaxed);
    used.store (0, std::memory_order_relaxed);
    exhausted.store (false, std::memory_order_relaxed);
    gen.fetch_add (1, std::memory_order_release);
    topUp (initialSpareChunks);
}

void TimelineTape::topUp (int spare)
{
    if (! isPrepared()) return;
    int a = allocated.load (std::memory_order_relaxed);
    const int want = std::min (maxPool, used.load (std::memory_order_relaxed) + std::max (1, spare));
    while (a < want)
    {
        pool[(size_t) a].reset (new std::atomic<float>[(size_t) (kChunk * channels)]());
        allocated.store (++a, std::memory_order_release);
    }
}

int TimelineTape::write (const float* const* src, int numSrcChannels, int n, int64_t pos) noexcept
{
    if (! isPrepared() || numSrcChannels <= 0 || n <= 0 || pos < 0) return 0;
    int done = 0;
    while (done < n)
    {
        const int64_t p = pos + done;
        const int64_t ci = p >> kChunkBits;
        if (ci >= kMaxTableChunks) break;
        int32_t slot = table[(size_t) ci].load (std::memory_order_acquire);
        if (slot < 0)
        {
            const int u = used.load (std::memory_order_relaxed);
            if (u >= allocated.load (std::memory_order_acquire)) { exhausted.store (true, std::memory_order_relaxed); break; }
            slot = u;
            used.store (u + 1, std::memory_order_relaxed);
            table[(size_t) ci].store (slot, std::memory_order_release);
        }
        const int off = (int) (p & (kChunk - 1));
        const int k = (int) std::min<int64_t> (n - done, kChunk - off);
        std::atomic<float>* d = pool[(size_t) slot].get();
        for (int c = 0; c < channels; ++c)
        {
            const float* s = src[std::min (c, numSrcChannels - 1)] + done;
            std::atomic<float>* dc = d + (size_t) c * (size_t) kChunk + (size_t) off;
            for (int i = 0; i < k; ++i) dc[i].store (s[i], std::memory_order_relaxed);
        }
        done += k;
    }
    return done;
}

void TimelineTape::clear() noexcept
{
    if (! isPrepared()) return;
    gen.fetch_add (1, std::memory_order_acq_rel);
    const int u = used.load (std::memory_order_relaxed);
    if (u > 0)
        for (int64_t i = 0; i < kMaxTableChunks; ++i)
            if (table[(size_t) i].load (std::memory_order_relaxed) >= 0) table[(size_t) i].store (-1, std::memory_order_relaxed);
    used.store (0, std::memory_order_release);   // slots are reused; stale contents are never trusted (see read())
    exhausted.store (false, std::memory_order_relaxed);
}

bool TimelineTape::read (int64_t a, int64_t b, std::vector<std::vector<float>>& out) const
{
    out.assign ((size_t) std::max (1, channels), {});
    if (! isPrepared() || b <= a || a < 0) return false;
    const uint64_t g0 = gen.load (std::memory_order_acquire);
    for (auto& ch : out) ch.assign ((size_t) (b - a), 0.0f);
    int64_t p = a;
    while (p < b)
    {
        const int64_t ci = p >> kChunkBits;
        const int off = (int) (p & (kChunk - 1));
        const int64_t k = std::min<int64_t> (b - p, kChunk - off);
        if (ci >= kMaxTableChunks) break;
        const int32_t slot = table[(size_t) ci].load (std::memory_order_acquire);
        if (slot >= 0 && slot < allocated.load (std::memory_order_acquire))
        {
            const std::atomic<float>* d = pool[(size_t) slot].get();
            for (int c = 0; c < channels; ++c)
            {
                const std::atomic<float>* sc = d + (size_t) c * (size_t) kChunk + (size_t) off;
                float* o = out[(size_t) c].data() + (p - a);
                for (int64_t i = 0; i < k; ++i) o[i] = sc[i].load (std::memory_order_relaxed);
            }
        }
        p += k;
    }
    return gen.load (std::memory_order_acquire) == g0;
}
}
