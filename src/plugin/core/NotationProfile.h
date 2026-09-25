#pragma once
// User-defined notation profiles. raw_notation is stored verbatim by the caller; a profile may
// additionally DERIVE tags and fields from it. Default = freeform (whole string is one tag).
// Semantics are identical to gnumbat_core/notation.py and verified by conformance/notation_cases.json.
//
// Regex dialect: ECMAScript subset, "search" semantics, optional flag "i". Matching is byte-wise on
// UTF-8 (\s \d \w are ASCII), which is what the Python side is documented to rely on for portability.
#include <juce_core/juce_core.h>

namespace gnumbat::notation
{
    struct Parsed
    {
        juce::StringArray tags;
        juce::StringArray fieldOrder;      // insertion order, for stable display
        juce::var fields;                  // object name -> number | string
        juce::String error;                // non-empty if the profile itself is invalid (bad regex)
    };

    juce::var freeformProfile();
    juce::var builtinProfile (const juce::String& id);         // void if unknown
    juce::Array<juce::var> builtinProfiles();

    /** Pure function of (raw, profile). Never throws; a bad rule regex sets Parsed::error and is skipped. */
    Parsed parse (const juce::String& raw, const juce::var& profile);

    /** Empty string if the profile is well-formed; otherwise a human-readable problem. */
    juce::String validateProfile (const juce::var& profile);
}
