#pragma once
// ModelHub -- the plugin's side of the ONE model list the whole Gnumbat ecosystem shares.
//
// The source of truth is EBYS's model registry (src/network/artifacts/, data/network/registry/),
// served by the gui hub (src/gui/gui_hub_bridge.js, http://localhost:8080) -- the same list
// panel.html's model select shows. The plugin talks to it over plain HTTP:
//
//   GET  /api/models?voter=<me>          the list (+ my own vote on each), ETag'd
//   POST /api/models {sel, args, opId}   newSeed / branch / vote / addBake -- the hub applies it
//                                        and broadcasts to every open panel
//
// Works offline: every change is queued (library/hub/pending.json) and shown straight away; the
// queue is sent, in order, as soon as the hub answers again (opId makes a resend harmless). A
// model created offline has a temporary id ("pending-...") until the hub gives it its real one;
// then bakes that used the temporary id are rewritten, and resolve() maps the old id
// to the new one (the editor re-points its current model on the next change message). The last list the hub sent is cached (library/hub/models_cache.json), so the
// MODEL page shows real data even with the hub off.
#include <juce_gui_basics/juce_gui_basics.h>
#include "../../core/Settings.h"
#include <atomic>
#include <memory>
#include <mutex>
#include <vector>

namespace gnumbat::ui
{
    class ModelHub : public juce::ChangeBroadcaster, private juce::Timer
    {
    public:
        struct Model
        {
            juce::String id, name, parentId, parentId2, state;
            juce::StringArray creators;
            juce::int64 createdMs = 0, editedMs = 0;
            int up = 0, down = 0, myVote = 0, contributors = 1;
            juce::StringArray bakeIds;     // the hub's per-model bake list (panel bake brackets + plugin Bakes)
            bool pending = false;          // created here, not yet confirmed by the hub
        };

        /** One ModelHub per library per process, shared by every open plugin window (so two
            windows never race each other over the same queue file). */
        static std::shared_ptr<ModelHub> forLibrary (const juce::File& libraryRoot, const juce::String& hubUrl);

        ModelHub (const juce::File& libraryRoot, const juce::String& hubUrl);
        ~ModelHub() override;
        const juce::File& libraryRoot() const noexcept { return root; }
        const std::vector<Model>& models() const noexcept { return list; }
        const Model* find (const juce::String& id) const;

        bool connected() const noexcept { return isConnected; }
        bool everLoaded() const noexcept { return haveList; }      // a list (live or cached) exists
        int queued() const noexcept { return (int) pending.size(); }
        juce::String hubUrl() const;
        juce::String statusText() const;                           // "hub on" / "hub off (2 queued)"

        /** New seed (parentId empty) or branch. Returns the id to use right away (temporary
            until the hub confirms it). */
        juce::String createModel (const juce::String& name, const juce::String& parentId);
        void vote (const juce::String& id, int value);            // +1, -1, 0 = retract
        void addBake (const juce::String& modelId, const juce::String& bakeId, const juce::String& notation, double bars);
        juce::String resolve (const juce::String& id) const;       // a temporary id -> its real one, once known

        void setFastPolling (bool fast);                           // MODEL page showing: poll every 2 s, else 10 s
        void syncNow();

    private:
        juce::File root;
        juce::String url;
        std::vector<Model> list;
        juce::var cachedCards;             // the hub's last list (array of cards)
        juce::String etag;
        juce::Array<juce::var> pending;    // {opId, sel, args, tempId?}
        juce::NamedValueSet idMap;         // temp id -> real hash
        bool isConnected = false, haveList = false, fast = false;
        std::atomic<bool> syncing { false };
        std::shared_ptr<std::atomic<bool>> alive = std::make_shared<std::atomic<bool>> (true);

        juce::File hubDir() const { return root.getChildFile ("hub"); }
        void load();
        void savePending();
        void saveCache();
        void rebuild();
        void enqueue (const juce::String& sel, const juce::Array<juce::var>& args, const juce::String& tempId = {});
        void timerCallback() override;

        struct SyncResult
        {
            bool reached = false, listChanged = false;
            juce::var cards;
            juce::String etag;
            juce::StringArray doneOps;                         // opIds the hub applied (or rejected for good)
            juce::StringArray errors;
            std::vector<std::pair<juce::String, juce::String>> remaps;   // temp -> real
        };
        void applySync (SyncResult);
        void remapLibrary (const juce::String& from, const juce::String& to);
    };
}
