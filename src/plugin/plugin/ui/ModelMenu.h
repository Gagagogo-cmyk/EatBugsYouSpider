#pragma once
// The MODEL page: a full page of the plugin (not a popup), opened by clicking the word "model" in
// the credit line (see CapturePanel). A compact table of the library's Models (core/ModelTree.h),
// drawn as a lineage tree:
//
//   MODEL                              CREATED           EDITED            STATE    CONTRIB  VOTES
//   idm by alex  CURRENT               2026-09-23 00:01  2026-09-23 00:01  3 bakes  1        ↑0 ↓0
//   └── noipm by alex                  ...
//
// Columns drop away right-to-left in priority order as the window narrows (MODEL, STATE and VOTES
// always stay). Click or the arrow keys select a model (white bar); Enter makes it the session's
// current Model and enters the next page (the capture + LIBRARY page). Right-click a model to branch from it; right-click anywhere (or
// press N) for "New seed...", a fresh lineage. Naming a new model happens inline on this page (no second dialog).
#include <juce_gui_basics/juce_gui_basics.h>
#include "Theme.h"
#include "UiHost.h"
#include "AppModel.h"
#include "ModelHub.h"
#include <vector>

namespace gnumbat::ui
{
    class ModelMenu : public juce::Component
    {
    public:
        ModelMenu (AppModel& model, UiHost& host);

        /** Re-read models/ (and the Bakes linked to each) and show `currentModelId` as current. */
        void refresh (const juce::File& libraryRoot, const juce::String& currentModelId);
        /** The shared model list (EBYS hub registry, the same one panel.html shows). */
        void setHub (std::shared_ptr<ModelHub> h) { hub = std::move (h); }

        std::function<void (juce::String)> onSelect;   // a model was clicked / Entered: make it current and enter the next page
        std::function<void()> onBack;                  // Escape: back to the page we came from (only if a model is current)
        void focusFirst() { if (isShowing()) grabKeyboardFocus(); }

        void paint (juce::Graphics&) override;
        void resized() override;
        bool keyPressed (const juce::KeyPress&) override;
        void mouseMove (const juce::MouseEvent&) override;
        void mouseExit (const juce::MouseEvent&) override;
        void mouseUp (const juce::MouseEvent&) override;
        void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

    private:
        struct Row
        {
            juce::String id, name, creator, treePrefix, state;
            juce::int64 created = 0, edited = 0;
            int bakes = 0, contributors = 1, up = 0, down = 0, myVote = 0;
            bool pending = false;
        };
        enum class ColKind { created, edited, state, contrib, votes };
        // centreAlign: STATE/CONTRIB/VOTES are centred (header word and cell value share a centre,
        // not a right edge -- a short value like "1" or "0 bakes" flush against the same right
        // edge as a longer header word looked unaligned with it, even though the edges matched).
        // CREATED/EDITED stay left-aligned.
        struct Col { ColKind kind; juce::String label; int x = 0, w = 0; bool centreAlign = false; };

        AppModel& model;
        UiHost& host;
        std::shared_ptr<ModelHub> hub;
        juce::File root;
        juce::String currentId, cursorId, namingParent;
        bool naming = false;
        int scrollRows = 0, hoverRow = -1;
        static constexpr int rowH = 18;

        std::vector<Row> rows;
        std::vector<Col> cols;
        int modelColW = 0;
        juce::Rectangle<int> headerRect, listArea, bottomRect, hubRect;

        juce::TextEditor nameEntry;
        juce::TextButton createButton { "CREATE" }, cancelNameButton { "CANCEL" };

        void layoutColumns();
        void beginNaming (const juce::String& parentId);   // parentId empty => SEED (new root); otherwise BRANCH
        void cancelNaming();
        void confirmCreate();
        void enter (const juce::String& id);
        void vote (const juce::String& id, bool up);
        void moveCursor (int delta);
        void updateVisibility();
        int rowAt (juce::Point<int>) const;               // -1 if not over a row
        const Col* colAt (int x) const;
        // The x boundary between a row's own "up"/"down" vote glyphs in the VOTES column -- shared
        // by paint() (to place the two glyphs) and mouseUp() (to tell which one was clicked), so
        // the two can never drift apart the way a separately-guessed static midpoint did before.
        int voteSplitX (const Row&, const Col&) const;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ModelMenu)
    };
}
