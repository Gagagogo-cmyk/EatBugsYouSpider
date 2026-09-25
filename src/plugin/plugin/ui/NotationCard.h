#pragma once
// "Notate this Bake" dialog: ONE field, written like "weird nosy rise #inharmonic #ascent".
// The whole text is stored EXACTLY as typed (the notation); every #word in it becomes a tag (any
// words at all -- Denis Smalley's spectromorphology terms are the suggested vocabulary, nothing is
// enforced). Tags travel in Result::extraTags; the notation's profile derives nothing else.
#include <juce_gui_basics/juce_gui_basics.h>
#include "Theme.h"

namespace gnumbat::ui
{
    class NotationCard : public juce::Component, private juce::TextEditor::Listener
    {
    public:
        struct Result
        {
            bool accepted = false;
            juce::String rawNotation;
            juce::var profile;                       // void => freeform
            juce::StringArray extraTags;
            bool decompose = true;
            juce::String decomposer;                 // "" => use the setting
        };

        NotationCard (const juce::String& heading, const juce::String& detailLine, const juce::String& initialNotation,
                      const juce::Array<juce::var>& profiles, const juce::String& initialProfileId,
                      const juce::StringArray& decomposers, bool offerDecompose,
                      const juce::String& warning = {}, const juce::String& autoLabel = "auto");

        std::function<void (Result)> onDone;
        void focusFirst() { if (isShowing()) notation.grabKeyboardFocus(); }
        /** Notation stored verbatim, nothing derived from it (tags come only from the TAGS field). */
        static juce::var plainProfile();
        /** "weird rise #inharmonic #ascent, #Ascent" -> {inharmonic, ascent}: every #word (up to the
            next space, #, comma or semicolon), in order, case-insensitive duplicates dropped. */
        static juce::StringArray parseTags (const juce::String& text);
        /** The same text with its #words removed and spaces tidied -- what the NOTATION column shows. */
        static juce::String withoutTags (const juce::String& text);

        void paint (juce::Graphics&) override;
        void resized() override;
        bool keyPressed (const juce::KeyPress&) override;
        void mouseDown (const juce::MouseEvent&) override {}

    private:
        juce::String heading, detail, warning;
        juce::TextEditor notation, extra;
        juce::ComboBox profileBox, decompBox;
        juce::ToggleButton decompose { "separate stems (drums / bass / body / vocals)" };
        juce::TextButton okButton { "BAKE" }, cancelButton { "CANCEL" };
        juce::Array<juce::var> profileList;
        juce::StringArray previewTags;
        juce::String previewFields, previewError;
        juce::Rectangle<int> card, previewArea;
        bool offer;

        void textEditorTextChanged (juce::TextEditor&) override { updatePreview(); }
        void updatePreview();
        void finish (bool ok);
        juce::var currentProfile() const;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (NotationCard)
    };
}
