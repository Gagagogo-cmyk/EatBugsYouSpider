#pragma once
// The Library: a directory of Bakes (plus datasets, models, derived caches, a job spool).
// This is the C++ client of the on-disk contract defined by src/core/gnumbat_core/schemas and
// implemented by the Python reference core. Ownership rules (identical to the Python side):
//
//   bake.json          written once at creation, never modified
//   state.json         creator writes CAPTURED; afterwards only the worker
//   semantic.json      clients, revisioned (rev = optimistic concurrency), previous revs in *.history.jsonl
//   audio/ decompositions/ analyses/   written once by the worker, then immutable
//
// Everything here works with no worker running: the plugin can create, browse, tag and export
// Bakes offline; processing simply waits in the spool until a worker appears.
#include <juce_core/juce_core.h>
#include <map>
#include <memory>
#include <mutex>
#include <vector>

namespace gnumbat
{
    static constexpr const char* kCoreVersion = "0.1.0";

    /** Planar float32 audio, exactly as captured (no dither, no clipping, no resampling). */
    struct CapturedAudio
    {
        std::vector<std::vector<float>> channels;
        double sampleRate = 0.0;
        juce::int64 frames() const { return channels.empty() ? 0 : (juce::int64) channels[0].size(); }
        int numChannels() const { return (int) channels.size(); }
    };

    /** Where the audio came from — becomes bake.json "capture". Everything optional except `complete`. */
    struct CaptureMeta
    {
        juce::String hostName, hostVersion, pluginVersion, session, trackName;
        bool hasTimeline = false;
        juce::int64 startSample = 0, endSample = 0;
        double timelineSampleRate = 0.0;
        bool hasPpq = false;
        double startPpq = 0.0, endPpq = 0.0;
        double tempoBpm = 0.0;                 // <= 0 : unknown
        int timeSigNum = 0, timeSigDen = 0;    // 0 : unknown
        double coverage = 1.0;                 // fraction of the requested range actually heard
        bool complete = true;
        bool offline = false;                  // captured during an offline bounce
        juce::String mode;                     // "range" | "last_bars" | "loop" | "manual"
        juce::var toVar() const;
    };

    struct NewBake
    {
        CapturedAudio audio;
        bool isImport = false;                 // true => origin.kind "import"
        juce::String importOriginalName, importSourcePath;
        CaptureMeta capture;
        juce::String rawNotation;              // stored verbatim, always
        juce::var profile;                     // void => freeform. Derived tags/fields come from here.
        juce::StringArray extraTags, groups;
        juce::var extraFields;                 // object or void; origin "user"
        juce::String appName = "gnumbat-plugin";
        juce::String modelId;                  // the Model (core/ModelTree.h) current when this was baked; "" => none
        bool submit = true;                    // queue process_bake
        juce::String decomposer = "auto";      // auto | skip | demucs | testsplit | <backend id>
        juce::var processParams;               // extra process_bake params (object) or void
        /** Also write the audio into the EBYS instrument's raw_uploads/ (see Handoff.h). Acts only when the decomposer is
            "auto" or "instrument": choosing skip / demucs / testsplit means "do not feed the instrument". */
        struct Handoff { bool enabled = false; juce::File ebysRoot; } handoff;
    };

    struct SemanticEdit
    {
        bool setRawNotation = false;  juce::String rawNotation;
        bool reparse = false;         juce::var profile;                // reparse with this profile (void => current)
        bool setTags = false;         juce::StringArray tags;
        juce::StringArray addTags, removeTags, addGroups, removeGroups, removeFields;
        // Spectromorphological tagging (Denis Smalley's vocabulary as a suggested starting
        // point, never an enforced one -- the user types whatever words fit, in whatever
        // language): spectral_tags describes the spectrum itself at a moment (e.g. "noise",
        // "inharmonic", "dense"), morphology_tags describes how it moves/evolves over the
        // Bake's duration (e.g. "ascending", "dilating", "iterative"). Same free add/remove
        // shape as tags/groups above -- see Library::updateSemantic.
        juce::StringArray addSpectralTags, removeSpectralTags, addMorphologyTags, removeMorphologyTags;
        juce::var setFields;                                            // object: name -> number|string|bool|array
        bool setNotes = false;        juce::String notes;
        juce::String updatedBy = "gnumbat-plugin";
    };

    class Library
    {
    public:
        static bool looksLikeLibrary (const juce::File& root);
        /** Create (or open, if it already is one) a library. Idempotent. */
        static juce::Result init (const juce::File& root);

        explicit Library (const juce::File& root);
        const juce::File& root() const noexcept { return rootDir; }
        juce::String libraryId() const;

        juce::File bakesDir() const   { return rootDir.getChildFile ("bakes"); }
        juce::File bakeDir (const juce::String& bakeId) const { return bakesDir().getChildFile (bakeId); }
        juce::File derivedDir() const { return rootDir.getChildFile ("derived"); }
        juce::File audioFile (const juce::String& bakeId) const;
        /** Small, mono, 16-bit companion to audioFile() -- what the plugin's own play/stop
            button actually plays (see CapturePanel/BankView). Falls back to audioFile() for a
            Bake saved before this existed. */
        juce::File previewAudioFile (const juce::String& bakeId) const;
        juce::StringArray listBakeIds() const;

        // ---- creation (any thread; touches disk; never call from the audio thread)
        /** `warningOut` receives a human-readable note when the Bake was saved but something optional failed (e.g. the hand-off). */
        juce::Result createBake (const NewBake&, juce::String& bakeIdOut, juce::String* warningOut = nullptr);

        // ---- reads
        juce::var readBake (const juce::String& id) const;
        juce::var readState (const juce::String& id) const;
        juce::var readSemantic (const juce::String& id) const;
        juce::var readAnalysis (const juce::String& id) const;          // current analysis or void
        juce::var readDecomposition (const juce::String& id) const;     // current decomposition or void
        /** stem name -> absolute file, for the current decomposition. */
        juce::StringPairArray stemFiles (const juce::String& id) const;
        /** Flat filter-friendly projection (same shape as Python Library.bake_view). */
        juce::var bakeView (const juce::String& id, const juce::var& associations) const;
        juce::var associations() const;                                 // derived/associations.json "bakes" object

        // ---- semantic edits (client side)
        juce::Result updateSemantic (const juce::String& id, const SemanticEdit&, int expectedRev = -1, juce::var* newDoc = nullptr);

        // ---- trash / restore
        juce::Result trashBake (const juce::String& id, juce::File* trashedTo = nullptr);
        juce::Result restoreBake (const juce::File& trashed, juce::String* idOut = nullptr);
        /** bake id -> dataset version ids that pin it (deleting such a Bake would break reproducibility). */
        std::map<juce::String, juce::StringArray> bakesPinnedByDatasetVersions() const;

        // ---- notation profiles (user data in the library)
        juce::Array<juce::var> listProfiles() const;                    // builtins + library/notation_profiles
        juce::var getProfile (const juce::String& id) const;            // void if unknown
        juce::Result saveProfile (const juce::var& profile);

        // ---- feature sets (defined by the worker/extractor side; the plugin only lists them)
        struct FeatureSetInfo { juce::String id, name, description; };
        juce::Array<FeatureSetInfo> listFeatureSets() const;

        // ---- datasets (mutable working sets; a Bake can be in any number of them)
        struct DatasetInfo { juce::String id, name; int members = 0; bool hasFilter = false; };
        juce::Array<DatasetInfo> listDatasets() const;
        juce::Result createDataset (const juce::String& name, const juce::StringArray& bakeIds, juce::String& idOut);
        juce::Result addToDataset (const juce::String& datasetId, const juce::StringArray& bakeIds);
        juce::Result removeFromDataset (const juce::String& datasetId, const juce::StringArray& bakeIds);

    private:
        juce::File rootDir;
    };

    /** Low-level pieces exposed for tests. */
    juce::Result writeFloatWav (const juce::File& target, const CapturedAudio& audio);
    /** Mono, decimated, 16-bit PCM -- a deliberately small, "good enough to recognise it by ear"
        companion written alongside writeFloatWav()'s untouched original at createBake() time. */
    juce::Result writePreviewWav (const juce::File& target, const CapturedAudio& audio);
    juce::var computePeaks (const CapturedAudio& audio, int bins = 192);
}
