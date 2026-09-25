#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include "AppModel.h"
#include "UiHost.h"

namespace gnumbat::ui
{
    /** Details + editing for the selected Bake (or bulk actions for several). Immediate-mode drawing with hit zones,
        so it stays one small file and reflows cleanly at any width. */
    class InspectorView : public juce::Component, public juce::SettableTooltipClient, private juce::ChangeListener
    {
    public:
        InspectorView (AppModel&, UiHost&);
        ~InspectorView() override;
        void paint (juce::Graphics&) override;
        void resized() override;
        void mouseUp (const juce::MouseEvent&) override;
        void mouseMove (const juce::MouseEvent&) override;
        void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

    private:
        struct Zone { juce::Rectangle<int> r; std::function<void()> act; juce::String tip; };
        AppModel& model;
        UiHost& host;
        juce::String shownId;
        juce::var bake, sem, state, view;
        std::vector<Zone> zones;
        juce::TextEditor notes;
        int scrollY = 0, contentHeight = 0;
        juce::Rectangle<int> notesRect;                        // content coordinates; moved by scrollY when placed
        void placeNotes();
        juce::String notesLoadedFor;
        int notesRev = -1;

        void changeListenerCallback (juce::ChangeBroadcaster*) override;
        void reload();
        int draw (juce::Graphics*, int width);                 // returns content height; fills `zones` when g == nullptr
        void saveNotes();
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (InspectorView)
    };
}
