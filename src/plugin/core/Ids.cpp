#include "Ids.h"
#include <mutex>
#include <random>

namespace gnumbat::ids
{
    namespace
    {
        constexpr const char* kCrockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

        struct Rand80 { juce::uint64 lo = 0; juce::uint32 hi = 0; };   // 80 random bits

        Rand80 freshRandom()
        {
            static thread_local std::mt19937_64 gen { std::random_device{}() ^ (juce::uint64) juce::Time::getHighResolutionTicks() };
            Rand80 r;
            r.lo = gen();
            r.hi = (juce::uint32) (gen() & 0xffffu);
            return r;
        }

        juce::String encodeTime (juce::uint64 ms)
        {
            char out[11] = {};
            for (int i = 9; i >= 0; --i) { out[i] = kCrockford[ms & 31u]; ms >>= 5; }
            return juce::String (out);
        }

        juce::String encodeRand (const Rand80& r)
        {
            char out[17] = {};
            for (int k = 0; k < 16; ++k)          // k = 0 is the least-significant 5 bits
            {
                const int shift = 5 * k;
                juce::uint32 v;
                if (shift + 5 <= 64)      v = (juce::uint32) ((r.lo >> shift) & 31u);
                else if (shift < 64)      v = (juce::uint32) (((r.lo >> shift) | ((juce::uint64) r.hi << (64 - shift))) & 31u);
                else                      v = (juce::uint32) ((r.hi >> (shift - 64)) & 31u);
                out[15 - k] = kCrockford[v];
            }
            return juce::String (out);
        }

        std::mutex lock;
        juce::int64 lastMs = -1;
        Rand80 lastRand;
    }

    juce::String ulid (juce::int64 explicitTimeMs)
    {
        if (explicitTimeMs >= 0)
            return encodeTime ((juce::uint64) explicitTimeMs) + encodeRand (freshRandom());

        std::scoped_lock sl (lock);
        auto ms = juce::Time::currentTimeMillis();
        if (ms <= lastMs)
        {
            ms = lastMs;
            if (++lastRand.lo == 0)                       // carry into the high 16 bits
            {
                if (++lastRand.hi > 0xffffu) { ++ms; lastRand = freshRandom(); }
            }
        }
        else
            lastRand = freshRandom();

        lastMs = ms;
        return encodeTime ((juce::uint64) ms) + encodeRand (lastRand);
    }

    juce::String newId (const juce::String& prefix) { return prefix + "_" + ulid(); }

    bool isId (const juce::String& value, const juce::String& prefix)
    {
        if (! value.startsWith (prefix + "_") || value.length() != prefix.length() + 27)
            return false;
        const juce::String alphabet (kCrockford);
        for (auto p = value.getCharPointer() + prefix.length() + 1; *p != 0; ++p)
            if (! alphabet.containsChar (*p))
                return false;
        return true;
    }

    juce::int64 timeMs (const juce::String& idOrUlid)
    {
        const auto body = idOrUlid.fromLastOccurrenceOf ("_", false, false);
        if (body.length() < 10) return 0;
        juce::int64 n = 0;
        for (int i = 0; i < 10; ++i)
        {
            const int v = juce::String (kCrockford).indexOfChar (body[i]);
            if (v < 0) return 0;
            n = n * 32 + v;
        }
        return n;
    }

    juce::String shortId (const juce::String& id)
    {
        const auto prefix = id.upToFirstOccurrenceOf ("_", false, false);
        return prefix + "_" + id.getLastCharacters (6);
    }
}
