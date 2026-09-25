#include "CapturePanel.h"
#include "Theme.h"
#include <cmath>

namespace gnumbat::ui
{
    using juce::String;

    static double beatsPerBar (const TransportSnapshot& t) { return t.tsNum > 0 && t.tsDen > 0 ? t.tsNum * 4.0 / t.tsDen : 4.0; }

    String CapturePanel::formatMarker (const Marker& m, const TransportSnapshot& t)
    {
        if (! m.isSet()) return "-";
        if (m.hasPpq && t.hasPpq)
        {
            const double bpb = beatsPerBar (t);
            const int bar = (int) std::floor (m.ppq / bpb) + 1;
            const double beat = std::fmod (m.ppq, bpb) + 1.0;
            return String (bar) + "|" + String (beat < 0 ? beat + bpb : beat, 2);
        }
        const double secs = t.sampleRate > 0 ? (double) m.sample / t.sampleRate : 0.0;
        const int mm = (int) (secs / 60.0);
        return String (mm) + ":" + String::formatted ("%06.3f", secs - mm * 60.0);
    }

    // Kept as a general-purpose "m:ss.mmm | bar|beat" parser (still exercised directly by the test suite) even
    // though the panel no longer has any editable marker fields of its own to feed it.
    bool CapturePanel::parseMarker (const String& text, const Marker& now, const TransportSnapshot& t, Marker& out)
    {
        const auto s = text.trim();
        if (s.isEmpty() || ! now.isSet() || t.sampleRate <= 0) return false;
        if (s.containsChar ('|'))                                // bar|beat  (1-based), relative to "now" at constant tempo
        {
            if (! now.hasPpq || t.bpm <= 0) return false;
            const double bpb = beatsPerBar (t);
            const double bar = s.upToFirstOccurrenceOf ("|", false, false).getDoubleValue();
            const double beat = s.fromFirstOccurrenceOf ("|", false, false).getDoubleValue();
            const double ppq = (bar - 1.0) * bpb + (beat - 1.0);
            out.ppq = ppq; out.hasPpq = true;
            out.sample = now.sample + (juce::int64) std::llround ((ppq - now.ppq) * 60.0 / t.bpm * t.sampleRate);
            return out.sample >= 0;
        }
        double secs = 0.0;                                       // m:ss.mmm | ss.mmm
        if (s.containsChar (':')) secs = s.upToFirstOccurrenceOf (":", false, false).getDoubleValue() * 60.0 + s.fromFirstOccurrenceOf (":", false, false).getDoubleValue();
        else secs = s.getDoubleValue();
        if (secs < 0) return false;
        out.sample = (juce::int64) std::llround (secs * t.sampleRate);
        out.hasPpq = now.hasPpq && t.bpm > 0;
        if (out.hasPpq) out.ppq = now.ppq + (double) (out.sample - now.sample) / t.sampleRate * t.bpm / 60.0;
        return true;
    }

    CapturePanel::CapturePanel (GnumbatProcessor& p, UiHost& h) : proc (p), host (h)
    {
        // BAKE: the one deliberate exception to "no box, ever" (see drawButtonBackground) --
        // it's the primary action of this whole panel, marked via componentID so the
        // look-and-feel can single it out without a subclass. Black-on-grey rather than the
        // usual grey/white-on-black, so the fill still reads as the emphasis, not the text.
        bake.setComponentID ("bakeFilled");
        bake.setColour (juce::TextButton::textColourOffId, col::bg);
        bake.setColour (juce::TextButton::textColourOnId, col::bg);
        bake.setTooltip ("Capture the host's current loop / cycle range as a Bake. Audio is copied out of the ring first, so you can take your time typing the notation and tags.");
        bake.onClick = [this] { if (onBake) onBake(); };
        addAndMakeVisible (bake);

        helpButton.setComponentID ("lexiconHelp");   // see TerminalLookAndFeel::drawButtonText -- no hover/down cue at all, stays plain "(?)"
        helpButton.setTooltip ("Spectromorphology Lexicon -- the spectral_tags / morphology_tags vocabulary, as a tree");
        helpButton.onClick = [this] { if (onShowLexicon) onShowLexicon(); };
        addAndMakeVisible (helpButton);

        // Sits transparently over the heard bar's own grey fill (see resized()/paint()). The
        // editor itself draws NO text (transparent text/placeholder colours) -- only the caret and
        // selection. paintOverChildren() draws the text and the placeholder instead, with the
        // same split-colour trick as the "heard %"/"ring" labels, so any part of it the grey heard
        // zone passes under turns black instead of washing out grey-on-grey.
        notation.setFont (mono());
        notation.setMultiLine (false);
        notation.setReturnKeyStartsNewLine (false);
        notation.setTextToShowWhenEmpty ({}, juce::Colours::transparentBlack);
        // Vertically centred in the same row the "heard %" label is centred in, with no extra
        // indents -- so the field's text shares that label's baseline exactly (the default 4 px
        // top indent in a shorter, inset box used to sit it visibly lower).
        notation.setJustification (juce::Justification::centredLeft);
        notation.setIndents (0, 0);
        notation.setBorder ({});
        notation.setColour (juce::TextEditor::backgroundColourId, juce::Colours::transparentBlack);
        notation.setColour (juce::TextEditor::outlineColourId, juce::Colours::transparentBlack);
        notation.setColour (juce::TextEditor::focusedOutlineColourId, juce::Colours::transparentBlack);
        notation.setColour (juce::TextEditor::textColourId, juce::Colours::transparentBlack);
        notation.setColour (juce::TextEditor::highlightedTextColourId, juce::Colours::transparentBlack);
        notation.setColour (juce::CaretComponent::caretColourId, col::white);
        notation.onTextChange = [this] { repaint (coverageRect); };
        notation.onReturnKey = [this] { if (onBake) onBake(); };   // Enter while typing here = BAKE (same as everywhere on this page)
        addChildComponent (notation);   // hidden until the selection is 100 % heard (see timerCallback)

        refreshFromPlan();
        startTimerHz (15);
    }

    CapturePanel::~CapturePanel() { stopTimer(); }

    void CapturePanel::refreshFromPlan()
    {
        proc.plan.mode = CapturePlan::Mode::loop;      // the only mode this panel ever offers: the DAW's loop range
        resized();
    }

    int CapturePanel::notationX()
    {
        // 10 px panel margin + 6 px bar inset + "heard" + 12 px gap. The field only appears once the
        // selection is fully heard, when the readout is just "heard" -- so it starts right after it.
        return 10 + 6 + juce::GlyphArrangement::getStringWidthInt (mono(), "heard") + 12;
    }

    String CapturePanel::ringLabel() const
    {
        // The host's current position, just the number ("29|3.02") -- it replaced the "ring Ns"
        // readout here, and the "pos" label is gone. "memory full" still takes its place when the
        // tape can't keep any more audio.
        if (tapeFull) return "memory full";
        if (! t.valid || t.samples < 0) return "-";
        Marker now; now.sample = t.samples; now.ppq = t.ppq; now.hasPpq = t.hasPpq;
        return formatMarker (now, t);
    }

    void CapturePanel::layoutNotation()
    {
        // Inside the heard bar, left to right: "heard", the notation field, "(?)" (the
        // Spectromorphology Lexicon), then the field's clear "X" at the far right (its ink on the
        // bar's 6 px inset, like the text on the left). "pos" (the host's live position,
        // "29|3.02") only matters while still listening -- it's dropped entirely once the loop's
        // fully heard (typing notation/tags is the point then, not tracking playback), so "(?)"
        // inherits its old spot right before the X in that state; while still listening, pos sits
        // flush right across the bar (see paint()) and "(?)" sits just before that instead.
        const int xW = juce::GlyphArrangement::getStringWidthInt (mono(), "X") + 8;   // 4 px of click slop each side
        clearRect = { coverageRect.getRight() - 6 + 4 - xW, coverageRect.getY(), xW, coverageRect.getHeight() };
        const int helpW = juce::GlyphArrangement::getStringWidthInt (mono(), "(?)") + 14;
        juce::Rectangle<int> helpArea;
        if (heardComplete)
        {
            posRect = {};   // not drawn any more -- see paint()
            lastRingW = 0;
            // The raw box-to-box gap here is deliberately negative (helpArea overlaps clearRect's
            // own box by a few px) -- "(?)"/"[?]" is a real button with its own left/right text
            // indent (see TerminalLookAndFeel::drawButtonText), and the X has its own built-in
            // click slop (see xW above), so a 0-or-positive box gap actually reads as a much wider
            // gap between the glyphs themselves than the number suggests. This lands the visible
            // gap between the two glyphs at roughly 7-8 px, on request.
            helpArea = { clearRect.getX() + 4 - helpW, coverageRect.getY(), helpW, coverageRect.getHeight() };
        }
        else
        {
            const int posW = juce::GlyphArrangement::getStringWidthInt (mono(), ringLabel());
            lastRingW = posW;
            auto barArea = coverageRect.reduced (6, 0);
            posRect = { barArea.getRight() - posW, barArea.getY(), posW, barArea.getHeight() };
            helpArea = { posRect.getX() - 8 - helpW, coverageRect.getY(), helpW, coverageRect.getHeight() };
        }
        helpButton.setBounds (helpArea.withSizeKeepingCentre (helpArea.getWidth(), juce::jmin (helpArea.getHeight(), 18)));
        auto notationArea = coverageRect.reduced (6, 1);
        notationArea.setLeft (notationX());
        notationArea.setRight (juce::jmax (notationArea.getX(), helpArea.getX() - 10));
        notation.setBounds (notationArea);
    }

    void CapturePanel::resized()
    {
        constexpr int row = 15;                            // one compact text row -- tightened further
        auto r = getLocalBounds().reduced (10, 0);          // side margins only
        r.removeFromTop (6);                                // a little breathing room, not a full blank row

        // Every row below spans the panel's own full (margin-trimmed) width -- no fixed pixel
        // budget (no 60%-of-top column split, no fixed-width status field) that can leave
        // something clipped once the window opens small or gets resized down. Each row just
        // takes whatever width is actually there.
        titleRect = r.removeFromTop (row + 4);             // as tall as the heard bar: it holds the account fields
        // The host row is two text-rows tall now, not one: the VU meters stack L above R here,
        // each its own row with its own dB readout, and the status text just vertically centres
        // within that same taller band instead of needing a row of its own.
        auto hostRow = r.removeFromTop (row * 2);
        meterRect = hostRow.removeFromLeft (juce::jmin (hostRow.getWidth(), 96));
        hostRow.removeFromLeft (8);
        hostRect = hostRow;
        loopRect = r.removeFromTop (row);
        r.removeFromTop (6);

        // The heard/coverage row and BAKE share their one remaining row, both fully inside the
        // frame: BAKE is sized to its own label but clamped to at most a third of whatever width
        // is actually available, so it can never itself push wider than the panel and get cut
        // off the way it did at small/compact window sizes before.
        auto coverageRow = r.removeFromTop (row + 4);
        // As narrow as it can be while its hover brackets still fit: label + a bracket and its
        // 1 px gap on each side (see TerminalLookAndFeel::drawButtonText) + 2 px of fill outside each.
        const int bracketW = juce::jmax (juce::GlyphArrangement::getStringWidthInt (mono(), "["),
                                         juce::GlyphArrangement::getStringWidthInt (mono(), "]"));
        const int bakeW = juce::jmin (coverageRow.getWidth() / 3,
                                      juce::GlyphArrangement::getStringWidthInt (mono(), "BAKE") + 2 * (bracketW + 1 + 2));
        bakeRect = coverageRow.removeFromRight (bakeW);
        coverageRow.removeFromRight (8);   // a gap -- BAKE and the heard bar are neighbours, not one fused control
        coverageRect = coverageRow;
        bake.setBounds (bakeRect);

        // Left to right inside the bar: "heard X%", then the notation/tag field, then "ring Ys"
        // on the far right (see paint()) -- both readouts reserve a representative worst-case
        // string width (same reasoning bakeW uses for its own label), so the field's bounds never
        // overlap either one regardless of the actual numbers.
        // Same horizontal inset (6 px) and the same full bar height as the "heard %" label, so
        // the field's text is centred on exactly the same line as that label.
        layoutNotation();
    }

    void CapturePanel::mouseUp (const juce::MouseEvent& e)
    {
        if (modelRect.contains (e.getPosition()) && e.mouseWasClicked() && onModelClick) onModelClick();
        if (notation.isVisible() && clearRect.contains (e.getPosition()) && e.mouseWasClicked())
        {
            notation.clear();
            unfocusAllComponents();
            repaint (coverageRect);
        }
    }

    void CapturePanel::mouseMove (const juce::MouseEvent& e)
    {
        const bool overClear = notation.isVisible() && clearRect.contains (e.getPosition());
        if (overClear != clearHover) { clearHover = overClear; setMouseCursor (overClear ? juce::MouseCursor::PointingHandCursor : juce::MouseCursor::NormalCursor); }
        if (overClear) return;
        const bool h = modelRect.contains (e.getPosition());
        if (h != modelHover) { modelHover = h; setMouseCursor (h ? juce::MouseCursor::PointingHandCursor : juce::MouseCursor::NormalCursor); repaint (titleRect); }
    }

    void CapturePanel::mouseExit (const juce::MouseEvent&)
    {
        if (modelHover) { modelHover = false; setMouseCursor (juce::MouseCursor::NormalCursor); repaint (titleRect); }
    }

    void CapturePanel::timerCallback()
    {
        t = proc.transport();
        for (int c = 0; c < 2; ++c)
        {
            const double db = juce::Decibels::gainToDecibels (t.level[c], -60.0);
            constexpr double decayDbPerTick = 6.0 / 15.0;   // ~6 dB/s at this timer's 15 Hz rate -- slower
                                                             // still than the original ~20 dB/s, so the
                                                             // peak marker settles even more before it moves again
            peakDb[c] = juce::jmax (db, peakDb[c] - decayDbPerTick);
        }
        // The bar IS the host selection on the TimelineTape (see GnumbatProcessor::selection()):
        // left edge = selection start, right edge = selection end, grey = audio actually stored.
        const auto sel = proc.selection();
        const bool haveLoop = sel.ok;
        coverage = haveLoop ? sel.coverage : 0.0;
        coveredFractions = haveLoop ? sel.fractions : std::vector<std::pair<double, double>>();
        tapeFull = haveLoop && sel.tapeFull;
        // The notation field only exists once the whole selection has been heard -- that's the
        // moment there's something complete to Bake and describe. (Typed text is kept while hidden.)
        heardComplete = haveLoop && sel.complete;
        // Re-run the bar layout on a width change (the position's digit count grows/shrinks) OR
        // the heard-complete transition itself (pos can drop out on a tick where its width
        // happens not to change -- see CapturePanel.h's prevHeardComplete).
        const int currentPosW = heardComplete ? 0 : juce::GlyphArrangement::getStringWidthInt (mono(), ringLabel());
        if (currentPosW != lastRingW || heardComplete != prevHeardComplete) layoutNotation();
        prevHeardComplete = heardComplete;
        // Diagnostics: if the bar stalls short of 100 % (>= 90 % but not complete), append what's
        // missing to ~/Documents/Gnumbat/heard_debug.log every ~3 s while it stays stuck.
        if (haveLoop && ! sel.complete && sel.coverage >= 0.9)
        {
            if (++debugTicks >= 45)
            {
                debugTicks = 0;
                proc.writeHeardDebug (juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                                          .getChildFile ("Gnumbat").getChildFile ("heard_debug.log"));
            }
        }
        else debugTicks = 40;   // first dump comes quickly once it gets stuck
        if (notation.isVisible() != heardComplete)
        {
            if (! heardComplete && notation.hasKeyboardFocus (true)) unfocusAllComponents();
            notation.setVisible (heardComplete);
        }
        bake.setEnabled (t.valid && haveLoop);
        // Caret: white on black, black wherever it sits on the grey heard fill (greyRects is from
        // the last paint; setColour is a no-op unless the colour actually changes).
        const auto caret = notation.getCaretRectangle().translated (notation.getX(), notation.getY());
        notation.setColour (juce::CaretComponent::caretColourId,
                            greyRects.intersectsRectangle (caret.withWidth (1)) ? col::bg : col::white);
        // "(?)": same split-colour rule as everything else on the bar -- black wherever the grey
        // heard-progress fill currently passes under it (greyRects is from the last paint; hover
        // still shows white regardless, same as every other button here).
        helpButton.setColour (juce::TextButton::textColourOffId,
                              greyRects.intersectsRectangle (helpButton.getBounds()) ? col::bg : col::text);
        repaint();
    }

    void CapturePanel::paint (juce::Graphics& g)
    {
        g.fillAll (col::panel);

        // ---- title / credit line -- no separate header any more, this is its own top row.
        // "model / NAME" leads on the left now, the host/track name (e.g. "Reaper / MASTER")
        // trails flush right (swapped on request), with the credit in the free gap between them.
        {
            // The credit line is dim now, same as the host name and the "model /" label -- a
            // footnote, not emphasis. The current track name (e.g. "MASTER" -- whichever channel
            // is actually selected in the host) and the session's current Model (see
            // core/ModelTree.h, chosen by clicking the model name itself -- GnumbatEditor::openModelMenu()) draw
            // white right after their own label -- a run of dim/white/dim/white draws at
            // successive measured x-offsets rather than one string in one colour.
            g.setFont (mono());
            int x = titleRect.getX();
            auto drawDim = [&] (const String& s)
            {
                g.setColour (col::dim);
                g.drawText (s, titleRect.withTrimmedLeft (x - titleRect.getX()), juce::Justification::centredLeft, true);
                x += juce::GlyphArrangement::getStringWidthInt (mono(), s);
            };
            auto drawWhite = [&] (const String& s)
            {
                g.setColour (col::white);
                g.drawText (s, titleRect.withTrimmedLeft (x - titleRect.getX()), juce::Justification::centredLeft, true);
                x += juce::GlyphArrangement::getStringWidthInt (mono(), s);
            };

            const String trackName = proc.trackName();
            // "model_name" is kept live by GnumbatEditor::setCurrentModel() -- empty until a
            // Model's actually been picked (or one exists to default to), in which case nothing
            // extra is drawn here at all.
            const String modelName = proc.getUiState ("model_name", "").toString();

            // (The account fields -- LoginBar -- moved to the bottom of the window -- see
            // GnumbatEditor::paint()/layoutLoginBar(). The middle of this line now holds the credit,
            // "(c) 2026 Gnumbat AGPL 3.0", drawn below once this line's free gap is known -- lined
            // up with this row, not a separate strip above it.)
            // ---- LEFT: "model / NAME" (swapped over from the right on request -- host/track name
            // is now the right-aligned side below). Always drawn (a placeholder when nothing's
            // picked yet) since it's the only way into the Model menu -- click anywhere on it. The
            // word "model" itself is the button: grey at rest, white while the pointer's over it.
            const String shownModel = modelName.isNotEmpty() ? modelName : String ("choose");
            const int modelStartX = x;
            if (modelHover) drawWhite ("model"); else drawDim ("model");
            modelRect = titleRect.withLeft (modelStartX).withRight (juce::jmin (titleRect.getRight(), x));
            drawDim (" / ");
            drawWhite (shownModel);
            const int leftEnd = x;
            // ---- RIGHT: "Reaper / MASTER" (was the left/leading side) -- flush against the right
            // margin (titleRect's right edge is the panel's 10 px margin), never pushed along by
            // the model text on the left -- only if the window's too narrow for both does it fall
            // back to following that text.
            // Measured piece by piece, exactly as drawn below (hostPart, then trackName) -- same
            // reasoning modelW used to give itself: measuring the pieces separately is what's
            // actually drawn, so there's no rounding mismatch between the two.
            const String hostPart = proc.hostName() + (trackName.isNotEmpty() ? " / " : String());
            const int hostW = juce::GlyphArrangement::getStringWidthInt (mono(), hostPart)
                             + (trackName.isNotEmpty() ? juce::GlyphArrangement::getStringWidthInt (mono(), trackName) : 0);
            const int mx = juce::jmax (x + juce::GlyphArrangement::getStringWidthInt (mono(), "   "), titleRect.getRight() - hostW);
            x = mx;
            // The credit, in this line's free middle gap (between "model / NAME" on the left and
            // the host/track name on the right) -- aligned with "Reaper / MASTER" on this same
            // line, not a separate row above it. Centred on the window itself when there's room,
            // else as centred as the gap allows.
            {
                auto mid = titleRect.withLeft (leftEnd).withRight (juce::jmax (leftEnd, mx)).reduced (12, 0);
                if (mid.getWidth() > 0)
                {
                    const String credit ("(c) 2026 Gnumbat AGPL 3.0");
                    // Same size as everything else now (no more exception to "one type size"),
                    // and dim like the rest of this row's labels -- it's a footnote, not emphasis.
                    const auto& creditFont = mono();
                    const int creditW = juce::GlyphArrangement::getStringWidthInt (creditFont, credit);
                    int cx = getWidth() / 2 - creditW / 2;
                    if (cx < mid.getX() || cx + creditW > mid.getRight()) cx = mid.getCentreX() - creditW / 2;
                    const int baseline = juce::roundToInt ((float) mid.getY() + ((float) mid.getHeight() - creditFont.getHeight()) * 0.5f + creditFont.getAscent());
                    g.setColour (col::dim);
                    g.setFont (creditFont);
                    g.drawSingleLineText (credit, cx, baseline);
                }
            }
            // Tell the editor where the free middle of this line is, so it can centre the account
            // fields in it (only when it actually moved).
            if (leftEnd != titleLeftEnd || mx != titleRightStart)
            {
                titleLeftEnd = leftEnd; titleRightStart = mx;
                if (onTitleLayout)
                    juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<CapturePanel> (this)]
                    { if (safe != nullptr && safe->onTitleLayout) safe->onTitleLayout(); });
            }
            drawDim (hostPart);
            if (trackName.isNotEmpty()) drawWhite (trackName);
        }

        // No dedicated drop-zone widget any more -- dropping audio files anywhere on this
        // window still imports them (see GnumbatEditor::filesDropped); browsing for files
        // instead is Cmd/Ctrl+I now (see GnumbatEditor::keyPressed), not a click target here.

        // ---- host line
        auto hr = hostRect;
        g.setFont (mono());
        const bool live = t.valid;
        const bool playing = t.playing;
        const bool showPlaying = live && ! proc.isStandalone() && playing;
        const String state = ! live ? "IDLE (nothing processed yet)" : proc.isStandalone() ? "STANDALONE" : playing ? "PLAYING" : "STOPPED";
        String s;
        if (t.bpm > 0) s << "   " << String (t.bpm, 1) << " bpm";
        if (t.tsNum > 0) s << "  " << t.tsNum << "/" << t.tsDen;
        // (the position lives at the right end of the heard bar now -- see ringLabel())
        if (live && ! t.hostTimeline) s << "   (no host timeline: own counter)";
        if (t.offline) s << "   OFFLINE";
        if (t.recording) s << "   REC";

        // The state word always sits at the same x (the left margin). PLAYING gets a solid white
        // box grown OUTWARD around the word (black text), STOPPED is plain grey text -- so
        // switching states never moves the word itself.
        constexpr int padX = 4;
        const int x0 = hr.getX();
        const int stateW = juce::GlyphArrangement::getStringWidthInt (mono(), state);
        if (showPlaying)
        {
            const int boxH = juce::roundToInt (mono().getHeight()) + 2;
            g.setColour (col::white);
            g.fillRect (juce::Rectangle<int> (x0 - padX, hr.getCentreY() - boxH / 2, stateW + padX * 2, boxH));
            g.setColour (col::bg);
        }
        else
        {
            g.setColour (col::text);   // STOPPED (and every other state): plain grey, no box
        }
        g.drawText (state, hr.withLeft (x0), juce::Justification::centredLeft, false);

        // bpm / signature / pos: always grey, always at one fixed x -- a slot as wide as the wider
        // of PLAYING/STOPPED (plus the box's outward pad), so nothing after it shifts or changes
        // colour when the transport starts or stops. (Longer one-off states like IDLE push it on.)
        const int slotW = juce::jmax (juce::GlyphArrangement::getStringWidthInt (mono(), "PLAYING"),
                                      juce::GlyphArrangement::getStringWidthInt (mono(), "STOPPED")) + padX;
        g.setColour (col::text);
        g.drawText (s, hr.withLeft (x0 + juce::jmax (slotW, stateW)), juce::Justification::centredLeft, true);

        // ---- meters -- small, compact, L and R the same size, sat where the transport LED used
        // to be (see resized()). Always drawn (not gated on `live`: an idle/silent input is
        // still a reading of -inf, not an absent meter), from a local copy of meterRect --
        // mutating the member itself here was the old bug that made the meter collapse to
        // nothing after the very first paint().
        {
            auto mr = meterRect;
            constexpr int meterRow = 14;
            constexpr int meterGap = 2;   // a hair of vertical space between L and R -- just enough to read as two separate meters, not one fused block
            for (int c = 0; c < 2; ++c)
            {
                auto chRow = mr.removeFromTop (meterRow);   // L above R, one stacked row per channel -- same size as each other
                if (c == 0) mr.removeFromTop (meterGap);
                auto bar = chRow.removeFromLeft (juce::jmax (4, chRow.getWidth() - 44));
                chRow.removeFromLeft (4);
                g.setColour (col::bg); g.fillRect (bar);
                const double db = juce::Decibels::gainToDecibels (t.level[c], -60.0);
                const float f = (float) juce::jlimit (0.0, 1.0, (db + 60.0) / 60.0);
                // no red left for clipping -- white (the same "needs attention" used everywhere
                // else) at the clip edge, green for an ordinary healthy level, grey when it's quiet
                g.setColour (db > -1.0 ? col::white : db > -12.0 ? col::green : col::grey);
                g.fillRect (bar.withWidth ((int) ((float) bar.getWidth() * f)));
                // peak-hold marker: a thin line at the held peak, not a second bar -- pushed up
                // the instant peakDb rises, then drifts back down on its own (see timerCallback).
                const float pf = (float) juce::jlimit (0.0, 1.0, (peakDb[c] + 60.0) / 60.0);
                const int px = juce::jlimit (bar.getX(), juce::jmax (bar.getX(), bar.getRight() - 1), bar.getX() + (int) ((float) bar.getWidth() * pf));
                g.setColour (col::white);
                g.fillRect (px, bar.getY(), 1, bar.getHeight());
                // the number tracks the held peak, not the instantaneous level -- that's what
                // keeps it readable instead of flickering at 15 Hz.
                g.setColour (col::text); g.setFont (mono());
                g.drawText (peakDb[c] <= -59.9 ? String ("-inf") : String (peakDb[c], 1), chRow, juce::Justification::centredLeft);
            }
        }

        // ---- the loop range: the only "length" a Bake ever has
        {
            Marker a, b;
            const bool ok = proc.loopMarkers (a, b);
            g.setFont (mono());
            g.setColour (ok ? col::text : col::white);   // "needs attention" reads as max emphasis, not a warning hue
            String ls = ok ? "loop  " + formatMarker (a, t) + "  ->  " + formatMarker (b, t) : String ("set a loop / cycle range in the host to Bake");
            if (ok)
                if (const auto sel = proc.selection(); sel.ok)
                    ls << "   (" << String (sel.seconds, 2) << " s)";   // the same span the heard bar draws
            g.drawText (ls, loopRect, juce::Justification::centredLeft, true);
        }

        // ---- coverage bar: no "[ ... ]" bracket glyphs and no filled box (both tried at
        // different points, both removed again) -- just a thin 1px outline around the whole bar,
        // kept even at 0% coverage, so it always reads as a container/progress bar instead of
        // disappearing into the panel's own black background when nothing's been heard yet.
        auto barArea = coverageRect;
        g.setColour (col::grey);
        g.drawRect (barArea, 1);
        auto fillArea = barArea.reduced (1);

        // Each actually-heard sub-range of the loop is drawn at its own position, not collapsed
        // into one left-aligned fill -- so playing the first 5 s, jumping the cursor, then
        // playing the last 5 s shows exactly those two zones as heard, with the untouched
        // middle left visibly empty (black).
        greyRects.clear();
        for (auto& fr : coveredFractions)
        {
            const int x0 = (int) std::round (fr.first  * (double) fillArea.getWidth());
            const int x1 = (int) std::round (fr.second * (double) fillArea.getWidth());
            greyRects.add (fillArea.withX (fillArea.getX() + x0).withWidth (juce::jmax (1, x1 - x0)));
        }
        g.setColour (col::grey);
        g.fillRectList (greyRects);

        // Every label on the bar is drawn twice (see drawOverGrey): its normal colour off the grey
        // fill, black exactly where the grey heard zone sits under it.
        auto cvArea = barArea.reduced (6, 0);
        // Complete: just "heard", with the notation field right after it. Otherwise "heard N %",
        // rounded DOWN (and never 100 until it truly is) -- rounding to nearest used to show
        // "100 %" over a bar still visibly short of full.
        String cv = heardComplete ? String ("heard")
                                  : "heard " + String (juce::jmin (99, (int) std::floor (coverage * 100.0))) + " %";

        drawOverGrey (g, cv, cvArea, juce::Justification::centredLeft, col::white, greyRects);
        // Only while still listening -- once the loop's fully heard, "pos" is dropped entirely
        // (typing notation/tags is the point then, not tracking playback); see layoutNotation().
        if (! heardComplete)
            drawOverGrey (g, ringLabel(), posRect, juce::Justification::centredLeft, col::white, greyRects);
    }

    void CapturePanel::drawOverGrey (juce::Graphics& g, const String& txt, juce::Rectangle<int> area, juce::Justification j,
                                     juce::Colour offGrey, const juce::RectangleList<int>& grey) const
    {
        g.setFont (mono());
        g.saveState();
        for (auto& gr : grey) g.excludeClipRegion (gr);
        g.setColour (offGrey);
        g.drawText (txt, area, j, false);
        g.restoreState();

        if (grey.isEmpty()) return;
        g.saveState();
        g.reduceClipRegion (grey);
        g.setColour (col::bg);
        g.drawText (txt, area, j, false);
        g.restoreState();
    }

    void CapturePanel::paintOverChildren (juce::Graphics& g)
    {
        // The notation field's text (and its placeholder), drawn here rather than by the editor
        // itself so it can switch colour per-pixel with the grey heard fill underneath it.
        const auto nb = notation.getBounds();
        if (nb.isEmpty() || ! notation.isVisible()) return;

        // The text's own selection highlight is grey too -- black text over it, same as the fill.
        auto grey = greyRects;
        const auto sel = notation.getHighlightedRegion();
        if (! sel.isEmpty())
            for (auto r : notation.getTextBounds (sel))
                grey.add (r.translated (nb.getX(), nb.getY()));

        g.saveState();
        g.reduceClipRegion (nb);
        const String text = notation.getText();
        // Same vertical band as the "heard %" label (the whole bar), so both share one baseline.
        auto row = nb.withY (coverageRect.getY()).withHeight (coverageRect.getHeight());
        // Text that doesn't fit is cut with a tight "..." -- always for the placeholder, and for
        // typed text whenever the field isn't being edited (while editing, the editor scrolls the
        // text itself and the caret has to line up with it, so nothing is cut then).
        auto drawFitted = [&] (const String& full)
        {
            const int avail = row.getWidth();
            if (juce::GlyphArrangement::getStringWidthInt (mono(), full) <= avail)
            {
                drawOverGrey (g, full, row, juce::Justification::centredLeft, col::white, grey);
                return;
            }
            constexpr int dot = 2, dotGap = 2, dotsW = 3 * dot + 2 * dotGap;
            String cut = full;
            while (cut.isNotEmpty() && juce::GlyphArrangement::getStringWidthInt (mono(), cut) + 3 + dotsW > avail)
                cut = cut.dropLastCharacters (1);
            // never end on a dangling "#" (or the space before it)
            cut = cut.trimEnd();
            while (cut.endsWithChar ('#')) cut = cut.dropLastCharacters (1).trimEnd();
            drawOverGrey (g, cut, row, juce::Justification::centredLeft, col::white, grey);
            const int dx = row.getX() + juce::GlyphArrangement::getStringWidthInt (mono(), cut) + 3;
            const int baseY = row.getY() + (row.getHeight() + juce::roundToInt (mono().getAscent())) / 2 - dot;
            for (int d = 0; d < 3; ++d)
            {
                const juce::Rectangle<int> r (dx + d * (dot + dotGap), baseY, dot, dot);
                g.setColour (grey.intersectsRectangle (r) ? col::bg : col::white);
                g.fillRect (r);
            }
        };
        if (text.isEmpty())
        {
            drawFitted ("/ e.g. weird nosy rise #inharmonic #ascent");
        }
        else if (! notation.hasKeyboardFocus (true))
        {
            drawFitted (text);
        }
        else
        {
            // Follow the editor's own horizontal scroll: start where it lays out character 0.
            const int x0 = nb.getX() + notation.getCaretRectangleForCharIndex (0).getX();
            drawOverGrey (g, text, row.withLeft (x0).withWidth (juce::jmax (row.getWidth(), 100000)),
                          juce::Justification::centredLeft, col::white, grey);
        }
        g.restoreState();

        // The field's clear "X", at the far right after the position -- same split colour as everything on the bar.
        drawOverGrey (g, "X", clearRect, juce::Justification::centred, col::white, grey);
    }
}
