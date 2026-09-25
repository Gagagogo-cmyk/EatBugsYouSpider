#include "FilterBar.h"
#include "../../core/JsonIo.h"

namespace gnumbat::ui
{
    using juce::String;
    using juce::var;

    FilterBar::FilterBar (AppModel& m, UiHost& h) : model (m), host (h)
    {
        search.setFont (mono());
        // No more instance-level colour overrides here -- this used to be the one deliberate
        // white field in the whole UI; now it's just black background / grey text like every
        // other TextEditor, so it simply inherits TerminalLookAndFeel's own defaults instead of
        // fighting them.
        search.setTextToShowWhenEmpty ("/ search notation, tags, id, groups, fields ...", col::dim);
        search.setText (m.search(), false);
        search.addListener (this);
        search.addKeyListener (this);   // up/down cycles through existing tags once the text starts with "[" -- see keyPressed()
        search.onEscapeKey = [this] { search.clear(); model.setSearch ({}); };
        addAndMakeVisible (search);
        clearButton.setTooltip ("Clear search & filters");
        clearButton.onClick = [this] { search.clear(); model.setSearch ({}); model.setChips ({}); };
        addAndMakeVisible (clearButton);
        model.addChangeListener (this);
    }

    FilterBar::~FilterBar() { model.removeChangeListener (this); }

    juce::StringArray FilterBar::allTags() const
    {
        juce::StringArray out;
        // Spectral/morphology tags cycle through "[" the same way ordinary ones do (see
        // keyPressed() below) -- that's how a vocabulary someone's already been typing (Smalley's
        // or their own) surfaces again for reuse, without this app ever hard-coding a word list.
        for (auto& r : model.rows())
            for (auto* key : { "tags", "spectral_tags", "morphology_tags" })
                for (auto& t : json::getStrings (r.view, key))
                    out.addIfNotAlreadyThere (t);
        out.sort (true);   // case-insensitive, alphabetical -- a stable order to cycle through
        return out;
    }

    bool FilterBar::keyPressed (const juce::KeyPress& k, juce::Component* originator)
    {
        // Only takes over when the search field itself is what's being typed into, and only for
        // the two keys this is actually about -- every other key (including "[" itself) is left
        // completely alone and falls through to the field's own normal handling.
        if (originator != &search) return false;
        if (k != juce::KeyPress::upKey && k != juce::KeyPress::downKey) return false;

        const auto text = search.getText();
        if (! text.startsWithChar ('['))
        {
            tagCycle.clear();
            return false;   // not mid-tag -- let the arrow key do whatever it'd normally do here
        }

        // Rebuild the candidate list only when the bracket's own contents changed since the last
        // step WE took (comparing against lastCycledText, not just "did the text change", since
        // our own setText() below also changes it) -- that's what lets repeated presses walk
        // forward through the same list instead of narrowing it every time.
        if (text != lastCycledText)
        {
            const auto prefix = text.substring (1).upToFirstOccurrenceOf ("]", false, false).trim();
            tagCycle.clear();
            for (auto& t : allTags())
                if (prefix.isEmpty() || t.startsWithIgnoreCase (prefix)) tagCycle.add (t);
            tagCycleIndex = -1;
        }
        if (tagCycle.isEmpty()) return false;

        tagCycleIndex = k == juce::KeyPress::upKey ? (tagCycleIndex + 1 + tagCycle.size()) % tagCycle.size()
                                                    : (tagCycleIndex - 1 + tagCycle.size()) % tagCycle.size();
        lastCycledText = "[" + tagCycle[tagCycleIndex].toUpperCase() + "]";
        search.setText (lastCycledText, juce::dontSendNotification);
        search.moveCaretToEnd();
        model.setSearch (lastCycledText);
        return true;
    }

    void FilterBar::resizedIfChipsChanged()
    {
        if (lastChipCount != model.chips().size()) { lastChipCount = model.chips().size(); resized(); if (auto* p = getParentComponent()) p->resized(); }
    }

    static String chipText (const var& c)
    {
        auto t = filter::describe (c);
        return t.length() > 46 ? t.substring (0, 45) + "..." : t;
    }

    int FilterBar::heightForWidth (int w) const
    {
        int x = 0, rows = 1;
        for (auto& c : model.chips())
        {
            const int cw = juce::GlyphArrangement::getStringWidthInt (mono(), chipText (c)) + 30;
            if (x + cw > w) { ++rows; x = 0; }
            x += cw + 6;
        }
        return 22 + (model.chips().isEmpty() ? 0 : rows * 18 + 2);   // tightened, matches resized() below
    }

    void FilterBar::resized()
    {
        auto r = getLocalBounds();
        auto top = r.removeFromTop (20).withTrimmedLeft (4).withTrimmedRight (4);   // tightened
                                                                // from 24; still starts at the same
                                                                // x as the [BANK] tab above it, and
                                                                // ends with a matching margin instead
                                                                // of X sitting flush against the
                                                                // window edge
        clearButton.setBounds (top.removeFromRight (20));
        top.removeFromRight (4);
        search.setBounds (top);   // the count text that used to sit here is gone -- search now
                                  // reaches all the way right, flush against the small X button
        chipRects.clear();
        int x = 0, y = 22;
        for (int i = 0; i < model.chips().size(); ++i)
        {
            const int cw = juce::GlyphArrangement::getStringWidthInt (mono(), chipText (model.chips()[i])) + 30;
            if (x + cw > getWidth()) { x = 0; y += 18; }
            chipRects.push_back ({ { x, y, cw, 16 }, i });
            x += cw + 6;
        }
    }

    void FilterBar::paint (juce::Graphics& g)
    {
        // no fill -- just a surrounding rectangle, same "field reads as its own zone without
        // breaking the pure-black background" rule as the notation box and the import square.
        g.setColour (col::line);
        g.drawRect (search.getBounds(), 1);   // right on the field's own bounds -- FilterBar's own row starts at y=0, so an outward expand here would clip against its own paint() region
        for (auto& [rect, idx] : chipRects)
        {
            // text only, no fill -- the "x" at the right edge is what marks it removable now.
            g.setColour (col::text);     g.setFont (mono());
            g.drawText (chipText (model.chips()[idx]), rect.withTrimmedLeft (8).withTrimmedRight (22), juce::Justification::centredLeft, true);
            g.setColour (col::dim);
            g.drawText ("x", rect.removeFromRight (20), juce::Justification::centred);
        }
    }

    void FilterBar::mouseUp (const juce::MouseEvent& e)
    {
        for (auto& [rect, idx] : chipRects)
            if (rect.contains (e.getPosition()))
            {
                auto chips = model.chips();
                chips.remove (idx);
                model.setChips (chips);
                return;
            }
    }
}
