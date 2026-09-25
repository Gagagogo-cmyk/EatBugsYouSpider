#include "UiHost.h"
#include "Theme.h"

namespace gnumbat::ui
{
    DialogCard::DialogCard (const juce::String& t, const juce::String& m) : title (t), message (m)
    {
        setWantsKeyboardFocus (true);
        setInterceptsMouseClicks (true, true);
    }

    void DialogCard::addField (const PromptField& f)
    {
        auto r = std::make_unique<Row>();
        r->multiline = f.multiline;
        r->label.setText (f.label, juce::dontSendNotification);
        r->label.setFont (mono());
        r->label.setColour (juce::Label::textColourId, col::dim);
        r->editor.setMultiLine (f.multiline, true);
        r->editor.setReturnKeyStartsNewLine (f.multiline);
        r->editor.setFont (mono());
        r->editor.setText (f.initial, false);
        r->editor.setTextToShowWhenEmpty (f.hint, col::dim);
        r->editor.setSelectAllWhenFocused (true);
        r->editor.onReturnKey = [this] { if (! rows.empty() && ! rows.back()->multiline) for (size_t i = 0; i < buttons.size(); ++i) if (buttons[i]->getName() == "primary") { finish ((int) i); return; } };
        r->editor.onEscapeKey = [this] { finish (-1); };
        addAndMakeVisible (r->label);
        addAndMakeVisible (r->editor);
        rows.push_back (std::move (r));
    }

    void DialogCard::addCheckbox (const juce::String& text, bool initial)
    {
        auto c = std::make_unique<juce::ToggleButton> (text);
        c->setToggleState (initial, juce::dontSendNotification);
        addAndMakeVisible (*c);
        checks.push_back (std::move (c));
    }

    void DialogCard::addButton (const juce::String& text, bool primary, bool danger)
    {
        auto b = std::make_unique<juce::TextButton> (text);
        b->setName (primary ? "primary" : "secondary");
        // no permanent tint for an ordinary primary action -- flat text like every other button.
        // Danger is the one real exception: the reserved accent, same as every DELETE elsewhere.
        if (primary && danger) b->setColour (juce::TextButton::textColourOffId, col::white);
        const int idx = (int) buttons.size();
        b->onClick = [this, idx] { finish (idx); };
        addAndMakeVisible (*b);
        buttons.push_back (std::move (b));
    }

    int DialogCard::messageHeight() const
    {
        if (message.isEmpty()) return 0;
        juce::AttributedString as;
        as.append (message, mono(), col::text);
        juce::TextLayout tl;
        tl.createLayout (as, (float) cardWidth - 40.0f);
        return (int) std::ceil (tl.getHeight()) + 8;
    }

    int DialogCard::heightNeeded() const
    {
        int h = 46 + messageHeight() + 12;
        for (auto& r : rows) h += (r->multiline ? 96 : 26) + 18 + 8;
        h += (int) checks.size() * 26;
        return h + 54;
    }

    void DialogCard::finish (int button)
    {
        juce::StringArray values;
        juce::Array<bool> ticks;
        for (auto& r : rows) values.add (r->editor.getText());
        for (auto& c : checks) ticks.add (c->getToggleState());
        auto cb = onResult;                                  // the owner deletes us inside the callback
        if (cb) cb (button, values, ticks);
    }

    void DialogCard::focusFirst()
    {
        if (! isShowing()) return;                        // e.g. the editor is not on screen yet
        if (! rows.empty()) rows.front()->editor.grabKeyboardFocus(); else grabKeyboardFocus();
    }

    bool DialogCard::keyPressed (const juce::KeyPress& k)
    {
        if (k == juce::KeyPress::escapeKey) { finish (-1); return true; }
        if (k == juce::KeyPress::returnKey)
        {
            for (size_t i = 0; i < buttons.size(); ++i) if (buttons[i]->getName() == "primary") { finish ((int) i); return true; }
        }
        return true;                                          // modal: nothing behind us sees keys
    }

    void DialogCard::paint (juce::Graphics& g)
    {
        g.fillAll (juce::Colours::black.withAlpha (0.62f));
        g.setColour (col::panel);
        g.fillRect (card);
        // floating overlay, no fixed neighbour -- keeps the single hairline all around
        g.setColour (col::line);
        g.drawRect (card, 1);
        g.setColour (col::white);
        g.setFont (mono());
        g.drawText ("> " + title.toUpperCase(), card.getX() + 20, card.getY() + 12, card.getWidth() - 40, 22, juce::Justification::centredLeft);
        if (message.isNotEmpty())
        {
            juce::AttributedString as;
            as.append (message, mono(), col::text);
            as.setWordWrap (juce::AttributedString::byWord);
            as.draw (g, juce::Rectangle<float> ((float) card.getX() + 20.0f, (float) card.getY() + 42.0f, (float) card.getWidth() - 40.0f, (float) messageHeight()));
        }
    }

    void DialogCard::resized()
    {
        // the card itself shrinks with a small plugin window rather than clipping against it, and
        // grows back up to its original desired width if the window is enlarged again. heightNeeded()/
        // messageHeight() both read `cardWidth`, so wrapping stays consistent with what's drawn.
        cardWidth = juce::jmin (desiredCardWidth, juce::jmax (240, getWidth() - 40));
        const int h = heightNeeded();
        card = juce::Rectangle<int> (cardWidth, h).withCentre (getLocalBounds().getCentre());
        int y = card.getY() + 46 + messageHeight() + 8;
        for (auto& r : rows)
        {
            r->label.setBounds (card.getX() + 20, y, card.getWidth() - 40, 18);
            y += 18;
            const int eh = r->multiline ? 96 : 26;
            r->editor.setBounds (card.getX() + 20, y, card.getWidth() - 40, eh);
            y += eh + 8;
        }
        for (auto& c : checks) { c->setBounds (card.getX() + 20, y, card.getWidth() - 40, 24); y += 26; }
        int bx = card.getRight() - 20;
        for (int i = (int) buttons.size() - 1; i >= 0; --i)
        {
            const int bw = juce::jmax (84, buttons[(size_t) i]->getButtonText().length() * 9 + 26);
            buttons[(size_t) i]->setBounds (bx - bw, card.getBottom() - 44, bw, 30);
            bx -= bw + 8;
        }
    }
}
