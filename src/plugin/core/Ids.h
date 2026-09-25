#pragma once
// Typed, time-sortable ULID identifiers. Must stay byte-compatible with gnumbat_core/ids.py:
//   <prefix>_<26 Crockford chars>   e.g. bk_01J8Z3V0Q9M5K2H7W4X6C1D8EF
#include <juce_core/juce_core.h>

namespace gnumbat::ids
{
    /** 26-char ULID. Monotonic within a process, even inside one millisecond. Thread-safe. */
    juce::String ulid (juce::int64 explicitTimeMs = -1);

    /** "<prefix>_<ulid>", e.g. newId ("bk"). Prefixes: bk dc an ds dv md mv job cmd arr pl np. */
    juce::String newId (const juce::String& prefix);

    /** True iff `value` is exactly "<prefix>_<26 Crockford chars>". */
    bool isId (const juce::String& value, const juce::String& prefix);

    /** Creation time (ms since epoch) embedded in an id or bare ULID; 0 if malformed. */
    juce::int64 timeMs (const juce::String& idOrUlid);

    /** Short display form: prefix + last 6 chars (ULID tails are the random part; the head is the time). */
    juce::String shortId (const juce::String& id);
}
