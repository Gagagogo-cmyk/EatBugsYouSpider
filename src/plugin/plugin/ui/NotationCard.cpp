#include "NotationCard.h"
#include "../../core/NotationProfile.h"
#include "../../core/JsonIo.h"

namespace gnumbat::ui
{
    NotationCard::NotationCard (const juce::String& h, const juce::String& d, const juce::String& initial,
                                const juce::Array<juce::var>& profiles, const juce::String& initialProfileId,
                                const juce::StringArray& decomposers, bool offerDecompose, const juce::String& warn, const juce::String& autoLabel)
        : heading (h), detail (d), warning (warn), profileList (profiles), offer (offerDecompose)
    {
        setWantsKeyboardFocus (true);
        juce::ignoreUnused (initialProfileId);
        notation.setMultiLine (true, true);
        notation.setReturnKeyStartsNewLine (false);
        notation.setFont (mono());
        notation.setTextToShowWhenEmpty ("e.g. weird nosy rise #inharmonic #ascent", col::dim);
        notation.setText (initial, false);
        notation.setSelectAllWhenFocused (true);
        notation.addListener (this);
        notation.onReturnKey = [this] { finish (true); };
        notation.onEscapeKey = [this] { finish (false); };
        addAndMakeVisible (notation);

        decompBox.addItem (autoLabel, 1);
        int id = 2;
        for (auto& d2 : decomposers) decompBox.addItem (d2, id++);
        decompBox.setSelectedId (1, juce::dontSendNotification);
        decompose.setToggleState (true, juce::dontSendNotification);
        if (offerDecompose) { addAndMakeVisible (decompose); addAndMakeVisible (decompBox); }

        okButton.onClick = [this] { finish (true); };
        cancelButton.onClick = [this] { finish (false); };
        addAndMakeVisible (okButton);
        addAndMakeVisible (cancelButton);
        updatePreview();
    }

    static bool tagBreak (juce::juce_wchar c) { return juce::CharacterFunctions::isWhitespace (c) || c == '#' || c == ',' || c == ';'; }

    juce::StringArray NotationCard::parseTags (const juce::String& text)
    {
        juce::StringArray out;
        const int n = text.length();
        for (int i = 0; i < n; ++i)
        {
            if (text[i] != '#') continue;
            int j = i + 1;
            while (j < n && ! tagBreak (text[j])) ++j;
            auto t = text.substring (i + 1, j).trimCharactersAtEnd (".!?:)");
            if (t.isNotEmpty() && ! out.contains (t, true)) out.add (t);
            i = j - 1;
        }
        return out;
    }

    juce::String NotationCard::withoutTags (const juce::String& text)
    {
        juce::String out;
        const int n = text.length();
        for (int i = 0; i < n; ++i)
        {
            if (text[i] == '#')
            {
                int j = i + 1;
                while (j < n && ! tagBreak (text[j])) ++j;
                i = j - 1;
                continue;
            }
            out << juce::String::charToString (text[i]);
        }
        // tidy what the removed #words leave behind: doubled spaces, stray separators
        out = out.replace ("\n", " ");
        while (out.contains ("  ")) out = out.replace ("  ", " ");
        return out.trim().trimCharactersAtEnd (",; ").trimCharactersAtStart (",; ");
    }

    juce::var NotationCard::plainProfile()
    {
        juce::var v;
        juce::JSON::parse (R"({"schema":"gnumbat.notation_profile/0.1","profile_id":"np_plain","name":"plain","version":1,
            "description":"Notation is stored exactly as written; no tags or fields are derived from it (tags are entered separately).",
            "split":null,"rules":[],"fallback":{"kind":"ignore"}})", v);
        return v;
    }

    juce::var NotationCard::currentProfile() const { return plainProfile(); }

    void NotationCard::updatePreview()
    {
        previewTags = parseTags (notation.getText());
        repaint (previewArea);
    }

    void NotationCard::finish (bool ok)
    {
        Result r;
        r.accepted = ok;
        r.rawNotation = notation.getText();              // verbatim: no trim, no normalisation
        r.profile = plainProfile();                      // the notation itself never becomes a tag
        r.extraTags = parseTags (notation.getText());   // every #word
        r.decompose = ! offer || decompose.getToggleState();
        r.decomposer = decompBox.getSelectedId() <= 1 ? juce::String() : decompBox.getText();
        if (onDone) onDone (r);
    }

    bool NotationCard::keyPressed (const juce::KeyPress& k)
    {
        if (k == juce::KeyPress::escapeKey) { finish (false); return true; }
        return true;
    }

    void NotationCard::paint (juce::Graphics& g)
    {
        g.fillAll (juce::Colours::black.withAlpha (0.62f));
        g.setColour (col::panel);   g.fillRect (card);
        // floating overlay, no fixed neighbour -- keeps the single hairline all around
        g.setColour (col::line);    g.drawRect (card, 1);
        auto r = card.reduced (20, 0);
        g.setColour (col::white);  g.setFont (mono());
        g.drawText ("> " + heading.toUpperCase(), r.getX(), card.getY() + 12, r.getWidth(), 22, juce::Justification::centredLeft);
        g.setColour (col::dim);    g.setFont (mono());
        g.drawText (detail, r.getX(), card.getY() + 34, r.getWidth(), 16, juce::Justification::centredLeft, true);
        int y = card.getY() + 54;
        if (warning.isNotEmpty())
        {
            g.setColour (col::white); g.setFont (mono());
            drawWrapped (g, warning, { r.getX(), y, r.getWidth(), 34 }, juce::Justification::topLeft, 2);
        }
        g.setColour (col::dim);  g.setFont (mono());
        g.drawText ("NOTATION  (stored exactly as typed -- #words become tags)", r.getX(), notation.getY() - 16, r.getWidth(), 14, juce::Justification::centredLeft);
        // no fill -- just a surrounding rectangle, so the writing zone reads as its own field
        // without breaking the "background is pure black everywhere" rule.
        g.setColour (col::line);
        g.drawRect (notation.getBounds().expanded (4), 1);
        g.setColour (col::dim);
        g.drawText ("TAGS", r.getX(), previewArea.getY() - 2, r.getWidth(), 14, juce::Justification::centredLeft);

        // Live preview: each tag as the same boxed chip the Library draws.
        auto pa = previewArea.withTrimmedTop (14).reduced (0, 2);
        g.setFont (mono());
        if (previewTags.isEmpty())
        {
            g.setColour (col::dim);
            g.drawText ("(no tags)", pa.removeFromTop (18), juce::Justification::centredLeft);
        }
        else
        {
            int x = pa.getX(), y = pa.getY();
            for (auto& t : previewTags)
            {
                const auto label = t.toUpperCase();
                const int cw = juce::GlyphArrangement::getStringWidthInt (mono(), label) + 8;
                if (x + cw > pa.getRight() && x > pa.getX()) { x = pa.getX(); y += 20; }
                if (y + 16 > pa.getBottom()) break;
                const juce::Rectangle<int> chip (x, y, cw, 16);
                g.setColour (col::dim);  g.drawRect (chip, 1);
                g.setColour (col::text); g.drawText (label, chip, juce::Justification::centred, true);
                x += cw + 4;
            }
        }
    }

    void NotationCard::resized()
    {
        const int h = 64 + (warning.isNotEmpty() ? 38 : 0) + 18 + 60 + 12 + 58 + 8 + (offer ? 34 : 0) + 20 + 44;
        const int w = juce::jmin (600, juce::jmax (320, getWidth() - 40));
        card = juce::Rectangle<int> (w, h).withCentre (getLocalBounds().getCentre());
        auto r = card.reduced (20, 0);
        int y = card.getY() + 54 + (warning.isNotEmpty() ? 38 : 0) + 18;
        notation.setBounds (r.getX(), y, r.getWidth(), 60);           y += 60 + 12;
        previewArea = { r.getX(), y, r.getWidth(), 58 };              y += 58 + 8;
        if (offer)
        {
            decompose.setBounds (r.getX(), y, r.getWidth() - 150, 24);
            decompBox.setBounds (r.getRight() - 140, y, 140, 24);
            y += 34;
        }
        okButton.setBounds (r.getRight() - 96, card.getBottom() - 44, 96, 30);
        cancelButton.setBounds (r.getRight() - 96 - 8 - 96, card.getBottom() - 44, 96, 30);
    }
}
