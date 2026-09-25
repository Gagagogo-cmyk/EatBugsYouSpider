#include "Spectromorphology.h"

namespace gnumbat
{
    using juce::String;
    using juce::StringArray;

    const std::vector<SpectroTerm>& spectromorphologyLexicon()
    {
        static const std::vector<SpectroTerm> lexicon =
        {
            { "spectromorphology", "SPECTROMORPHOLOGY", "",
              "The listener's experience of a sound's spectrum interacting with how that spectrum "
              "changes through time (Denis Smalley, 1997). The two branches below split that in "
              "two: WHAT the spectrum IS (SPECTRUM), and HOW it behaves and evolves (MORPHOLOGY).",
              {} },

            // ---- SPECTRUM: the spectral state/character itself, apart from how it changes -----
            { "spectrum", "SPECTRUM", "spectromorphology",
              "The spectral state or character of a sound, considered frozen -- apart from how it "
              "moves or evolves (that's MORPHOLOGY, the other branch).",
              {} },
            { "spectral_type", "SPECTRAL TYPE", "spectrum",
              "Where a sound falls on the continuum between clearly pitched and completely unpitched.",
              {} },
            { "noise", "NOISE", "spectral_type",
              "An unpitched, spectrally saturated sound -- a state so dense it can't be resolved "
              "into a single pitch.",
              { "noise", "noisy", "hiss", "grain" } },
            { "node", "NODE", "spectral_type",
              "The unstable midpoint of the note-node-noise continuum: tipping between a clear "
              "pitch and noise, not settled as either.",
              { "node", "unstable", "grainy-pitch" } },
            { "note", "NOTE", "spectral_type",
              "A pitched sound with a clear fundamental.",
              { "note", "pitched", "tonal" } },
            { "harmonic", "HARMONIC", "note",
              "A note whose partials line up in a simple integer series above the fundamental.",
              { "harmonic", "tonal", "pure" } },
            { "inharmonic", "INHARMONIC", "note",
              "A note whose partials don't line up neatly -- a metallic, bell-like or detuned colour.",
              { "inharmonic", "metallic", "bell-like", "detuned" } },

            // ---- MORPHOLOGY: how that spectrum behaves and evolves across the sound's own
            // duration -- its envelope (PRIMITIVE), its directional trajectory (SECTIONAL MOTION),
            // and how several such trajectories combine (COMPOSITE).
            { "morphology", "MORPHOLOGY", "spectromorphology",
              "How a sound's spectrum behaves and evolves across its own duration: its own "
              "attack-decay-sustain-release envelope (PRIMITIVE), the directional trajectory of a "
              "single spectral line (SECTIONAL MOTION), and how several such trajectories combine "
              "into a higher-level shape (COMPOSITE).",
              {} },
            { "primitive", "PRIMITIVE", "morphology",
              "The sound's own attack-decay-sustain-release envelope -- the basic amplitude/energy "
              "shape of a single event, from onset through to its own release.",
              {} },
            { "attack", "ATTACK", "primitive",
              "The initial rise from silence up to the envelope's peak.",
              { "attack", "impulse", "onset", "percussive" } },
            { "decay", "DECAY", "primitive",
              "The fall from that initial peak down to the sustained level.",
              { "decay", "falling", "settling" } },
            { "sustain", "SUSTAIN", "primitive",
              "The held level maintained through the body of the sound, between decay and release.",
              { "sustain", "held", "sustained", "body" } },
            { "release", "RELEASE", "primitive",
              "The final fade back to silence once the sustained portion ends -- the sound's own tail.",
              { "release", "fade", "tail", "fading" } },
            { "sectional_motion", "SECTIONAL MOTION", "morphology",
              "WHERE a single spectral trajectory goes on its own: rising, falling, or holding "
              "steady in register. Not yet a relationship between several trajectories -- that's "
              "COMPOSITE.",
              {} },
            { "ascent", "ASCENT", "sectional_motion",
              "Rising in pitch or spectral register.",
              { "ascent", "rising", "ascending" } },
            { "descent", "DESCENT", "sectional_motion",
              "Falling in pitch or spectral register.",
              { "descent", "falling", "descending" } },
            { "stasis", "STASIS", "sectional_motion",
              "Holding steady in pitch or spectral register -- neither rising nor falling.",
              { "stasis", "static", "stationary", "still" } },
            { "composite", "COMPOSITE", "morphology",
              "Motion that emerges from the relationship between several simultaneous spectral "
              "regions or trajectories, rather than describing any one of them alone. E.g. low "
              "rising while high falls reads, at this level, as CONVERGENCE -- not as a fourth "
              "sectional motion in its own right.",
              {} },
            { "convergence", "CONVERGENCE", "composite",
              "Multiple spectral strands drawing together into one.",
              { "convergence", "converging", "merging" } },
            { "divergence", "DIVERGENCE", "composite",
              "One spectral strand splitting apart into several.",
              { "divergence", "diverging", "splitting" } },
            { "agglomeration", "AGGLOMERATION", "composite",
              "Separate grains or events clumping together into a mass.",
              { "agglomeration", "agglomerating", "clumping" } },
            { "dissipation", "DISSIPATION", "composite",
              "A mass breaking up and scattering into separate grains.",
              { "dissipation", "dissipating", "scattering" } },
            { "dilation", "DILATION", "composite",
              "Spectral space expanding -- growing wider.",
              { "dilation", "dilating", "widening" } },
            { "contraction", "CONTRACTION", "composite",
              "Spectral space narrowing -- growing tighter.",
              { "contraction", "contracting", "narrowing" } },
        };
        return lexicon;
    }

    const SpectroTerm* findSpectroTerm (const String& id)
    {
        for (auto& t : spectromorphologyLexicon())
            if (t.id == id)
                return &t;
        return nullptr;
    }
}
