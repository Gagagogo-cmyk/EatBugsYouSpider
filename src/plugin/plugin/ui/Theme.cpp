#include "Theme.h"

namespace gnumbat::ui
{
    void drawWrapped (juce::Graphics& g, const juce::String& text, juce::Rectangle<int> area,
                       juce::Justification j, int maxLines)
    {
        const auto f = mono();
        const int lineH = juce::roundToInt (f.getHeight() * 1.15f);

        juce::StringArray lines;
        for (auto& para : juce::StringArray::fromLines (text))
        {
            if (para.isEmpty()) { lines.add ({}); continue; }
            juce::StringArray words;
            words.addTokens (para, " ", "");
            words.removeEmptyStrings();
            juce::String cur;
            for (auto& w : words)
            {
                const auto trial = cur.isEmpty() ? w : cur + " " + w;
                if (cur.isNotEmpty() && juce::GlyphArrangement::getStringWidthInt (f, trial) > area.getWidth())
                {
                    lines.add (cur);
                    cur = w;
                }
                else cur = trial;
            }
            lines.add (cur);
        }

        const bool truncated = lines.size() > maxLines;
        while (lines.size() > maxLines) lines.remove (lines.size() - 1);
        if (truncated && lines.size() > 0)
            lines.set (lines.size() - 1, lines[lines.size() - 1].trimCharactersAtEnd (" .") + "...");

        const int blockH = lineH * lines.size();
        int y = area.getY();
        if (j.testFlags (juce::Justification::verticallyCentred)) y += (area.getHeight() - blockH) / 2;
        else if (j.testFlags (juce::Justification::bottom)) y += area.getHeight() - blockH;
        const auto hFlags = j.getOnlyHorizontalFlags();
        for (auto& line : lines)
        {
            g.drawText (line, area.getX(), y, area.getWidth(), lineH, hFlags, true);
            y += lineH;
        }
    }

    TerminalLookAndFeel::TerminalLookAndFeel()
    {
        setColour (juce::ResizableWindow::backgroundColourId, col::bg);
        setColour (juce::Label::textColourId, col::text);
        // Buttons: no fill, no outline, ever. Text alone; getToggleState()/over/down step
        // between the two foreground levels (grey -> white), never a filled box.
        setColour (juce::TextButton::buttonColourId, col::bg);
        setColour (juce::TextButton::buttonOnColourId, col::bg);
        setColour (juce::TextButton::textColourOffId, col::text);
        setColour (juce::TextButton::textColourOnId, col::white);
        setColour (juce::TextEditor::backgroundColourId, col::bg);
        setColour (juce::TextEditor::textColourId, col::text);
        // A drag-selection inside a text field has to be visible to be usable at all -- the one
        // transient exception to "no background", the same single grey rather than a colour of
        // its own.
        setColour (juce::TextEditor::highlightColourId, col::grey.withAlpha (0.35f));
        setColour (juce::TextEditor::highlightedTextColourId, col::white);
        setColour (juce::TextEditor::outlineColourId, col::bg);
        setColour (juce::TextEditor::focusedOutlineColourId, col::bg);
        setColour (juce::CaretComponent::caretColourId, col::white);
        setColour (juce::ComboBox::backgroundColourId, col::bg);
        setColour (juce::ComboBox::textColourId, col::text);
        setColour (juce::ComboBox::outlineColourId, col::bg);
        setColour (juce::ComboBox::arrowColourId, col::dim);
        setColour (juce::PopupMenu::backgroundColourId, col::bg);
        setColour (juce::PopupMenu::textColourId, col::text);
        // the row under the pointer in an open menu: same transient-interaction exception.
        setColour (juce::PopupMenu::highlightedBackgroundColourId, col::grey.withAlpha (0.30f));
        setColour (juce::PopupMenu::highlightedTextColourId, col::white);
        setColour (juce::ScrollBar::thumbColourId, col::grey);
        setColour (juce::TableHeaderComponent::backgroundColourId, col::bg);
        setColour (juce::TableHeaderComponent::textColourId, col::dim);
        setColour (juce::TableHeaderComponent::outlineColourId, col::bg);
        setColour (juce::ListBox::backgroundColourId, col::bg);
        setColour (juce::ListBox::outlineColourId, col::bg);
        setColour (juce::ToggleButton::textColourId, col::text);
        setColour (juce::ToggleButton::tickColourId, col::green);
        setColour (juce::TooltipWindow::backgroundColourId, col::bg);
        setColour (juce::TooltipWindow::textColourId, col::text);
        setColour (juce::TooltipWindow::outlineColourId, col::line);
        setColour (juce::AlertWindow::backgroundColourId, col::bg);
        setColour (juce::AlertWindow::textColourId, col::text);
        setColour (juce::AlertWindow::outlineColourId, col::bg);
        setDefaultSansSerifTypefaceName (juce::Font::getDefaultMonospacedFontName());
    }

    void TerminalLookAndFeel::drawButtonBackground (juce::Graphics& g, juce::Button& b, const juce::Colour&, bool over, bool down)
    {
        // No box -- with one deliberate exception. BAKE (CapturePanel) marks itself with a
        // componentID rather than a subclass, and gets a solid filled square instead of the
        // usual grey/white text-colour emphasis: it's the primary action of that panel, the
        // same "filled means on/primary" language as the toggle button's own on-state square,
        // just sized to the whole control. White, the same maximum-emphasis tone used
        // everywhere else, rather than grey -- still flat, still no alpha blend except the one
        // transient disabled-state dimming every other disabled control here also uses.
        if (b.getComponentID() == "bakeFilled")
        {
            // Grey fill at rest, turning solid white on hover/down (enabled only) -- the label
            // itself stays a fixed black throughout (see drawButtonText below), so hover reads
            // entirely as the box lighting up, not the text changing colour. Never blended/at
            // reduced alpha, same "flat, no alpha blend except the one transient disabled-state
            // dimming every other disabled control here also uses" rule as everywhere else.
            g.setColour (b.isEnabled() && (over || down) ? col::white : col::grey);
            g.fillRect (b.getLocalBounds());
            return;
        }
        // Everywhere else: no box. The label itself (drawn by JUCE right after this, see
        // drawButtonText) carries all the emphasis; this override exists only to suppress
        // LookAndFeel_V4's own filled/outlined default so nothing is painted here.
        juce::ignoreUnused (g, b, over, down);
    }

    void TerminalLookAndFeel::drawButtonText (juce::Graphics& g, juce::TextButton& b, bool over, bool down)
    {
        const bool isBake = b.getComponentID() == "bakeFilled";
        // The Spectromorphology Lexicon's "(?)" (CapturePanel's heard bar): no hover state at
        // all -- stays exactly "(?)" in its resting colour whether hovered/down or not (see the
        // label text below), so it's excluded from the white-text hover rule the same way BAKE is.
        const bool isLexiconHelp = b.getComponentID() == "lexiconHelp";
        const auto base = b.findColour (b.getToggleState() ? juce::TextButton::textColourOnId : juce::TextButton::textColourOffId);
        // BAKE's label stays its fixed colour (black -- see the constructor in CapturePanel.cpp)
        // no matter what: hover/down is the fill turning white instead (see drawButtonBackground
        // above), not the text changing colour. Every other button has no fill at all, so white
        // text is its only hover cue -- except the Lexicon's "(?)", which has no hover cue at all.
        const auto colour = (! isBake && ! isLexiconHelp && b.isEnabled() && (over || down)) ? col::white : base;
        g.setColour (colour.withMultipliedAlpha (b.isEnabled() ? 1.0f : 0.5f));

        const auto font = getTextButtonFont (b, b.getHeight());
        const int yIndent = juce::jmin (4, b.proportionOfHeight (0.3f));
        const int cornerSize = juce::jmin (b.getHeight(), b.getWidth()) / 2;
        const int fontHeight = juce::roundToInt (font.getHeight() * 0.6f);
        const int leftIndent  = juce::jmin (fontHeight, 2 + cornerSize / (b.isConnectedOnLeft()  ? 4 : 2));
        const int rightIndent = juce::jmin (fontHeight, 2 + cornerSize / (b.isConnectedOnRight() ? 4 : 2));

        // The "<" that opens the Model menu: literally the right half of the CLEAR/X button's
        // own glyph -- two diagonal strokes meeting at the centre and opening toward the
        // top-right/bottom-right corners -- rather than a "<" character from the font. Same
        // size button as CLEAR (see PluginEditor::resized()) means the exact same
        // leftIndent/rightIndent/yIndent computed just above is the same box that button's own
        // "X" glyph is fitted within, so the two icons read as a matched pair: one whole X, one
        // cut down to just its own right half -- not two unrelated glyph shapes.
        if (b.getComponentID() == "modelHalfX")
        {
            auto inner = b.getLocalBounds().toFloat()
                            .withTrimmedLeft ((float) leftIndent).withTrimmedRight ((float) rightIndent)
                            .withTrimmedTop ((float) yIndent).withTrimmedBottom ((float) yIndent);
            const float vertexX = inner.getCentreX(), midY = inner.getCentreY();
            juce::Path p;
            p.startNewSubPath (vertexX, midY); p.lineTo (inner.getRight(), inner.getY());
            p.startNewSubPath (vertexX, midY); p.lineTo (inner.getRight(), inner.getBottom());
            g.strokePath (p, juce::PathStrokeType (1.4f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
            return;
        }

        g.setFont (font);
        // Left-aligned, zero-indent label: the text's left edge IS the button's left edge, so the
        // caller can put it exactly on a margin (the Bank's PLAY/STOP).
        if (b.getComponentID() == "textLeft")
        {
            g.drawText (b.getButtonText(), b.getLocalBounds(), juce::Justification::centredLeft, false);
            return;
        }
        const int textWidth = b.getWidth() - leftIndent - rightIndent;
        // The label itself is ALWAYS just b.getButtonText() -- never "[" + text + "]" folded
        // together. That used to be fed straight into drawFittedText below, which shrinks
        // (and can squeeze) the whole string to make it fit its box; a box sized for the bare
        // word had no room for two extra bracket glyphs, so the word itself visibly shrank and
        // recentred the moment a bracket condition went true. The brackets are drawn as a
        // separate, purely additive decoration in the left/right indent gutters below instead --
        // gutters every button already reserves around its own centred label -- so the label's
        // size and position never change, with or without them.
        // The Lexicon's "(?)" never swaps to "[?]" or anything else -- see isLexiconHelp above,
        // it simply has no hover/down cue, so its label is always just the plain button text.
        const juce::String label = b.getButtonText();
        if (textWidth > 0)
            g.drawFittedText (label, leftIndent, yIndent, textWidth, b.getHeight() - yIndent * 2, juce::Justification::centred, 2);

        // The "[X]" motif selected/contained things use elsewhere (tabs, tag chips): BAKE gets
        // it on hover/down (see drawButtonBackground above), any other toggle-style button
        // (currently just the BANK/MAP tabs -- see GnumbatEditor) gets it whenever it's the
        // selected one. Drawn only in the indent gutters already reserved above -- never
        // touching, or resizing, the label's own drawFittedText call.
        const bool bracket = isBake ? (b.isEnabled() && (over || down)) : b.getToggleState();
        if (bracket)
        {
            // Drawn at the bracket glyph's own full width, hugging the label's actual extents --
            // NOT squeezed into the indent gutter. A gutter (~6 px) is narrower than a "[" at this
            // font size, and drawText() with its default useEllipsesIfTooBig then swapped each
            // bracket for "..." -- which is why BAKE/BANK/MAP showed "...BANK..." instead of "[BANK]".
            // The label itself still isn't touched or resized. The 1 px gap between the bracket
            // and the word is as tight as it can sit and still read as its own glyph rather than
            // crowding into the letter next to it.
            const int labelW = juce::GlyphArrangement::getStringWidthInt (font, b.getButtonText());
            const int bw = juce::jmax (juce::GlyphArrangement::getStringWidthInt (font, "["),
                                       juce::GlyphArrangement::getStringWidthInt (font, "]"));
            const int cx = leftIndent + textWidth / 2;
            const int lx = juce::jmax (0, cx - labelW / 2 - bw - 1);
            const int rx = juce::jmin (b.getWidth() - bw, cx + (labelW + 1) / 2 + 1);
            g.drawText ("[", lx, 0, bw, b.getHeight(), juce::Justification::centred, false);
            g.drawText ("]", rx, 0, bw, b.getHeight(), juce::Justification::centred, false);
        }
    }

    void TerminalLookAndFeel::drawComboBox (juce::Graphics& g, int w, int h, bool, int, int, int, int, juce::ComboBox& cb)
    {
        // Background fill only -- no hairline. The field is bounded by nothing but the layout
        // around it, same as everything else now.
        g.setColour (findColour (juce::ComboBox::backgroundColourId));
        g.fillRect (0, 0, w, h);
        juce::Path p;
        const float cx = (float) w - 11.0f, cy = (float) h * 0.5f;
        p.addTriangle (cx - 3.5f, cy - 2.0f, cx + 3.5f, cy - 2.0f, cx, cy + 2.5f);
        g.setColour (cb.isEnabled() ? col::dim : col::dim.withAlpha (0.35f));
        g.fillPath (p);
    }

    void TerminalLookAndFeel::drawCornerResizer (juce::Graphics& g, int w, int h, bool over, bool dragging)
    {
        // Only the last 7 px of the corner -- clear of text that ends on the 10 px right margin.
        const float size = 7.0f, x1 = (float) w - 1.0f, y1 = (float) h - 1.0f;
        g.setColour (over || dragging ? col::white : col::grey);
        for (float d : { size, size * 0.5f })
            g.drawLine (x1 - d, y1, x1, y1 - d, 1.0f);
    }

    void TerminalLookAndFeel::drawScrollbar (juce::Graphics& g, juce::ScrollBar&, int x, int y, int w, int h, bool vertical, int start, int size, bool over, bool down)
    {
        g.setColour (col::bg);
        g.fillRect (x, y, w, h);
        g.setColour (down ? col::white : (over ? col::white.withAlpha (0.7f) : col::grey.withAlpha (0.6f)));
        if (vertical) g.fillRect (x + 2, y + start, w - 4, size);
        else          g.fillRect (x + start, y + 2, size, h - 4);
    }

    void TerminalLookAndFeel::fillTextEditorBackground (juce::Graphics& g, int w, int h, juce::TextEditor& e)
    {
        g.setColour (e.findColour (juce::TextEditor::backgroundColourId));
        g.fillRect (0, 0, w, h);
    }

    void TerminalLookAndFeel::drawTextEditorOutline (juce::Graphics&, int, int, juce::TextEditor&)
    {
        // No outline, focused or not -- a text field is bounded by nothing but its own text,
        // like every other in-flow control now.
    }

    void TerminalLookAndFeel::drawToggleButton (juce::Graphics& g, juce::ToggleButton& b, bool over, bool)
    {
        // No box around the control. A small filled square marks "on" -- the reserved green,
        // the same language as READY -- and nothing at all is drawn for "off".
        const float s = 9.0f;
        juce::Rectangle<float> box (2.0f, ((float) b.getHeight() - s) * 0.5f, s, s);
        if (b.getToggleState()) { g.setColour (col::green); g.fillRect (box.reduced (1.0f)); }
        g.setColour (b.isEnabled() ? (over ? col::white : col::text) : col::dim.withAlpha (0.5f));
        g.setFont (mono());
        g.drawText (b.getButtonText(), b.getLocalBounds().withTrimmedLeft ((int) s + 8), juce::Justification::centredLeft, true);
    }

    void TerminalLookAndFeel::drawTableHeaderBackground (juce::Graphics& g, juce::TableHeaderComponent&)
    {
        g.fillAll (col::bg);   // flat black, no gradient -- the header is bounded by nothing but the row below it
    }

    void TerminalLookAndFeel::drawTableHeaderColumn (juce::Graphics& g, juce::TableHeaderComponent&, const juce::String& columnName, int,
                                                      int width, int height, bool isMouseOver, bool, int columnFlags)
    {
        juce::ignoreUnused (isMouseOver);   // no hover fill -- headers stay exactly as they are, same as buttons/toggles
        const bool sorted = (columnFlags & (juce::TableHeaderComponent::sortedForwards | juce::TableHeaderComponent::sortedBackwards)) != 0;
        const int arrowW = sorted ? 14 : 0;
        g.setColour (sorted ? col::white : col::dim);
        g.setFont (mono());
        g.drawText (columnName, 4, 0, juce::jmax (0, width - 8 - arrowW), height, juce::Justification::centredLeft, true);
        if (sorted)
        {
            const bool up = (columnFlags & juce::TableHeaderComponent::sortedForwards) != 0;
            const float cx = (float) width - 12.0f, cy = (float) height * 0.5f;
            juce::Path tri;
            if (up) tri.addTriangle (cx - 4.0f, cy + 2.5f, cx + 4.0f, cy + 2.5f, cx, cy - 3.0f);
            else    tri.addTriangle (cx - 4.0f, cy - 2.5f, cx + 4.0f, cy - 2.5f, cx, cy + 3.0f);
            g.setColour (col::dim);   // grey, not the sorted column's white text -- visible on black either way
            g.fillPath (tri);
        }
    }

    void TerminalLookAndFeel::drawPopupMenuBackground (juce::Graphics& g, int w, int h)
    {
        // Floating overlay, no fixed neighbour to share a divider with -- the one place a
        // hairline survives, so the menu reads as its own surface against the same black.
        g.fillAll (findColour (juce::PopupMenu::backgroundColourId));
        g.setColour (col::line);
        g.drawRect (0, 0, w, h, 1);
    }

    void TerminalLookAndFeel::drawTooltip (juce::Graphics& g, const juce::String& text, int w, int h)
    {
        g.fillAll (col::bg);
        g.setColour (col::line);
        g.drawRect (0, 0, w, h, 1);
        g.setColour (col::text);
        g.setFont (mono());
        drawWrapped (g, text, { 6, 3, w - 12, h - 6 }, juce::Justification::centredLeft, 6);
    }

    namespace
    {
        struct Rgb { juce::uint8 r, g, b; };

        // Exactly col::bg/grey/white/green/red -- quantizing to the nearest of these five
        // (by squared RGB distance) instead of thresholding each channel independently is what
        // lets grey survive as its own tone; see the comment on ThresholdEffect in Theme.h.
        constexpr Rgb kPalette[] = {
            { 0x00, 0x00, 0x00 },   // col::bg
            { 0x8a, 0x90, 0x8c },   // col::grey
            { 0xff, 0xff, 0xff },   // col::white
            { 0x00, 0xff, 0x50 },   // col::green (flash green)
            { 0xff, 0x14, 0x00 },   // col::red (flashier)
        };

        inline Rgb nearestPaletteColour (juce::uint8 r, juce::uint8 g, juce::uint8 b)
        {
            int bestIndex = 0;
            int bestDist = -1;
            for (int i = 0; i < (int) (sizeof (kPalette) / sizeof (kPalette[0])); ++i)
            {
                const auto& p = kPalette[i];
                const int dr = (int) r - (int) p.r;
                const int dg = (int) g - (int) p.g;
                const int db = (int) b - (int) p.b;
                const int dist = dr * dr + dg * dg + db * db;
                if (bestDist < 0 || dist < bestDist) { bestDist = dist; bestIndex = i; }
            }
            return kPalette[bestIndex];
        }
    }

    void ThresholdEffect::applyEffect (juce::Image& image, juce::Graphics& g, float, float alpha)
    {
        // Force a known, alpha-capable layout -- the source may come in as RGB (opaque
        // components skip the alpha channel) or already ARGB, and PixelARGB's accessors are
        // only valid once it's actually that format.
        if (image.getFormat() != juce::Image::ARGB)
            image = image.convertedToFormat (juce::Image::ARGB);

        juce::Image::BitmapData bmp (image, juce::Image::BitmapData::readWrite);
        for (int y = 0; y < bmp.height; ++y)
        {
            auto* row = bmp.getLinePointer (y);
            for (int x = 0; x < bmp.width; ++x)
            {
                auto* px = reinterpret_cast<juce::PixelARGB*> (row + x * bmp.pixelStride);
                const auto snapped = nearestPaletteColour (px->getRed(), px->getGreen(), px->getBlue());
                px->setARGB (255, snapped.r, snapped.g, snapped.b);
            }
        }

        g.setOpacity (alpha);
        g.drawImageAt (image, 0, 0);
    }
}
