#pragma once
// The Spectromorphology Lexicon: Denis Smalley's spectrum/morphology vocabulary ("Spectromorphology:
// Explaining Sound-Shapes", Organised Sound 2(2), 1997), under the SPECTRUM/MORPHOLOGY split, and
// extended with Gnumbat's own MORPHOLOGY vocabulary -- PRIMITIVE (the attack/decay/sustain/release
// envelope), SECTIONAL MOTION (a single trajectory's own ascent/descent/stasis) and COMPOSITE
// (motion that emerges from several trajectories together) -- as one flat parent-linked table. This is the SAME data the tree diagram draws
// (ui::SpectromorphologyTree, opened from the Library's "?" button -- see FilterBar) and, in time,
// what the bake/tagging system itself can offer as autocomplete/validation for spectral_tags /
// morphology_tags (BankView::promptAddSpectralTag/promptAddMorphologyTag) -- neither one keeps its
// own separate copy of the words. Nothing here is enforced on the tags a Bake actually stores: those
// stay freeform #words in whatever language the user types (see NotationCard.h), this is only the
// suggested vocabulary and its definitions.
#include <juce_core/juce_core.h>
#include <vector>

namespace gnumbat
{
    struct SpectroTerm
    {
        juce::String id;             // stable key, lower_snake_case (e.g. "inharmonic")
        juce::String label;          // as drawn, e.g. "INHARMONIC"
        juce::String parentId;       // "" for the root
        juce::String definition;
        juce::StringArray examples;  // suggested #tag words (lower-case, no leading '#')
    };

    /** The whole tree, root first, every parent listed before its own children. */
    const std::vector<SpectroTerm>& spectromorphologyLexicon();

    /** nullptr if id isn't in the lexicon. */
    const SpectroTerm* findSpectroTerm (const juce::String& id);
}
