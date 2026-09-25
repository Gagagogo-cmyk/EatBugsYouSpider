#pragma once
// JSON + file helpers shared by every library writer. All library files are written with
// atomicWrite() so a concurrent reader (worker, another plugin instance, CLI) never sees a torn file.
#include <juce_core/juce_core.h>
#include <initializer_list>
#include <utility>

namespace gnumbat::json
{
    /** "2026-09-21T12:34:56.789Z" (UTC, millisecond precision) — same shape as jsonio.utc_now(). */
    juce::String utcNow();

    /** Inverse of utcNow(): parses exactly that shape back to epoch milliseconds. Not a general
        ISO-8601 parser -- every timestamp this codebase writes (created_at, updated_at, ...) is
        written by utcNow()/jsonio.utc_now(), so that's the only shape this needs to read.
        Returns 0 if `iso` doesn't look like one. */
    juce::int64 parseUtc (const juce::String& iso);

    /** Parse a JSON file. Returns a void var (and sets *ok=false) if it is missing or malformed. */
    juce::var readFile (const juce::File& f, bool* ok = nullptr);

    /** Pretty-printed JSON text with trailing newline. */
    juce::String toText (const juce::var& v, bool pretty = true);

    /** Write `text` to a sibling temp file, fsync, then replace `target` atomically. */
    bool atomicWrite (const juce::File& target, const juce::String& text);
    bool atomicWriteBytes (const juce::File& target, const void* data, size_t size);
    bool atomicWriteJson (const juce::File& target, const juce::var& v);

    /** Append one compact JSON line (semantic.history.jsonl style). */
    bool appendLine (const juce::File& f, const juce::var& v);

    juce::String sha256OfFile (const juce::File& f);

    // ---- var builders (order-preserving objects) ------------------------------------------------
    juce::var object (std::initializer_list<std::pair<const char*, juce::var>> props);
    juce::var array (const juce::StringArray& items);
    juce::var emptyObject();

    // ---- safe accessors (missing/wrong-typed => fallback) ---------------------------------------
    juce::var get (const juce::var& obj, const juce::String& path);          // '/'-separated; void if absent
    juce::String getString (const juce::var& obj, const juce::String& path, const juce::String& fallback = {});
    double getNumber (const juce::var& obj, const juce::String& path, double fallback = 0.0);
    bool getBool (const juce::var& obj, const juce::String& path, bool fallback = false);
    juce::StringArray getStrings (const juce::var& obj, const juce::String& path);
    bool has (const juce::var& obj, const juce::String& path);

    bool isNumber (const juce::var& v);
}
