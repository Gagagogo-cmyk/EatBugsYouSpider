#include "AppModel.h"
#include "../../core/JsonIo.h"
#include "../../core/Ids.h"
#include <algorithm>
#include <map>

namespace gnumbat::ui
{
    using juce::String;
    using juce::var;

    // ---------------------------------------------------------------------------------------- scanner (background thread)
    struct AppModel::Impl : private juce::Thread
    {
        struct Cache { juce::String sig; var view; };

        explicit Impl (AppModel& o) : juce::Thread ("gnumbat-index"), owner (o), alive (std::make_shared<std::atomic<AppModel*>> (&o)) {}
        ~Impl() override { alive->store (nullptr); signalThreadShouldExit(); wake.signal(); stopThread (4000); }

        void start() { if (! isThreadRunning()) startThread (juce::Thread::Priority::low); }
        void poke() { wake.signal(); }

        void setTarget (const juce::File& root, const String& space)
        {
            const juce::ScopedLock sl (lock);
            if (root != scanRoot) { cache.clear(); lastMapStamp = -1; lastRevision = 0; }
            if (space != mapSpace) lastMapStamp = -1;
            scanRoot = root; mapSpace = space;
        }

        std::shared_ptr<IndexSnapshot> scanOnce()
        {
            const juce::ScopedLock scanGuard (scanLock);                 // background loop and refreshNow() share one cache
            juce::File root; String space;
            { const juce::ScopedLock sl (lock); root = scanRoot; space = mapSpace; }
            auto s = std::make_shared<IndexSnapshot>();
            if (! Library::looksLikeLibrary (root)) { s->error = "not a Gnumbat library: " + root.getFullPathName(); return s; }

            Library lib (root);
            const auto assocFile = root.getChildFile ("derived/associations.json");
            const auto assocStamp = String (assocFile.getLastModificationTime().toMilliseconds()) + "/" + String (assocFile.getSize());
            if (assocStamp != lastAssocStamp) { assoc = lib.associations(); lastAssocStamp = assocStamp; cache.clear(); }

            std::map<String, Cache> next;
            bool anyTransient = false;
            for (auto& id : lib.listBakeIds())
            {
                const auto d = lib.bakeDir (id);
                String sig;
                for (auto* f : { "bake.json", "state.json", "semantic.json" })
                {
                    const auto file = d.getChildFile (f);
                    sig << file.getLastModificationTime().toMilliseconds() << ':' << file.getSize() << ';';
                }
                Cache c;
                auto it = cache.find (id);
                const auto st = it != cache.end() ? json::getString (it->second.view, "state") : String();
                // Also re-read (not cached) while the instrument pipeline is still working on it:
                // its progress lives in a file outside the Bake folder (see Library::bakeView).
                const bool transient = st == "DECOMPOSING" || st == "ANALYZING"
                                    || (it != cache.end() && json::getBool (it->second.view, "pipeline_active"));
                if (it != cache.end() && it->second.sig == sig && ! transient) c = it->second;
                else
                {
                    c.sig = sig;
                    c.view = lib.bakeView (id, assoc);
                    if (c.view.isVoid()) continue;                         // half-written: pick it up next scan
                }
                anyTransient = anyTransient || json::getString (c.view, "state") == "DECOMPOSING" || json::getString (c.view, "state") == "ANALYZING"
                                            || json::getBool (c.view, "pipeline_active");
                s->rows.push_back ({ id, c.view });
                next[id] = std::move (c);
            }
            cache = std::move (next);

            s->worker = readWorkerStatus (root);
            s->jobs = JobSubmitter (root).counts();
            s->datasets = lib.listDatasets();
            s->featureSets = lib.listFeatureSets();
            s->mapSpaces = listMapFeatureSets (root);
            {
                const auto f = root.getChildFile ("derived/maps").getChildFile (space + ".json");
                const juce::int64 stamp = f.existsAsFile() ? f.getLastModificationTime().toMilliseconds() ^ (f.getSize() << 20) : 0;
                if (stamp != lastMapStamp)
                {
                    lastMapStamp = stamp;
                    s->mapReplaced = true;
                    if (stamp != 0) s->map = std::make_shared<const MapDoc> (readMap (root, space));
                }
            }
            s->revision = ++lastRevision;
            busy = anyTransient || s->jobs.pending > 0 || s->jobs.running > 0;
            return s;
        }

        void run() override
        {
            while (! threadShouldExit())
            {
                auto snapshot = scanOnce();
                auto weak = alive;
                juce::MessageManager::callAsync ([weak, snapshot]
                {
                    if (auto* m = weak->load()) m->applySnapshot (std::const_pointer_cast<IndexSnapshot> (snapshot));
                });
                wake.wait (busy ? 400 : 1500);
            }
        }

        AppModel& owner;
        std::shared_ptr<std::atomic<AppModel*>> alive;
        juce::WaitableEvent wake;
        juce::CriticalSection lock, scanLock;
        juce::File scanRoot;
        String mapSpace;
        std::map<String, Cache> cache;
        var assoc;
        String lastAssocStamp;
        juce::int64 lastMapStamp = -1;
        juce::uint64 lastRevision = 0;
        std::atomic<bool> busy { false };
    };

    // ---------------------------------------------------------------------------------------- model
    AppModel::AppModel() : impl (std::make_unique<Impl> (*this)), settingsDoc (Settings::load()) {}
    AppModel::~AppModel() = default;

    juce::Result AppModel::openLibrary (const juce::File& root)
    {
        if (! Library::looksLikeLibrary (root))
        {
            // Never silently turn a non-empty, unrelated folder into a library.
            if (root.exists() && root.getNumberOfChildFiles (juce::File::findFilesAndDirectories) > 0)
                return juce::Result::fail (root.getFullPathName() + " exists and is not a Gnumbat library");
            if (auto r = Library::init (root); r.failed()) return r;
        }
        Library::init (root);                        // idempotent: makes sure spool dirs/built-in profiles exist
        library = std::make_unique<Library> (root);
        rootDir = root;
        settingsDoc.setLibraryRoot (root);
        selected.clear(); primaryId = {};
        snap.reset(); currentMap.reset(); visibleIdx.clear();
        impl->setTarget (root, mapSpaceId);
        refreshNow();
        impl->start();
        return juce::Result::ok();
    }

    void AppModel::refreshNow()
    {
        if (! library) return;
        impl->setTarget (rootDir, mapSpaceId);
        auto s = impl->scanOnce();                  // serialised with the background loop; shares its incremental cache
        applySnapshot (s);
        impl->poke();
    }

    void AppModel::requestRefresh() { impl->poke(); }

    void AppModel::applySnapshot (std::shared_ptr<IndexSnapshot> s)
    {
        if (! library || s == nullptr) return;
        const bool sameData = snap != nullptr && ! s->mapReplaced && snap->rows.size() == s->rows.size();
        if (s->mapReplaced) currentMap = s->map;
        // cheap change test so an idle library does not repaint every second
        bool changed = ! sameData || snap == nullptr;
        if (! changed)
            for (size_t i = 0; i < s->rows.size() && ! changed; ++i)
                changed = ! (s->rows[i].id == snap->rows[i].id
                             && json::getString (s->rows[i].view, "state") == json::getString (snap->rows[i].view, "state")
                             && (int) json::getNumber (s->rows[i].view, "rev") == (int) json::getNumber (snap->rows[i].view, "rev")
                             && juce::JSON::toString (json::get (s->rows[i].view, "datasets"), true) == juce::JSON::toString (json::get (snap->rows[i].view, "datasets"), true)
                             && juce::JSON::toString (json::get (s->rows[i].view, "models"), true) == juce::JSON::toString (json::get (snap->rows[i].view, "models"), true));
        const auto oldWorker = snap ? snap->worker.summary() : String();
        const auto oldJobs = snap ? snap->jobs.pending * 1000 + snap->jobs.running * 100 + snap->jobs.failed : -1;
        const int newJobs = s->jobs.pending * 1000 + s->jobs.running * 100 + s->jobs.failed;
        changed = changed || oldWorker != s->worker.summary() || oldJobs != newJobs || s->mapReplaced
                  || (snap && (snap->datasets.size() != s->datasets.size() || snap->featureSets.size() != s->featureSets.size()));
        // progress of transient stages changes state.json but not "state": always repaint while something is running
        changed = changed || s->jobs.running > 0;

        snap = s;
        if (! changed) return;

        // drop selection entries that vanished
        juce::StringArray keep;
        for (auto& id : selected) if (rowById (id) != nullptr) keep.add (id);
        selected = keep;
        if (rowById (primaryId) == nullptr) primaryId = selected.isEmpty() ? String() : selected[selected.size() - 1];
        recomputeVisible();
        sendChangeMessage();
    }

    const BakeRow* AppModel::rowById (const String& id) const
    {
        if (id.isEmpty()) return nullptr;
        for (auto& r : rows()) if (r.id == id) return &r;
        return nullptr;
    }

    juce::Array<var> AppModel::allViews() const { juce::Array<var> a; for (auto& r : rows()) a.add (r.view); return a; }
    juce::Array<var> AppModel::visibleViews() const { juce::Array<var> a; for (int i : visibleIdx) a.add (rows()[(size_t) i].view); return a; }

    // ---- values ------------------------------------------------------------------------------------------------
    double AppModel::tempoValue (const var& v)
    {
        for (auto* path : { "fields/tempo", "capture/tempo_bpm", "analysis/tempo_bpm" })
        {
            const auto x = json::get (v, path);
            if (json::isNumber (x) && (double) x > 0.0) return (double) x;
        }
        return 0.0;
    }

    String AppModel::tempoText (const var& v)
    {
        const auto t = tempoValue (v);
        if (t <= 0.0) return "-";
        // certain = typed by the user, or reported by the DAW -- only a worker-side estimate
        // (analysis/tempo_bpm: madmom if configured, else the onset-autocorrelation fallback,
        // used when there's no host tempo at all -- e.g. a file dropped straight into Standalone)
        // is approximate, marked with a "~" suffix. [Brackets] are reserved for showing which
        // option in a menu/tab group is currently selected (see PluginEditor::showTab).
        const bool certain = json::isNumber (json::get (v, "fields/tempo")) || json::isNumber (json::get (v, "capture/tempo_bpm"));
        const String s = String (t, std::abs (t - std::round (t)) < 1e-9 ? 0 : 1);
        return certain ? s : s + "~";
    }

    static double sortNumber (const String& key, const var& v)
    {
        if (key == "tempo") return AppModel::tempoValue (v);
        if (key == "length") return json::getNumber (v, "duration_s");
        if (key == "slices") return json::getNumber (v, "analysis/n_slices");
        return 0.0;
    }

    void AppModel::recomputeVisible()
    {
        visibleIdx.clear();
        const auto q = currentQuery();
        const auto& r = rows();
        for (size_t i = 0; i < r.size(); ++i)
            if (filter::matches (r[i].view, q)) visibleIdx.push_back ((int) i);

        const auto key = sortBy;
        const bool asc = sortAsc;
        auto strOf = [&] (const var& v) -> String
        {
            if (key == "state") return json::getString (v, "state");
            if (key == "notation") return json::getString (v, "notation").toLowerCase();
            if (key == "tags") return json::getStrings (v, "tags").joinIntoString (",").toLowerCase();
            if (key == "datasets") return json::getStrings (v, "datasets").joinIntoString (",").toLowerCase();
            if (key == "models") return json::getStrings (v, "models").joinIntoString (",").toLowerCase();
            if (key == "creator") return json::getString (v, "creator").toLowerCase();
            return {};
        };
        const bool numeric = key == "tempo" || key == "length" || key == "slices";
        std::stable_sort (visibleIdx.begin(), visibleIdx.end(), [&] (int a, int b)
        {
            const auto& va = r[(size_t) a].view; const auto& vb = r[(size_t) b].view;
            int c = 0;
            if (numeric) { const double x = sortNumber (key, va), y = sortNumber (key, vb); c = (x > y) - (x < y); }
            else if (key == "created" || key == "id") c = r[(size_t) a].id.compare (r[(size_t) b].id);
            // an ISO "...Z" timestamp string sorts chronologically as plain text, same as a Bake id does
            else if (key == "edited") c = json::getString (va, "updated_at").compare (json::getString (vb, "updated_at"));
            else c = strOf (va).compare (strOf (vb));
            if (c == 0) c = r[(size_t) a].id.compare (r[(size_t) b].id);
            return asc ? c < 0 : c > 0;
        });
    }

    // ---- browse state -------------------------------------------------------------------------------------------
    var AppModel::currentQuery() const
    {
        juce::Array<var> nodes;
        if (searchText.trim().isNotEmpty()) nodes.add (filter::text (searchText.trim()));
        for (auto& c : chipList) nodes.add (c);
        return filter::all (nodes);
    }

    void AppModel::setSearch (const String& s) { if (s == searchText) return; searchText = s; recomputeVisible(); sendChangeMessage(); }
    void AppModel::setChips (const juce::Array<var>& c) { chipList = c; recomputeVisible(); sendChangeMessage(); }
    void AppModel::setSort (const String& k, bool asc) { sortBy = k; sortAsc = asc; recomputeVisible(); sendChangeMessage(); }

    void AppModel::setSelection (const juce::StringArray& ids, const String& prim)
    {
        if (ids == selected && (prim.isEmpty() || prim == primaryId)) return;
        selected = ids;
        primaryId = prim.isNotEmpty() ? prim : (ids.isEmpty() ? String() : ids[ids.size() - 1]);
        sendChangeMessage();
    }

    void AppModel::setHover (const String& id) { if (id == hoverId) return; hoverId = id; sendChangeMessage(); }

    void AppModel::setMapSpace (const String& id)
    {
        if (id == mapSpaceId) return;
        mapSpaceId = id;
        currentMap.reset();
        if (library) { impl->setTarget (rootDir, mapSpaceId); refreshNow(); }
        sendChangeMessage();
    }

    juce::StringArray AppModel::relatedIds (const String& kind, const String& bakeId) const
    {
        juce::StringArray out;
        const auto* me = rowById (bakeId);
        if (me == nullptr) return out;
        const auto key = kind == "dataset" ? "datasets" : kind == "model" ? "models" : kind == "group" ? "groups" : "tags";
        const auto mine = json::getStrings (me->view, key);
        for (auto& r : rows())
        {
            const auto theirs = json::getStrings (r.view, key);
            for (auto& m : mine) if (theirs.contains (m, true)) { out.add (r.id); break; }
        }
        return out;
    }

    // ---- actions ------------------------------------------------------------------------------------------------
    static String fail (const juce::Result& r) { return r.wasOk() ? String() : r.getErrorMessage(); }

    String AppModel::editSemantic (const juce::StringArray& ids, const SemanticEdit& e)
    {
        if (! library) return "no library";
        String errors;
        int done = 0;
        for (auto& id : ids)
        {
            auto r = library->updateSemantic (id, e, -1);          // additive edits: last-writer-wins on disjoint changes is what the user asked for
            if (r.failed()) errors << id << ": " << r.getErrorMessage() << "\n"; else ++done;
        }
        refreshNow();
        lastMessage = errors.isEmpty() ? "edited " + String (done) + " Bake" + (done == 1 ? "" : "s") : errors.trim();
        return errors.trim();
    }

    String AppModel::trash (const juce::StringArray& ids)
    {
        if (! library) return "no library";
        String errors;
        for (auto& id : ids)
        {
            juce::File to;
            auto r = library->trashBake (id, &to);
            if (r.failed()) errors << id << ": " << r.getErrorMessage() << "\n";
            else trashStack.add (to.getFullPathName());
        }
        for (auto& id : ids) selected.removeString (id);
        refreshNow();
        impl->poke();
        lastMessage = errors.isEmpty() ? "moved " + String (ids.size()) + " to .trash (undo available)" : errors.trim();
        return errors.trim();
    }

    String AppModel::undoTrash()
    {
        if (! library || trashStack.isEmpty()) return "nothing to undo";
        const auto last = trashStack[trashStack.size() - 1];
        trashStack.remove (trashStack.size() - 1);
        String id;
        auto r = library->restoreBake (juce::File (last), &id);
        refreshNow();
        if (r.wasOk()) { lastMessage = "restored " + ids::shortId (id); setSelection ({ id }); }
        return fail (r);
    }

    String AppModel::reprocess (const juce::StringArray& ids, const String& what)
    {
        if (! library) return "no library";
        JobSubmitter js (rootDir);
        for (auto& id : ids)
        {
            var params = json::object ({ { "bake_id", id } });
            if (what == "all") params.getDynamicObject()->setProperty ("decompose", settingsDoc.decomposer());
            const auto type = what == "decompose" ? "decompose_bake" : what == "analyze" ? "analyze_bake" : "process_bake";
            if (js.submit (type, params).isEmpty()) return "cannot write to the job spool";
        }
        ensureWorker();
        requestRefresh();
        lastMessage = "queued " + String (ids.size()) + " job" + (ids.size() == 1 ? "" : "s");
        return {};
    }

    String AppModel::createDatasetWith (const String& name, const juce::StringArray& ids)
    {
        if (! library) return "no library";
        String id;
        auto r = library->createDataset (name, ids, id);
        if (r.wasOk()) { JobSubmitter (rootDir).submit ("reindex", var()); ensureWorker(); lastMessage = "dataset '" + name + "' created"; }
        refreshNow();
        return fail (r);
    }

    String AppModel::addToDataset (const String& dsId, const juce::StringArray& ids)
    {
        if (! library) return "no library";
        auto r = library->addToDataset (dsId, ids);
        if (r.wasOk()) { JobSubmitter (rootDir).submit ("reindex", var()); ensureWorker(); lastMessage = "added " + String (ids.size()) + " to dataset"; }
        refreshNow();
        return fail (r);
    }

    String AppModel::removeFromDataset (const String& dsId, const juce::StringArray& ids)
    {
        if (! library) return "no library";
        auto r = library->removeFromDataset (dsId, ids);
        if (r.wasOk()) { JobSubmitter (rootDir).submit ("reindex", var()); ensureWorker(); }
        refreshNow();
        return fail (r);
    }

    String AppModel::computeMap (const String& fs, const String& method)
    {
        if (! library) return "no library";
        if (JobSubmitter (rootDir).submit ("project_map", json::object ({ { "feature_set_id", fs }, { "method", method } })).isEmpty())
            return "cannot write to the job spool";
        ensureWorker();
        requestRefresh();
        lastMessage = "map projection queued";
        return {};
    }

    void AppModel::ensureWorker()
    {
        if (! library || ! settingsDoc.autostartWorker()) return;
        if (readWorkerStatus (rootDir).alive) return;
        auto r = launchWorker (settingsDoc, rootDir);
        if (r.failed()) lastMessage = "worker: " + r.getErrorMessage();
    }
}
