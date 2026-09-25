#include "CaptureBuffer.h"
#include <algorithm>
#include <chrono>
#include <thread>

namespace gnumbat
{
struct CaptureBuffer::Segment
{
    std::atomic<int64_t> ringStart { 0 };      // absolute write index of the segment's first sample
    std::atomic<int64_t> timelineStart { -1 }; // host timeline sample of its first sample, or -1
    std::atomic<int64_t> length { 0 };         // samples so far (release-published by the writer)
};

struct CaptureBuffer::Storage
{
    double sampleRate = 0.0;
    int channels = 0;
    int64_t capacity = 0; // ring size in samples per channel
    int64_t guard = 0;    // never read the newest `guard`-oldest region: the writer may be overwriting it
    int64_t usable = 0;   // capacity - guard
    int maxSegs = 0;
    std::vector<std::unique_ptr<std::atomic<float>[]>> ring;
    std::unique_ptr<Segment[]> segs;
    std::atomic<int64_t> writeCount { 0 }; // total samples published
    std::atomic<int64_t> segCount { 0 };   // total segments ever created
    std::atomic<uint32_t> seq { 0 };       // seqlock around segment-table slot (re)initialisation
    int64_t chunkMax = 0;
};

// Keeps `readersActive` raised while a reader holds a Storage pointer, so prepare() can free old storage safely.
struct CaptureBuffer::ReaderGuard
{
    const CaptureBuffer& cb;
    Storage* s;
    explicit ReaderGuard (const CaptureBuffer& c) : cb (c)
    {
        cb.readersActive.fetch_add (1); // seq_cst (default)
        s = cb.current.load();
    }
    ~ReaderGuard() { cb.readersActive.fetch_sub (1); }
};

CaptureBuffer::CaptureBuffer() = default;

CaptureBuffer::~CaptureBuffer()
{
    delete current.exchange (nullptr);
}

void CaptureBuffer::prepare (double sampleRate, int numChannels, double seconds, int maxSegments)
{
    auto s = std::make_unique<Storage>();
    s->sampleRate = sampleRate;
    s->channels = std::max (1, numChannels);
    s->guard = std::max<int64_t> (65536, int64_t (sampleRate * 1.0));
    s->capacity = std::max<int64_t> (int64_t (sampleRate * seconds), s->guard * 2);
    s->usable = s->capacity - s->guard;
    s->chunkMax = s->guard / 2;
    s->maxSegs = std::max (16, maxSegments);
    for (int c = 0; c < s->channels; ++c)
    {
        s->ring.emplace_back (new std::atomic<float>[size_t (s->capacity)]);
        for (int64_t i = 0; i < s->capacity; ++i)
            s->ring.back()[size_t (i)].store (0.0f, std::memory_order_relaxed);
    }
    s->segs.reset (new Segment[size_t (s->maxSegs)]);

    Storage* old = current.exchange (s.release());
    if (old != nullptr)
    {
        // wait for readers that may still hold the old pointer (they finish in milliseconds)
        while (readersActive.load() != 0)
            std::this_thread::sleep_for (std::chrono::milliseconds (1));
        delete old;
    }
}

bool CaptureBuffer::isPrepared() const { return current.load() != nullptr; }

void CaptureBuffer::push (const float* const* channels, int numChannels, int numSamples, int64_t timelineStart) noexcept
{
    Storage* s = current.load (std::memory_order_acquire);
    if (s == nullptr || numSamples <= 0)
        return;

    const int nch = std::min (numChannels, s->channels);
    int offset = 0;
    while (offset < numSamples)
    {
        const int n = int (std::min<int64_t> (numSamples - offset, s->chunkMax));
        const int64_t tl = timelineStart >= 0 ? timelineStart + offset : -1;
        const int64_t w = s->writeCount.load (std::memory_order_relaxed);

        // 1. samples into the ring (older data at these positions is at least `guard` behind any valid read)
        for (int c = 0; c < s->channels; ++c)
        {
            std::atomic<float>* dst = s->ring[size_t (c)].get();
            const float* src = channels[std::min (c, nch - 1)] + offset;
            int64_t pos = w % s->capacity;
            for (int i = 0; i < n; ++i)
            {
                dst[pos].store (src[i], std::memory_order_relaxed);
                if (++pos == s->capacity)
                    pos = 0;
            }
        }

        // 2. segment table: extend the current segment or open a new one
        const int64_t sc = s->segCount.load (std::memory_order_relaxed);
        bool extended = false;
        if (sc > 0)
        {
            Segment& cur = s->segs[size_t ((sc - 1) % s->maxSegs)];
            const int64_t curTl = cur.timelineStart.load (std::memory_order_relaxed);
            const int64_t curLen = cur.length.load (std::memory_order_relaxed);
            const bool contiguous = (tl < 0 && curTl < 0) || (tl >= 0 && curTl >= 0 && curTl + curLen == tl);
            if (contiguous)
            {
                cur.length.store (curLen + n, std::memory_order_release);
                extended = true;
            }
        }
        if (! extended)
        {
            s->seq.fetch_add (1, std::memory_order_acq_rel); // odd: slot being (re)initialised
            Segment& ns = s->segs[size_t (sc % s->maxSegs)];
            ns.ringStart.store (w, std::memory_order_relaxed);
            ns.timelineStart.store (tl, std::memory_order_relaxed);
            ns.length.store (n, std::memory_order_relaxed);
            s->segCount.store (sc + 1, std::memory_order_release);
            s->seq.fetch_add (1, std::memory_order_release); // even
        }

        // 3. publish
        s->writeCount.store (w + n, std::memory_order_release);
        offset += n;
    }
}

int64_t CaptureBuffer::ringIndex (const Storage& s, int64_t absolute) { return absolute % s.capacity; }

bool CaptureBuffer::copySegments (const Storage& s, std::vector<SegCopy>& out)
{
    for (int attempt = 0; attempt < 50; ++attempt)
    {
        const uint32_t s1 = s.seq.load (std::memory_order_acquire);
        if (s1 & 1u)
        {
            std::this_thread::yield();
            continue;
        }
        const int64_t sc = s.segCount.load (std::memory_order_acquire);
        out.clear();
        const int64_t first = std::max<int64_t> (0, sc - s.maxSegs);
        for (int64_t i = first; i < sc; ++i)
        {
            const Segment& g = s.segs[size_t (i % s.maxSegs)];
            out.push_back ({ i, g.ringStart.load (std::memory_order_relaxed),
                             g.timelineStart.load (std::memory_order_relaxed),
                             g.length.load (std::memory_order_acquire) });
        }
        std::atomic_thread_fence (std::memory_order_acquire);
        if (s.seq.load (std::memory_order_acquire) == s1)
            return true;
    }
    return false;
}

static void mergeInto (std::vector<CaptureBuffer::Interval>& v)
{
    std::sort (v.begin(), v.end(), [] (auto& a, auto& b) { return a.start < b.start; });
    std::vector<CaptureBuffer::Interval> m;
    for (auto& i : v)
    {
        if (i.end <= i.start) continue;
        if (! m.empty() && i.start <= m.back().end) m.back().end = std::max (m.back().end, i.end);
        else m.push_back (i);
    }
    v.swap (m);
}

CaptureBuffer::Snapshot CaptureBuffer::readImpl (const Storage& s, int64_t start, int64_t end, bool copyAudio) const
{
    Snapshot out;
    out.start = start;
    out.end = end;
    out.sampleRate = s.sampleRate;
    if (end <= start)
        return out;
    const int64_t len = end - start;
    if (copyAudio)
        out.channels.assign (size_t (s.channels), std::vector<float> (size_t (len), 0.0f));

    std::vector<SegCopy> segs;
    if (! copySegments (s, segs))
    {
        out.overrun = true;
        return out;
    }

    struct Piece { int64_t absStart, t0, t1; };
    std::vector<Piece> pieces;
    std::vector<Interval> remaining { { start, end } };

    for (auto it = segs.rbegin(); it != segs.rend() && ! remaining.empty(); ++it) // newest pass wins
    {
        if (it->timelineStart < 0) continue;
        const Interval seg { it->timelineStart, it->timelineStart + it->length };
        std::vector<Interval> next;
        for (const auto& r : remaining)
        {
            const int64_t a = std::max (r.start, seg.start), b = std::min (r.end, seg.end);
            if (a < b)
            {
                pieces.push_back ({ it->ringStart + (a - it->timelineStart), a, b });
                if (r.start < a) next.push_back ({ r.start, a });
                if (b < r.end) next.push_back ({ b, r.end });
            }
            else
                next.push_back (r);
        }
        remaining.swap (next);
    }

    const int64_t wc1 = s.writeCount.load (std::memory_order_acquire);
    if (copyAudio)
        for (const auto& p : pieces)
        {
            if (p.absStart < wc1 - s.usable) continue; // already overwritten: skip the copy
            for (int c = 0; c < s.channels; ++c)
            {
                const std::atomic<float>* src = s.ring[size_t (c)].get();
                float* dst = out.channels[size_t (c)].data() + (p.t0 - start);
                int64_t pos = ringIndex (s, p.absStart);
                for (int64_t i = 0, n = p.t1 - p.t0; i < n; ++i)
                {
                    dst[i] = src[pos].load (std::memory_order_relaxed);
                    if (++pos == s.capacity) pos = 0;
                }
            }
        }
    const int64_t wc2 = s.writeCount.load (std::memory_order_acquire);

    for (const auto& p : pieces)
    {
        if (p.absStart >= wc2 - s.usable) // untouched by the writer during our copy
            out.covered.push_back ({ p.t0, p.t1 });
        else
        {
            out.overrun = true;
            if (copyAudio)
                for (int c = 0; c < s.channels; ++c)
                    std::fill (out.channels[size_t (c)].begin() + (p.t0 - start), out.channels[size_t (c)].begin() + (p.t1 - start), 0.0f);
        }
    }
    mergeInto (out.covered);
    for (auto& i : out.covered) out.coveredSamples += i.length();
    return out;
}

CaptureBuffer::Snapshot CaptureBuffer::readRange (int64_t start, int64_t end) const
{
    ReaderGuard g (*this);
    if (g.s == nullptr) return {};
    return readImpl (*g.s, start, end, true);
}

std::vector<CaptureBuffer::Interval> CaptureBuffer::coverage (int64_t start, int64_t end) const
{
    ReaderGuard g (*this);
    if (g.s == nullptr) return {};
    return readImpl (*g.s, start, end, false).covered;
}

CaptureBuffer::Snapshot CaptureBuffer::readLast (int64_t numSamples) const
{
    ReaderGuard g (*this);
    Snapshot out;
    if (g.s == nullptr) return out;
    const Storage& s = *g.s;
    out.sampleRate = s.sampleRate;
    const int64_t wc1 = s.writeCount.load (std::memory_order_acquire);
    const int64_t n = std::min<int64_t> ({ numSamples, wc1, s.usable });
    out.start = -1;
    out.end = -1;
    if (n <= 0) return out;
    const int64_t a0 = wc1 - n;
    out.channels.assign (size_t (s.channels), std::vector<float> (size_t (n)));
    for (int c = 0; c < s.channels; ++c)
    {
        const std::atomic<float>* src = s.ring[size_t (c)].get();
        int64_t pos = ringIndex (s, a0);
        for (int64_t i = 0; i < n; ++i)
        {
            out.channels[size_t (c)][size_t (i)] = src[pos].load (std::memory_order_relaxed);
            if (++pos == s.capacity) pos = 0;
        }
    }
    const int64_t wc2 = s.writeCount.load (std::memory_order_acquire);
    if (a0 < wc2 - s.usable) { out.overrun = true; out.channels.clear(); return out; }
    out.coveredSamples = n;
    out.covered = { { 0, n } };
    out.end = n; // (positions are snapshot-relative here)
    out.start = 0;
    std::vector<SegCopy> segs;
    if (copySegments (s, segs))
        for (auto it = segs.rbegin(); it != segs.rend(); ++it)
            if (it->ringStart <= a0 && it->ringStart + it->length >= wc1)
            {
                if (it->timelineStart >= 0) out.timelineStart = it->timelineStart + (a0 - it->ringStart);
                break;
            }
    return out;
}

int64_t CaptureBuffer::totalWritten() const
{
    ReaderGuard g (*this);
    return g.s ? g.s->writeCount.load (std::memory_order_acquire) : 0;
}
int64_t CaptureBuffer::usableSamples() const
{
    ReaderGuard g (*this);
    return g.s ? g.s->usable : 0;
}
double CaptureBuffer::sampleRate() const
{
    ReaderGuard g (*this);
    return g.s ? g.s->sampleRate : 0.0;
}
int CaptureBuffer::numChannels() const
{
    ReaderGuard g (*this);
    return g.s ? g.s->channels : 0;
}
} // namespace gnumbat
