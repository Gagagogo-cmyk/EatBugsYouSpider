#pragma once
#include <juce_gui_basics/juce_gui_basics.h>

namespace gnumbat::ui
{
    /** Posterized -- flat levels and nothing between them: black, grey, white, green, plus one
        deliberate exception (red -- see below). No ramp, no dimmer/brighter steps, no second
        grey. Hierarchy comes from which of the three foreground levels a thing uses and from
        layout, never from a shade in between.
          - grey  = ordinary text and state: the default for everything that isn't emphasised.
          - white = emphasis: selected, "needs attention" -- including ERROR -- and section
                    headings.
          - green = the one reserved positive-signal accent: READY, a healthy input level, a
                    span of the loop that's actually been heard, a toggle that's on, PLAYING.
                    Never used for categorisation or decoration.
          - red   = the one deliberate exception to "no red any more": the transport LED reads
                    as a literal traffic light (red stopped / green playing), a convention
                    people already know cold from every DAW and tape machine, so it stays a
                    convention rather than joining the grey/white/green emphasis scale. Nothing
                    else uses it.
        Background is pure black everywhere. There is no separate panel surface, and outside a
        floating overlay there is no dividing line either: a zone is bounded by nothing but the
        layout around it, never a hairline or a tint of its own. A popup menu, tooltip or modal
        card is the one exception -- it sits on the same black as whatever is behind it and
        would otherwise be invisible, so it alone keeps a single grey hairline all the way
        round. A handful of controls (a text field's drag-selection, a popup row under the
        pointer, the scrollbar thumb) get a transient grey purely for that reason: without it
        the control cannot be used at all, which is different in kind from decorating a zone. */
    namespace col
    {
        const juce::Colour bg    { 0xff000000 };
        const juce::Colour grey  { 0xff8a908c };
        const juce::Colour white { 0xffffffff };
        const juce::Colour green { 0xff00ff50 };   // flash green -- bright/saturated, not the softer iOS-style green this used to be
        const juce::Colour red   { 0xffff1400 };   // flashier -- transport LED only, see the note above

        // No second surface: kept as a name so a call site that means "the background, explicitly"
        // still reads that way, not because it differs from `bg`.
        const juce::Colour panel = bg;
        // Only one non-emphasised foreground tone exists now. `text` and `dim` stay separate
        // names because "this is the label" vs "this is the value" is clearer for it in the
        // call sites that use them, not because the two colours differ any more.
        const juce::Colour text = grey;
        const juce::Colour dim  = grey;
        // The one hairline that survives anywhere: floating overlays only (see the note above).
        const juce::Colour line = grey;

        inline juce::Colour forState (const juce::String& s)
        {
            if (s == "READY") return green;
            if (s == "ERROR") return white;   // no red left: an error reads as maximum emphasis, the same language as everything else that needs attention
            return grey;
        }
    }

    // One type size, no bold, everywhere -- the plugin-wide equivalent of panel.html's
    // `.plugin,.plugin *{font-size:var(--fs)!important;font-weight:400!important}`.
    constexpr float kFontSize = 12.5f;
    inline juce::Font mono() { return juce::Font (juce::FontOptions (juce::Font::getDefaultMonospacedFontName(), kFontSize, juce::Font::plain)); }

    /** Word-wraps text across up to maxLines, always at mono()/kFontSize -- never JUCE's
        drawFittedText, which shrinks (and can horizontally squeeze) the font to force a fit.
        Paragraphs are split on literal newlines first, then each is wrapped independently;
        text beyond maxLines is dropped and the last line gets a "..." instead. Draws in
        whatever colour is already set on `g`, exactly like drawFittedText did. */
    void drawWrapped (juce::Graphics& g, const juce::String& text, juce::Rectangle<int> area,
                       juce::Justification j = juce::Justification::topLeft, int maxLines = 2);

    /** The one place JUCE's own anti-aliasing still sneaks a blended, unposterized pixel into
        this UI: glyph edges, the transport LED's circle, dashed diagonals -- every drawing call
        elsewhere in this theme avoids it (integer-aligned rects, flat fills, no drawFittedText),
        but text and curves have no "hard-edged" drawing mode in JUCE's own Graphics API. This
        is a Component::setComponentEffect() filter, not a drawing-call change: it runs on the
        already-composited bitmap of whatever it's attached to (that component and every child
        painted inside it), after JUCE has rendered and anti-aliased everything, and snaps each
        pixel to the nearest of the five colours in col:: (by RGB distance) -- so a blended edge
        pixel becomes one of the five flat tones, never the in-between shade. It leaves alpha
        alone. This used to be a per-channel threshold (each of R/G/B independently forced to
        0 or 255), which is simpler but can't represent grey at all: an equal-channel colour has
        nowhere to land but pure black or pure white depending only on which side of the channel
        midpoint it starts on, so col::grey (which happens to sit above the midpoint on every
        channel) always collapsed to pure white -- invisible against a white background, like
        the heard-bar's grey fill or the search field's placeholder text. Matching against the
        actual palette instead means grey survives as its own flat tone, wherever it's drawn.
        A popup menu, tooltip or other native sub-window is a separate ComponentPeer in JUCE, so
        attaching this to the main editor does not reach those -- only the one window it composites. */
    class ThresholdEffect : public juce::ImageEffectFilter
    {
    public:
        void applyEffect (juce::Image& image, juce::Graphics&, float scaleFactor, float alpha) override;
    };

    class TerminalLookAndFeel : public juce::LookAndFeel_V4
    {
    public:
        TerminalLookAndFeel();
        juce::Font getTextButtonFont (juce::TextButton&, int) override { return mono(); }
        juce::Font getLabelFont (juce::Label&) override { return mono(); }
        juce::Font getComboBoxFont (juce::ComboBox&) override { return mono(); }
        juce::Font getPopupMenuFont() override { return mono(); }
        // Buttons, combo boxes and toggles paint no box and no line: text/glyph only, emphasis
        // by colour on hover/down/focus. Only floating overlays (popup menus, tooltips) keep a
        // hairline, since they have no fixed neighbour to share a divider with.
        void drawButtonBackground (juce::Graphics&, juce::Button&, const juce::Colour&, bool over, bool down) override;
        // Hover/down on an ordinary text button reads as the same white "emphasis" level as a
        // toggle's own on-state text (see drawToggleButton) -- previously neither changed
        // anything here, so a button gave no visible feedback at all under the pointer.
        void drawButtonText (juce::Graphics&, juce::TextButton&, bool over, bool down) override;
        void drawComboBox (juce::Graphics&, int w, int h, bool, int, int, int, int, juce::ComboBox&) override;
        void drawScrollbar (juce::Graphics&, juce::ScrollBar&, int x, int y, int w, int h, bool vertical, int thumbStart, int thumbSize, bool over, bool down) override;
        int getDefaultScrollbarWidth() override { return 7; }
        // The window's resize grip: two short grey diagonals tucked into the last few pixels of the
        // corner (its drag area stays the full size), so it no longer draws over the credit that
        // ends on the right margin of the bottom line.
        void drawCornerResizer (juce::Graphics&, int w, int h, bool isMouseOver, bool isMouseDragging) override;
        // The Bank's column header (juce::TableHeaderComponent) paints itself by default: a
        // different (non-mono) font and a blue fill behind whichever column is sorted. Both
        // overridden here so the header reads in the same mono type as everything else, the
        // sorted column is marked by text colour alone (no fill -- the same "colour carries the
        // meaning, never a coloured box" rule as buttons/toggles), and the sort arrow is a flat
        // grey triangle, visible against the black background rather than the default's own tint.
        void drawTableHeaderBackground (juce::Graphics&, juce::TableHeaderComponent&) override;
        void drawTableHeaderColumn (juce::Graphics&, juce::TableHeaderComponent&, const juce::String& columnName, int columnId,
                                    int width, int height, bool isMouseOver, bool isMouseDown, int columnFlags) override;
        void drawTextEditorOutline (juce::Graphics&, int w, int h, juce::TextEditor&) override;
        void fillTextEditorBackground (juce::Graphics&, int w, int h, juce::TextEditor&) override;
        void drawToggleButton (juce::Graphics&, juce::ToggleButton&, bool over, bool down) override;
        void drawPopupMenuBackground (juce::Graphics&, int w, int h) override;
        void drawTooltip (juce::Graphics&, const juce::String&, int w, int h) override;
    };
}
