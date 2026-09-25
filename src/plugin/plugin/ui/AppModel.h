#pragma once
// The single source of truth the UI components read from. Owns the Library handle, a background scanner that keeps
// a snapshot of every Bake view + worker/job state fresh (never on the message thread, never on the audio thread),
// and the browse state (search, filter chips, sort, selection). Components listen for changes and repaint.
#include <juce_events/juce_events.h>
#include <juce_core/juce_core.h>
#include <memory>
#include "../../core/Library.h"
#include "../../core/Jobs.h"
#include "../../core/MapData.h"
#include "../../core/FilterQuery.h"
#include "../../core/Settings.h"

namespace gnumbat::ui
{
    struct BakeRow { juce::String id; juce::var view; };

    struct IndexSnapshot
    {
        std::vector<BakeRow> rows;                               // ascending id == creation order
        WorkerStatus worker;
        JobSubmitter::Counts jobs;
        juce::Array<Library::DatasetInfo> datasets;
        juce::Array<Library::FeatureSetInfo> featureSets;
        juce::StringArray mapSpaces;                             // feature sets that have a map on disk
        std::shared_ptr<const MapDoc> map;                       // current map space (null if none/unchanged handled by model)
        bool mapReplaced = false;
        juce::String error;                                      // e.g. library folder unreadable
        juce::uint64 revision = 0;
    };

    class AppModel final : public juce::ChangeBroadcaster
    {
    public:
        AppModel();
        ~AppModel();

        // ---- library
        juce::Result openLibrary (const juce::File& root);      // creates the library if the folder is empty/new
        bool hasLibrary() const noexcept { return library != nullptr; }
        Library& lib() { jassert (library); return *library; }
        const juce::File& root() const noexcept { return rootDir; }
        Settings& settings() noexcept { return settingsDoc; }
        const Settings& settings() const noexcept { return settingsDoc; }

        /** Synchronous scan+apply on the calling (message) thread. Used at open, after edits, and by tests. */
        void refreshNow();
        void requestRefresh();                                   // ask the background thread to rescan soon

        // ---- data (message thread)
        const std::vector<BakeRow>& rows() const noexcept { return snap ? snap->rows : emptyRows; }
        const std::vector<int>& visible() const noexcept { return visibleIdx; }
        const BakeRow* rowById (const juce::String& id) const;
        const IndexSnapshot& snapshot() const { static const IndexSnapshot empty; return snap ? *snap : empty; }
        juce::Array<juce::var> allViews() const;
        juce::Array<juce::var> visibleViews() const;

        // ---- browse state
        void setSearch (const juce::String&);
        const juce::String& search() const noexcept { return searchText; }
        void setChips (const juce::Array<juce::var>&);
        const juce::Array<juce::var>& chips() const noexcept { return chipList; }
        juce::var currentQuery() const;                          // search + chips as one filter AST
        void setSort (const juce::String& key, bool ascending);
        const juce::String& sortKey() const noexcept { return sortBy; }
        bool sortAscending() const noexcept { return sortAsc; }

        void setSelection (const juce::StringArray& ids, const juce::String& primaryId = {});
        const juce::StringArray& selection() const noexcept { return selected; }
        const juce::String& primary() const noexcept { return primaryId; }

        // ---- hover (map <-> bank cross-highlight)
        void setHover (const juce::String& id);
        const juce::String& hover() const noexcept { return hoverId; }

        // ---- map
        void setMapSpace (const juce::String& featureSetId);
        const juce::String& mapSpace() const noexcept { return mapSpaceId; }
        const MapDoc* map() const noexcept { return currentMap.get(); }

        // ---- actions (message thread; each returns an error string, empty on success)
        juce::String editSemantic (const juce::StringArray& ids, const SemanticEdit&);
        juce::String trash (const juce::StringArray& ids);
        juce::String undoTrash();
        bool canUndoTrash() const noexcept { return ! trashStack.isEmpty(); }
        juce::String reprocess (const juce::StringArray& ids, const juce::String& what);   // "all" | "decompose" | "analyze"
        juce::String createDatasetWith (const juce::String& name, const juce::StringArray& ids);
        juce::String addToDataset (const juce::String& datasetId, const juce::StringArray& ids);
        juce::String removeFromDataset (const juce::String& datasetId, const juce::StringArray& ids);
        juce::String computeMap (const juce::String& featureSetId, const juce::String& method);
        void ensureWorker();                                     // start one if autostart is on and none is alive
        juce::String lastMessage;                                // most recent status line for the footer

        /** Values the bank/map need from a view. */
        static juce::String tempoText (const juce::var& view);
        static double tempoValue (const juce::var& view);        // 0 if unknown
        juce::StringArray relatedIds (const juce::String& kind, const juce::String& bakeId) const;   // "dataset" | "model" | "group" | "tag"

    private:
        struct Impl;
        std::unique_ptr<Impl> impl;

        std::unique_ptr<Library> library;
        juce::File rootDir;
        Settings settingsDoc;
        std::shared_ptr<const IndexSnapshot> snap;
        std::shared_ptr<const MapDoc> currentMap;
        std::vector<BakeRow> emptyRows;
        std::vector<int> visibleIdx;

        juce::String searchText, sortBy = "created", mapSpaceId = "spectral", primaryId, hoverId;
        juce::Array<juce::var> chipList;
        bool sortAsc = false;
        juce::StringArray selected;
        juce::StringArray trashStack;                            // trashed dir paths, most recent last

        void applySnapshot (std::shared_ptr<IndexSnapshot>);
        void recomputeVisible();

        friend struct Impl;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AppModel)
    };
}
