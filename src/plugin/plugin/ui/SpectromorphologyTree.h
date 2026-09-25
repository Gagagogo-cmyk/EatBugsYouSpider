#pragma once
// The Spectromorphology Lexicon: a zoomable/pannable diagram of the vocabulary
// (core/Spectromorphology.h) drawn as real boxes and connecting lines -- not a list -- in the
// same dark/monospace/no-box-unless-floating language as everything else (see Theme.h; a floating
// overlay is the one place a hairline is allowed). A normal third tab in GnumbatEditor, a peer of
// LIBRARY/MAP -- opened by either "[LEXICON]" itself or the "(?)" in CapturePanel's heard bar
// (GnumbatEditor::showSpectromorphologyLexicon() -> showLexiconInline()), NOT a floating dialog:
// it fills the same content rect Library/Map otherwise would. No on-screen "X" any more -- Escape
// is the only way to close it from here (picking LIBRARY/MAP again works too, but that's a normal
// tab switch, not "closing" anything -- see GnumbatEditor::showTab()). The capture panel above
// (title/host/loop/heard bar, BAKE) stays fully live throughout. The plugin window itself is
// never resized for this -- instead fitView() (see below) refuses to zoom out past the point the
// ROOT box's own label (SPECTROMORPHOLOGY, the single longest word in the tree) would start
// truncating: a tree too big to show whole AND fully legible at once shows however much of itself
// fits at that floor, centred, and leaves the rest to scroll/pan rather than shrinking every box's
// (fixed-size, see labelFont()/paint()) text past the point the root still fits inside its own box.
// A parent whose
// children are ALL leaves themselves (no grandchildren -- COMPOSITE's six, PRIMITIVE's four,
// SECTIONAL MOTION's three) piles them into a single vertical column instead of spreading them sideways,
// drawn as a directory-tree trunk with a tick out to each box (see buildLayout()/paint()) --
// otherwise those wide leaf rows alone would blow the whole tree far past the window's width. No
// credit is drawn here -- it lives in CapturePanel's own title row, this page included.
// Opens with the root box already selected, so the definition strip is showing something from the
// start; clicking another box (or empty space, which deselects) opens/closes that strip -- the
// tree above it never moves either way.
#include <juce_gui_basics/juce_gui_basics.h>
#include "Theme.h"
#include "../../core/Spectromorphology.h"
#include <map>
#include <vector>

namespace gnumbat::ui
{
    class SpectromorphologyTree : public juce::Component
    {
    public:
        SpectromorphologyTree();

        std::function<void()> onClose;   // Escape only now -- no on-screen "X" (see the top-of-file comment)

        void paint (juce::Graphics&) override;
        void resized() override;
        void mouseDown (const juce::MouseEvent&) override;
        void mouseDrag (const juce::MouseEvent&) override;
        void mouseUp (const juce::MouseEvent&) override;
        void mouseMove (const juce::MouseEvent&) override;
        void mouseExit (const juce::MouseEvent&) override;
        void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
        bool keyPressed (const juce::KeyPress&) override;
        void fitView();   // public: GnumbatEditor's own FIT button (tabsRect, next to "[LEXICON]") calls this directly now

    private:
        struct Box { juce::String id; juce::Rectangle<float> world; };
        std::vector<Box> boxes;
        std::map<juce::String, int> indexOf;              // term id -> boxes[] index
        juce::Rectangle<float> worldBounds;                // bounding box of every box, for FIT
        // parent id -> its stacked (all-leaf) children, in order -- see buildLayout(). Only a
        // parent whose whole child set qualified is present here; everyone else uses the normal
        // per-edge elbow in paint().
        std::map<juce::String, std::vector<juce::String>> stackChildrenOf;

        // No on-screen "X" any more -- Escape closes it (see onClose). No FIT button here either
        // any more -- it moved out to GnumbatEditor's own tabsRect, on the same line as
        // "[LEXICON]" (see PluginEditor.cpp), calling this class's own public fitView() directly;
        // that also frees up this component's whole top row for the tree/canvas.
        juce::Rectangle<int> canvas, detailRect;
        juce::Point<float> centre { 0.f, 0.f };            // world point drawn at the canvas centre
        float zoom = 1.0f;
        bool didInitialFit = false;   // resized() calls fitView() once, the first time it has real bounds
        bool panning = false;
        juce::Point<float> dragStartScreen, panStartCentre;
        juce::String hoverId, selectedId, rootId;   // rootId: also the default selection on open

        void buildLayout();
        juce::Point<float> worldToScreen (juce::Point<float>) const;
        juce::Rectangle<float> worldToScreen (juce::Rectangle<float>) const;
        juce::Point<float> screenToWorld (juce::Point<float>) const;
        juce::String hitTest (juce::Point<float> screenPos) const;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SpectromorphologyTree)
    };
}
