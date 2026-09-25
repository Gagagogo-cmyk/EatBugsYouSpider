// Standalone (no JUCE) tests for CaptureBuffer, including a multi-threaded stress test.
// Build with -fsanitize=thread to check for data races.
#include "../core/CaptureBuffer.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <thread>

using gnumbat::CaptureBuffer;
static int failures = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); ++failures; } } while (0)

// deterministic test signal: a value derived from the *timeline position*, distinct per channel
static float sig (int64_t timeline, int ch) { return float ((timeline * 7 + ch * 131) % 100003) / 100003.0f; }

static void pushTimeline (CaptureBuffer& cb, int64_t t0, int n, int block = 256, int chans = 2)
{
    std::vector<float> a (block), b (block);
    for (int done = 0; done < n; done += block)
    {
        int m = std::min (block, n - done);
        for (int i = 0; i < m; ++i) { a[i] = sig (t0 + done + i, 0); b[i] = sig (t0 + done + i, 1); }
        const float* ch[2] = { a.data(), b.data() };
        cb.push (ch, chans, m, t0 + done);
    }
}

static void testBasicRange()
{
    CaptureBuffer cb; cb.prepare (1000.0, 2, 200.0);
    pushTimeline (cb, 5000, 3000);
    auto s = cb.readRange (5500, 7500);
    CHECK (s.coveredSamples == 2000 && s.covered.size() == 1 && ! s.overrun);
    for (int i = 0; i < 2000; ++i) { CHECK (s.channels[0][size_t (i)] == sig (5500 + i, 0)); CHECK (s.channels[1][size_t (i)] == sig (5500 + i, 1)); }
    auto part = cb.readRange (4000, 6000);           // starts before what we captured
    CHECK (part.coveredSamples == 1000 && part.covered[0].start == 5000 && part.channels[0][0] == 0.0f);
    CHECK (cb.readRange (0, 100).coveredSamples == 0);
    CHECK (cb.coverage (5000, 8000).size() == 1 && cb.coverage (5000, 8000)[0].length() == 3000);
}

static void testLoopAndNewestPassWins()
{
    CaptureBuffer cb; cb.prepare (1000.0, 2, 200.0);
    // host loops [1000,2000): pass 1 plays only half, pass 2 plays all with *different* content (simulated by offset trick)
    pushTimeline (cb, 1000, 500);
    pushTimeline (cb, 1000, 1000);                     // wraps back to loop start: new segment
    auto s = cb.readRange (1000, 2000);
    CHECK (s.coveredSamples == 1000);
    for (int i = 0; i < 1000; ++i) CHECK (s.channels[0][size_t (i)] == sig (1000 + i, 0));
    // gaps are reported, not filled
    CaptureBuffer g; g.prepare (1000.0, 2, 200.0);
    pushTimeline (g, 0, 300); pushTimeline (g, 500, 300);
    auto gs = g.readRange (0, 800);
    CHECK (gs.covered.size() == 2 && gs.coveredSamples == 600 && gs.covered[1].start == 500);
    CHECK (gs.channels[0][400] == 0.0f);
}

static void testUnknownTimelineAndReadLast()
{
    CaptureBuffer cb; cb.prepare (1000.0, 2, 200.0);
    std::vector<float> x (500, 0.25f); const float* ch[2] = { x.data(), x.data() };
    cb.push (ch, 2, 500, -1);
    CHECK (cb.readRange (0, 500).coveredSamples == 0);            // no timeline => not addressable by range
    auto l = cb.readLast (300);
    CHECK (l.coveredSamples == 300 && l.channels[0][0] == 0.25f && l.timelineStart == -1);
    pushTimeline (cb, 10000, 400);
    auto l2 = cb.readLast (400);
    CHECK (l2.timelineStart == 10000 && l2.channels[1][7] == sig (10007, 1));
    auto l3 = cb.readLast (700);                                   // spans an unknown-timeline segment
    CHECK (l3.coveredSamples == 700 && l3.timelineStart == -1);
    CHECK (cb.readLast (1000000).coveredSamples == 900);          // clamps to what exists
}

static void testWrapAroundAndOverwrite()
{
    CaptureBuffer cb; cb.prepare (1000.0, 2, 70.0);               // 70 s < guard*2 => capacity is guard*2 = 131072
    const int64_t usable = cb.usableSamples();
    pushTimeline (cb, 0, int (usable) + 30000, 1000);              // wrapped past the ring
    auto recent = cb.readRange (int64_t (usable) - 1000, int64_t (usable) + 1000);
    CHECK (recent.coveredSamples == 2000 && ! recent.overrun);
    for (int i = 0; i < 2000; ++i) CHECK (recent.channels[0][size_t (i)] == sig (usable - 1000 + i, 0));
    auto old = cb.readRange (0, 1000);                             // long gone: reported as overrun/uncovered, never garbage
    CHECK (old.coveredSamples == 0 && old.overrun);
    CHECK (old.channels[0][10] == 0.0f);
}

static void testHugeBlockAndSegmentTableWrap()
{
    CaptureBuffer cb; cb.prepare (1000.0, 2, 200.0, 16);
    std::vector<float> big (500000); for (size_t i = 0; i < big.size(); ++i) big[i] = sig (int64_t (i), 0);
    const float* ch[2] = { big.data(), big.data() };
    cb.push (ch, 2, int (big.size()), 0);                          // one block larger than the ring
    auto s = cb.readRange (500000 - 5000, 500000);
    CHECK (s.coveredSamples == 5000 && s.channels[0][0] == sig (495000, 0));
    for (int k = 0; k < 100; ++k) pushTimeline (cb, 1000000 + k * 10000, 100);   // 100 disjoint segments through a 16-slot table
    auto t = cb.readRange (1000000 + 99 * 10000, 1000000 + 99 * 10000 + 100);
    CHECK (t.coveredSamples == 100 && t.channels[1][3] == sig (1000000 + 99 * 10000 + 3, 1));
    CHECK (cb.readRange (1000000, 1000100).coveredSamples == 0);   // its slot was recycled: honestly reported as absent
}

static void testMonoInputToStereoRing()
{
    CaptureBuffer cb; cb.prepare (1000.0, 2, 200.0);
    std::vector<float> m (256, 0.5f); const float* ch[1] = { m.data() };
    cb.push (ch, 1, 256, 0);
    auto s = cb.readRange (0, 256);
    CHECK (s.channels[0][5] == 0.5f && s.channels[1][5] == 0.5f);  // missing channels mirror the last provided one
}

static void testReprepareWhileReading()
{
    CaptureBuffer cb; cb.prepare (1000.0, 2, 200.0);
    std::atomic<bool> stop { false };
    std::thread r ([&] { while (! stop) { cb.coverage (0, 1000); cb.readRange (0, 500); cb.totalWritten(); } });
    for (int i = 0; i < 20; ++i) { cb.prepare (1000.0 + i, 2, 100.0); pushTimeline (cb, 0, 2000); }
    stop = true; r.join();
    CHECK (cb.readRange (0, 2000).coveredSamples == 2000);
}

// One writer thread pushing a known signal while several readers continuously read ranges near the head.
// Every sample a reader is told is "covered" must equal the signal at that timeline position.
static void testConcurrentStress()
{
    CaptureBuffer cb; cb.prepare (48000.0, 2, 3.0);                // ring of ~3 s => constant overwriting
    std::atomic<bool> stop { false };
    std::atomic<int64_t> head { 0 };
    std::atomic<long> checked { 0 }, bad { 0 }, overruns { 0 };
    std::thread writer ([&] {
        int64_t t = 0; const int block = 480;
        std::vector<float> a (block), b (block);
        while (! stop)
        {
            for (int i = 0; i < block; ++i) { a[i] = sig (t + i, 0); b[i] = sig (t + i, 1); }
            const float* ch[2] = { a.data(), b.data() };
            cb.push (ch, 2, block, t);
            t += block; head.store (t, std::memory_order_release);
            if (t > 48000 * 40) break;                              // ~40 s of audio then stop
        }
        stop = true;
    });
    std::vector<std::thread> readers;
    for (int r = 0; r < 3; ++r)
        readers.emplace_back ([&, r] {
            while (! stop)
            {
                int64_t h = head.load (std::memory_order_acquire);
                if (h < 60000) continue;
                int64_t end = h - 100, start = end - 20000 - r * 7000;
                auto s = cb.readRange (start, end);
                if (s.overrun) ++overruns;
                for (auto& iv : s.covered)
                    for (int64_t t = iv.start; t < iv.end; t += 97)
                    {
                        ++checked;
                        if (s.channels[0][size_t (t - start)] != sig (t, 0) || s.channels[1][size_t (t - start)] != sig (t, 1)) ++bad;
                    }
            }
        });
    writer.join(); for (auto& t : readers) t.join();
    std::printf ("stress: checked %ld samples, %ld bad, %ld overrun-flagged reads\n", checked.load(), bad.load(), overruns.load());
    CHECK (bad.load() == 0 && checked.load() > 1000);
}

int main()
{
    testBasicRange(); testLoopAndNewestPassWins(); testUnknownTimelineAndReadLast(); testWrapAroundAndOverwrite();
    testHugeBlockAndSegmentTableWrap(); testMonoInputToStereoRing(); testReprepareWhileReading(); testConcurrentStress();
    std::printf (failures == 0 ? "capture: all tests passed\n" : "capture: %d FAILURES\n", failures);
    return failures == 0 ? 0 : 1;
}
