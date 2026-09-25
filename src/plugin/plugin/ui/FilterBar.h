#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include "AppModel.h"
#include "UiHost.h"
#include "Theme.h"

namespace gnumbat::ui
{
    /** Free-text search + removable filter chips (chips can still be restored from previously
        saved UI state and cleared via a small X button; there is no control to add a new one
        any more). */
    class FilterBar : public juce::Component, private juce::ChangeListener, private juce::TextEditor::Listener, private juce::KeyListener
    {
    public:
        FilterBar (AppModel&, UiHost&);
        ~FilterBar() override;
        void paint (juce::Graphics&) override;
        void resized() override;
        /** x-centre of the search bar's clear "X", in this bar's coordinates -- the Library's
            per-row delete X lines up under it (BankView::paintCell). */
        int clearCentreX() const { return clearButton.getBounds().getCentreX(); }
        void mouseUp (const juce::MouseEvent&) override;
        int heightForWidth (int w) const;
        void focusSearch() { search.grabKeyboardFocus(); }

    private:
        AppModel& model;
        UiHost& host;
        juce::TextEditor search;
        juce::TextButton clearButton { "X" };
        std::vector<std::pair<juce::Rectangle<int>, int>> chipRects;   // rect -> chip index
        // Tag cycling: typing "[" (optionally followed by a prefix) into search, then pressing
        // up/down, walks through every existing tag instead of making you remember and type the
        // exact name -- see keyPressed(). tagCycle is the current candidate list, tagCycleIndex
        // where in it the last arrow press landed, and lastCycledText is what WE last wrote into
        // the field ourselves, so a second arrow press can tell "the user changed the bracket's
        // contents, start over" apart from "this is just our own last step, keep cycling".
        juce::StringArray tagCycle;
        int tagCycleIndex = -1;
        juce::String lastCycledText;

        void changeListenerCallback (juce::ChangeBroadcaster*) override { repaint(); resizedIfChipsChanged(); }
        void textEditorTextChanged (juce::TextEditor&) override { model.setSearch (search.getText()); }
        bool keyPressed (const juce::KeyPress&, juce::Component*) override;
        juce::StringArray allTags() const;
        void resizedIfChipsChanged();
        int lastChipCount = -1;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (FilterBar)
    };
}
