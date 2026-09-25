#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <functional>

namespace gnumbat::ui
{
    struct PromptField
    {
        juce::String label, initial, hint;
        bool multiline = false;
    };

    /** What child components need from the editor: in-window dialogs (never OS windows — many hosts mishandle
        secondary native windows opened from a plugin) and a status line. */
    class UiHost
    {
    public:
        virtual ~UiHost() = default;
        virtual void prompt (const juce::String& title, const juce::String& message, const juce::Array<PromptField>& fields,
                             const juce::String& okText, std::function<void (juce::StringArray)> onOk) = 0;
        virtual void confirm (const juce::String& title, const juce::String& message, const juce::String& okText,
                              std::function<void()> onYes, bool danger = false) = 0;
        virtual void notify (const juce::String& message, bool isError = false) = 0;
    };

    /** A centred card over a dimmed backdrop, filling its parent. Owns its buttons/fields. */
    class DialogCard : public juce::Component
    {
    public:
        using Result = std::function<void (int button, const juce::StringArray& values, const juce::Array<bool>& checks)>;

        DialogCard (const juce::String& title, const juce::String& message);
        ~DialogCard() override = default;

        void addField (const PromptField&);
        void addCheckbox (const juce::String& text, bool initial);
        void addButton (const juce::String& text, bool primary = false, bool danger = false);
        void setCardWidth (int w) { desiredCardWidth = cardWidth = w; }
        Result onResult;                                   // button index; cancel/Esc reports -1
        void focusFirst();

        void paint (juce::Graphics&) override;
        void resized() override;
        bool keyPressed (const juce::KeyPress&) override;
        void mouseDown (const juce::MouseEvent&) override {}      // modal: swallow clicks on the backdrop
        int heightNeeded() const;

    private:
        struct Row { juce::Label label; juce::TextEditor editor; bool multiline = false; };
        juce::String title, message;
        std::vector<std::unique_ptr<Row>> rows;
        std::vector<std::unique_ptr<juce::ToggleButton>> checks;
        std::vector<std::unique_ptr<juce::TextButton>> buttons;
        int cardWidth = 460, desiredCardWidth = 460;   // cardWidth is desiredCardWidth reclamped to the parent's current width each resized()
        juce::Rectangle<int> card;
        void finish (int button);
        int messageHeight() const;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DialogCard)
    };
}
