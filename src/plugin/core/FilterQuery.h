#pragma once
// Filter AST evaluation over a flat "bake view" var. Semantics are identical to
// gnumbat_core/filters.py (see that file's docstring) and are verified against
// conformance/filter_cases.json by tests/core_tests.cpp.
//
//   node := {"and":[node...]} | {"or":[node...]} | {"not":node} | {"text":"free text"}
//         | {"field":"fields/tempo","op":"between","value":[110,130]}
//   ops  := eq ne lt lte gt gte between in contains has prefix exists
#include <juce_core/juce_core.h>

namespace gnumbat::filter
{
    bool matches (const juce::var& view, const juce::var& query);

    /** "" if the query is well-formed, else a readable problem (unknown op, missing field, ...). */
    juce::String validate (const juce::var& query);

    /** Builders used by the UI filter chips. */
    juce::var leaf (const juce::String& field, const juce::String& op, const juce::var& value);
    juce::var all (const juce::Array<juce::var>& nodes);          // {"and":[...]}, or the single node, or {}
    juce::var text (const juce::String& s);

    /** Human-readable one-liner for chips, e.g.  fields/tempo between [110,130]. */
    juce::String describe (const juce::var& node);

    /** Which fields exist in this library (the filter UI builds pickers from this; nothing assumes a field). */
    struct FieldInfo
    {
        juce::String path;
        juce::StringArray types;                  // "number" "string" "bool" "list"
        int count = 0;
        bool hasRange = false;
        double min = 0, max = 0;
        juce::StringArray topValues;              // most frequent string values
    };
    juce::Array<FieldInfo> catalog (const juce::Array<juce::var>& views, int maxDepth = 6);
}
