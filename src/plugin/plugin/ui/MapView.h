#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <map>
#include <set>
#include "AppModel.h"
#include "UiHost.h"

namespace gnumbat::ui
{
    /** Bake Map: a 2-D projection of the library in a user-selectable feature space (computed by the worker; t-SNE
        today, UMAP later via the same file contract). Zoom (wheel), pan (plain drag -- also right/middle/Alt-drag,
        kept for muscle memory), hover, click, Shift-drag to rubber-band select, colour by any field, dimmed when
        filtered out. Always labelled as a projection. */
    class MapView : public juce::Component, public juce::SettableTooltipClient, private juce::ChangeListener
    {
    public:
        MapView (AppModel&, UiHost&);
        ~MapView() override;
        void paint (juce::Graphics&) override;
        void resized() override;
        void mouseMove (const juce::MouseEvent&) override;
        void mouseExit (const juce::MouseEvent&) override;
        void mouseDown (const juce::MouseEvent&) override;
        void mouseDrag (const juce::MouseEvent&) override;
        void mouseUp (const juce::MouseEvent&) override;
        void mouseDoubleClick (const juce::MouseEvent&) override;
        void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
        bool keyPressed (const juce::KeyPress&) override;

        // for tests / persistence
        juce::String colourMode() const { return colourBox.getText(); }
        void setColourModeByText (const juce::String&);
        void fitView();
        juce::Point<float> worldToScreen (juce::Point<float>) const;
        juce::Point<float> screenToWorld (juce::Point<float>) const;
        juce::String pointAt (juce::Point<float> screen, float radius = 9.0f) const;

    private:
        AppModel& model;
        UiHost& host;
        juce::ComboBox spaceBox, methodBox, colourBox;
        juce::TextButton computeButton { "COMPUTE" }, fitButton { "FIT" };
        juce::Rectangle<int> plot;
        juce::Point<float> centre { 0.f, 0.f };
        float zoom = 1.0f;
        bool panning = false, banding = false, downWasRight = false;
        juce::Point<float> dragStartScreen;
        juce::Point<float> panStartCentre;
        juce::Rectangle<float> band;
        juce::StringArray bandBase;
        std::map<juce::String, juce::Point<float>> pos;          // bake id -> world
        std::set<juce::String> visibleSet;
        juce::String lastMapId;
        int lastRows = -1;
        struct ColourSpec { enum Kind { state, group, dataset, model, firstTag, origin, field } kind = state; juce::String path; bool numeric = false; };
        std::vector<ColourSpec> colourSpecs;
        juce::StringArray categories;                            // stable category -> colour assignment
        double numMin = 0, numMax = 1;

        void changeListenerCallback (juce::ChangeBroadcaster*) override;
        void rebuildControls();
        void rebuildPositions();
        float baseScale() const;
        juce::Colour colourFor (const juce::var& view) const;
        juce::String categoryFor (const juce::var& view) const;
        bool numberFor (const juce::var& view, double& out) const;
        void refreshColourRange();
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MapView)
    };
}
