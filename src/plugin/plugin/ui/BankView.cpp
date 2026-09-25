#include "BankView.h"
#include "CapturePanel.h"
#include "NotationCard.h"
#include "../../core/Settings.h"
#include "../../core/Ids.h"
#include "../../core/JsonIo.h"
#include "Theme.h"
#include <vector>

namespace gnumbat::ui
{
    using juce::String;
    using juce::var;

    // Only the basic columns live in the table itself now -- ID, ANALYSIS, CREATOR, CREATED and
    // LAST EDITED all moved into the one-line detail strip under the table (see
    // BankView::paint()), shown for whichever row is currently selected instead of eating a
    // column's worth of width on every row all the time.
    enum Col { cVotes = 1, cNotation, cTags, cBpm, cDuration, cDelete };

    // vote glyphs -- same pair panel.html's own model-list vote arrows use (modelVotes .voteUp/.voteDown: "&#8593;"/"&#8595;")
    static const String kUpGlyph   (juce::CharPointer_UTF8 ("\xE2\x86\x91"));
    static const String kDownGlyph (juce::CharPointer_UTF8 ("\xE2\x86\x93"));

    BankView::BankView (AppModel& m, UiHost& h) : model (m), host (h), bar (m, h)
    {
        addAndMakeVisible (bar);
        auto& hd = table.getHeader();
        hd.addColumn ("", cVotes, 44, 40, 60, juce::TableHeaderComponent::notSortable);
        hd.addColumn ("NOTATION", cNotation, 160, 80, 400, juce::TableHeaderComponent::defaultFlags);
        hd.addColumn ("TAGS", cTags, 90, 50, 260, juce::TableHeaderComponent::defaultFlags);
        hd.addColumn ("BPM", cBpm, 46, 36, 70, juce::TableHeaderComponent::defaultFlags);
        {
            // Wide enough for the longest normal read-out ("99.9s / 99.9 bars") at its MINIMUM, so
            // the "bars" part is never the first thing the window cuts -- NOTATION/TAGS shrink first.
            const int durW = juce::GlyphArrangement::getStringWidthInt (mono(), "99.9s / 99.9 bars") + 10;
            hd.addColumn ("DURATION", cDuration, durW, durW, durW + 40, juce::TableHeaderComponent::defaultFlags);
        }
        // One fixed-width "X" per row, right after DURATION: click to trash that Bake (with the
        // same confirmation + undo as the Delete key -- see confirmTrash()).
        {
            const int xW = juce::GlyphArrangement::getStringWidthInt (mono(), "X") + 12;
            hd.addColumn ("", cDelete, xW, xW, xW, juce::TableHeaderComponent::notSortable | juce::TableHeaderComponent::notResizable);
        }
        // Stretch-to-fit: as the window is resized, every column grows/shrinks proportionally
        // to fill the table's actual width instead of staying pinned to the width given to
        // addColumn() above -- each column's own min/max there still bounds it. NOTATION, the
        // widest, absorbs most of the slack. Only when every column is already at its minimum
        // does the table fall back to horizontal scrolling -- a much smaller floor now that
        // there are only five columns instead of ten.
        hd.setStretchToFitActive (true);
        table.setHeaderHeight (18);
        table.setRowHeight (18);   // tightened -- as compact as still comfortably readable at this font size
        table.setMultipleSelectionEnabled (true);
        table.setColour (juce::ListBox::backgroundColourId, col::bg);
        addAndMakeVisible (table);
        playButton.setTooltip ("Play / stop the selected Bake's preview audio");
        playButton.onClick = [this] { togglePlay(); };
        playButton.setComponentID ("textLeft");
        playButton.setColour (juce::TextButton::textColourOffId, col::text);
        addAndMakeVisible (playButton);
        pipelineTicker.tick = [this] { repaint (detailRect); };
        inlineEdit.setFont (mono());
        inlineEdit.setMultiLine (false);
        inlineEdit.setReturnKeyStartsNewLine (false);
        inlineEdit.setJustification (juce::Justification::centredLeft);
        inlineEdit.setIndents (4, 0);
        inlineEdit.setTextToShowWhenEmpty ("e.g. weird nosy rise #inharmonic #ascent", col::bg);
        // the row it sits on is the selected (white) row: black text on white, like the row itself
        inlineEdit.setColour (juce::TextEditor::backgroundColourId, col::white);
        inlineEdit.setColour (juce::TextEditor::textColourId, col::bg);
        inlineEdit.setColour (juce::TextEditor::highlightColourId, col::grey);
        inlineEdit.setColour (juce::TextEditor::highlightedTextColourId, col::bg);
        inlineEdit.setColour (juce::TextEditor::outlineColourId, col::bg);
        inlineEdit.setColour (juce::TextEditor::focusedOutlineColourId, col::bg);
        inlineEdit.setColour (juce::CaretComponent::caretColourId, col::bg);
        inlineEdit.onReturnKey = [this] { finishInlineEdit (true); };
        inlineEdit.onEscapeKey = [this] { finishInlineEdit (false); };
        inlineEdit.onFocusLost = [this] { finishInlineEdit (true); };
        clickAway.onDown = [this] (const juce::MouseEvent& e)
        {
            // any click that isn't inside the field saves it ("clicking elsewhere")
            if (inlineId.isEmpty()) return;
            const auto p = e.getScreenPosition();
            if (! inlineEdit.getScreenBounds().contains (p))
                juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<BankView> (this)] { if (safe != nullptr) safe->finishInlineEdit (true); });
        };
        addChildComponent (inlineEdit);
        model.addChangeListener (this);
        changeListenerCallback (nullptr);
    }

    BankView::~BankView()
    {
        juce::Desktop::getInstance().removeGlobalMouseListener (&clickAway);
        stopTimer();
        pipelineTicker.stopTimer();
        if (playerReady)
        {
            transport.stop();
            sourcePlayer.setSource (nullptr);
            deviceManager.removeAudioCallback (&sourcePlayer);
            deviceManager.closeAudioDevice();
            transport.setSource (nullptr);
            readerSource.reset();
            playbackThread.stopThread (2000);
        }
        model.removeChangeListener (this);
    }

    void BankView::resized()
    {
        auto r = getLocalBounds();
        bar.setBounds (r.removeFromTop (bar.heightForWidth (r.getWidth())));
        r.removeFromTop (4);
        const bool hasSel = ! model.selection().isEmpty();
        // The detail strip and the play row only exist -- and only take up space -- once
        // something's actually selected. Nothing selected, the table just gets the whole
        // remaining height instead of either sitting there empty (this runs again from
        // changeListenerCallback() whenever the selection changes, so it never lags a click).
        // The detail strip is three stacked lines, not one long line squeezed onto a single
        // row: "created by / status / last edited" together can run well past 90 characters,
        // which was getting silently ellipsis-truncated -- cutting "status" and "last edited"
        // off the window entirely -- at any width narrower than a very wide one.
        // A fourth line -- the instrument pipeline's stage bars -- only for a Bake handed to EBYS.
        detailRect = hasSel ? r.removeFromBottom ((primaryHasPipeline() ? 4 : 3) * 14 + 2) : juce::Rectangle<int>();
        if (hasSel) r.removeFromBottom (6);
        // Same row height CapturePanel gives its own heard-bar/BAKE row (its "row" constant is
        // 15, +4 -- see CapturePanel::resized()), so the two panels' bottom rows line up.
        playRect = hasSel ? r.removeFromBottom (19) : juce::Rectangle<int>();
        if (hasSel) r.removeFromBottom (6);
        table.setBounds (r);
        // Same 10px side margin and 8px button/bar gap CapturePanel uses around BAKE and its
        // heard bar (see CapturePanel::resized()) -- this row is meant to read as the same kind
        // of control, just in the Bank instead of the capture panel.
        auto pr = playRect.reduced (10, 0);
        pr = pr.withTrimmedTop (2);   // sits 2px lower than the row's own top -- PLAY and the
                                       // waveform move together, so the two stay aligned with
                                       // each other rather than PLAY being left behind
        // Sized to its own label, not a fixed guess -- "STOP" and "PLAY" are close but not
        // identical widths, and a flat 24px was clipping the text against JUCE's own internal
        // button indent (drawButtonText's leftIndent/rightIndent eats a few more px on top of
        // whatever's given here). Same "+20" padding BAKE gives its own label for the same reason.
        // PLAY's text starts exactly on the 10 px left margin (drawn left-aligned, no internal
        // indent -- see the "textLeft" case in TerminalLookAndFeel::drawButtonText), and the
        // waveform starts exactly where the capture panel's notation field does, so the two rows
        // share one left edge for their content.
        const int playW = juce::jmax (juce::GlyphArrangement::getStringWidthInt (mono(), "PLAY"),
                                       juce::GlyphArrangement::getStringWidthInt (mono(), "STOP")) + 4;
        playButton.setBounds (pr.withWidth (playW));
        waveRect = pr.withLeft (juce::jmax (pr.getX() + playW + 8, CapturePanel::notationX()));
        playButton.setVisible (hasSel);
    }

    // "analyzed" / "queued" / etc, for the detail strip -- the same state values ANALYSIS used
    // to render as a column, just spelled out as a word instead of a compact per-row glyph.
    static String stateWord (const String& state)
    {
        if (state == "READY") return "analyzed";
        if (state == "ERROR") return "error";
        if (state == "DECOMPOSING") return "decomposing";
        if (state == "ANALYZING") return "analyzing";
        if (state == "CAPTURED") return "queued";
        return state.isEmpty() ? String ("--") : state.toLowerCase();
    }

    // Absolute date-timestamp, not a relative age -- "created"/"last edited" read the actual
    // moment, so two Bakes' order is legible without doing the subtraction from "5h" yourself.
    static String absoluteDate (juce::int64 whenMs)
    {
        if (whenMs <= 0) return "-";
        return juce::Time (whenMs).formatted ("%Y-%m-%d %H:%M:%S");
    }

    String BankView::dateText (const String& id) { return absoluteDate (ids::timeMs (id)); }
    static String dateTextIso (const String& iso) { return absoluteDate (json::parseUtc (iso)); }

    void BankView::paint (juce::Graphics& g)
    {
        g.fillAll (col::bg);
        // an empty library gets its one placeholder row (see paintCell) instead of this message --
        // this is only for "some Bakes exist, but none match the current search / filters".
        if (! model.rows().empty() && model.visible().empty())
        {
            g.setColour (col::dim);
            g.setFont (mono());
            auto area = table.getBounds().withTrimmedTop (30);
            drawWrapped (g, "No Bake matches the current search / filters.", area.reduced (30), juce::Justification::centredTop, 4);
        }

        if (! playRect.isEmpty())
        {
            // No outline any more -- the waveform itself (drawn below) is enough to read as its
            // own control without a box around it, same reasoning the rest of the UI gives every
            // other control ("no box, colour carries emphasis" -- see Theme.cpp).
            auto fillArea = waveRect;
            if (! waveformPeaks.empty() && fillArea.getWidth() > 0 && fillArea.getHeight() > 0)
            {
                const int w = fillArea.getWidth();
                const int n = (int) waveformPeaks.size();
                const int midY = fillArea.getCentreY();
                const float halfH = (float) fillArea.getHeight() * 0.5f;

                // One vertical line per pixel column, its top/bottom from that column's
                // [lo, hi] peak bin -- drawn twice, like the heard bar's own text-over-grey
                // trick (see CapturePanel::paint()): once in full across the whole bar, then
                // again in white but clipped to just the already-played portion, so the
                // waveform itself doubles as the progress readout instead of a separate rect.
                auto drawBars = [&]
                {
                    for (int x = 0; x < w; ++x)
                    {
                        const int bin = juce::jlimit (0, n - 1, x * n / w);
                        const auto pk = waveformPeaks[(size_t) bin];
                        const int y0 = midY - juce::roundToInt (juce::jlimit (-1.0f, 1.0f, pk.second) * halfH);
                        const int y1 = midY - juce::roundToInt (juce::jlimit (-1.0f, 1.0f, pk.first) * halfH);
                        g.drawVerticalLine (fillArea.getX() + x, (float) juce::jmin (y0, y1), (float) juce::jmax (y0, y1) + 1.0f);
                    }
                };

                g.setColour (col::grey);
                drawBars();

                if (transport.getTotalLength() > 0)
                {
                    const double frac = juce::jlimit (0.0, 1.0, transport.getCurrentPosition() / transport.getLengthInSeconds());
                    const int playedW = juce::roundToInt ((float) w * (float) frac);
                    if (playedW > 0)
                    {
                        g.saveState();
                        g.reduceClipRegion (fillArea.getX(), fillArea.getY(), playedW, fillArea.getHeight());
                        g.setColour (col::white);
                        drawBars();
                        g.restoreState();
                    }
                }
            }
        }

        if (! detailRect.isEmpty())
        {
            // model's own "primary" is whichever Bake was clicked/extended onto most recently --
            // the same one the table's own selectedRowsChanged() already tracks as the anchor.
            if (const auto* r = model.primary().isEmpty() ? nullptr : model.rowById (model.primary()))
            {
                const auto& v = r->view;
                const auto creator = json::getString (v, "creator");
                // Three separate lines, not one long semicolon-joined string -- the combined
                // text routinely ran past what any reasonably-sized window is wide enough to
                // show on one row, so the old single-line version was getting silently cut off
                // ("..." swallowing "status" and "last edited" whole) rather than staying
                // visible the way this information needs to be.
                const String line1 = "created by " + (creator.isEmpty() ? String ("unknown") : creator) + " on " + dateText (r->id);
                const auto pipeText = pipelineStatusText (v);
                String line2 = "status: " + (pipeText.isNotEmpty() ? pipeText : stateWord (json::getString (v, "state")));
                // the plugin's own worker reports a fraction while it decomposes / analyses
                if (pipeText.isEmpty() && json::has (v, "progress"))
                    line2 << " " << String (juce::roundToInt (json::getNumber (v, "progress") * 100.0)) << "%";
                const String line3 = "last edited on " + dateTextIso (json::getString (v, "updated_at"));
                g.setColour (col::dim);
                g.setFont (mono());
                // Same 10px side margin as the play row below it (see resized()'s `pr`) -- this
                // used to be a plain 4px, which left the waveform sitting 6px further right than
                // the text above it instead of lining up under it.
                auto area = detailRect.reduced (10, 1);
                constexpr int lineH = 14;
                g.drawText (line1, area.removeFromTop (lineH), juce::Justification::centredLeft, true);
                g.drawText (line2, area.removeFromTop (lineH), juce::Justification::centredLeft, true);
                if (json::getString (v, "handoff").isNotEmpty() && json::getString (v, "handoff") != "failed")
                    paintPipeline (g, area.removeFromTop (lineH), v);
                g.setColour (col::dim);
                g.drawText (line3, area.removeFromTop (lineH), juce::Justification::centredLeft, true);
            }
        }
    }

    bool BankView::primaryHasPipeline() const
    {
        const auto* r = model.primary().isEmpty() ? nullptr : model.rowById (model.primary());
        if (r == nullptr) return false;
        const auto h = json::getString (r->view, "handoff");
        return h.isNotEmpty() && h != "failed";
    }

    static const char* const kStages[] = { "demucs", "essentia", "madmom", "flucoma" };

    String BankView::pipelineStatusText (const juce::var& v)
    {
        // The first stage that isn't done yet, with its percentage, then the whole analysis as one
        // percentage (the four stages averaged): "madmom 50%  (62% total)", "flucoma waiting for Pd
        // (75% total)", "madmom error: code 1" -- "analyzed by EBYS" when all four are done, "" for
        // a Bake that wasn't handed to EBYS.
        if (! json::has (v, "pipeline"))
            return json::getBool (v, "pipeline_active") ? String ("sent to EBYS, waiting for the watcher") : String();
        const auto p = json::get (v, "pipeline");
        double sum = 0.0;
        String current;
        for (auto* st : kStages)
        {
            const auto status = json::getString (p, String (st) + "/status", "waiting");
            const auto msg = json::getString (p, String (st) + "/msg");
            const int pct = juce::jlimit (0, 100, juce::roundToInt (json::getNumber (p, String (st) + "/percent")));
            sum += status == "done" ? 100.0 : (double) pct;
            if (current.isNotEmpty()) continue;
            if (status == "error")   current = String (st) + " error" + (msg.isNotEmpty() ? ": " + msg : String());
            else if (status == "running") current = String (st) + " " + String (pct) + "%";
            else if (status == "waiting") current = String (st) + " " + (msg.isNotEmpty() ? msg : String ("waiting"));
        }
        if (current.isEmpty()) return "analyzed by EBYS";
        return current + "  (" + String (juce::roundToInt (sum / 4.0)) + "% total)";
    }

    void BankView::paintPipeline (juce::Graphics& g, juce::Rectangle<int> row, const juce::var& v)
    {
        // One labelled bar per stage, left to right: demucs, essentia, madmom, flucoma.
        //   waiting -> empty outline;  running -> white fill (by percent, or a moving segment when
        //   the stage reports no percent);  done -> solid grey;  error -> label white + "!".
        const auto p = json::get (v, "pipeline");
        g.setFont (mono());
        int labelsW = 0;
        for (auto* st : kStages) labelsW += juce::GlyphArrangement::getStringWidthInt (mono(), String (st) + "!") + 4;
        const int gap = 10;
        const int barW = juce::jlimit (12, 80, (row.getWidth() - labelsW - 3 * gap) / 4);
        const int barH = 6;
        int x = row.getX();
        const double phase = std::fmod ((double) juce::Time::getMillisecondCounter() / 900.0, 1.0);
        for (auto* st : kStages)
        {
            const auto status = json::getString (p, String (st) + "/status", "waiting");
            const double pct = juce::jlimit (0.0, 100.0, json::getNumber (p, String (st) + "/percent")) / 100.0;
            const bool err = status == "error";
            const String label = String (st) + (err ? "!" : "");
            g.setColour (err || status == "running" ? col::white : col::dim);
            const int lw = juce::GlyphArrangement::getStringWidthInt (mono(), label);
            g.drawText (label, x, row.getY(), lw + 2, row.getHeight(), juce::Justification::centredLeft, false);
            x += lw + 4;
            const juce::Rectangle<int> stageBar (x, row.getCentreY() - barH / 2, barW, barH);
            g.setColour (col::grey);
            g.drawRect (stageBar, 1);
            if (status == "done")
            {
                g.fillRect (stageBar);
            }
            else if (status == "running")
            {
                g.setColour (col::white);
                if (pct > 0.0)
                    g.fillRect (stageBar.withWidth (juce::jmax (1, juce::roundToInt (stageBar.getWidth() * pct))));
                else
                {
                    const int segW = juce::jmax (3, stageBar.getWidth() / 3);
                    const int sx = stageBar.getX() + juce::roundToInt ((stageBar.getWidth() - segW) * (0.5 - 0.5 * std::cos (phase * juce::MathConstants<double>::twoPi)));
                    g.fillRect (sx, stageBar.getY(), segW, stageBar.getHeight());
                }
            }
            else if (err && pct > 0.0)
            {
                g.fillRect (stageBar.withWidth (juce::roundToInt (stageBar.getWidth() * pct)));
            }
            x = stageBar.getRight() + gap;
        }
    }

    const BakeRow* BankView::rowAt (int row) const
    {
        const auto& v = model.visible();
        return row >= 0 && row < (int) v.size() ? &model.rows()[(size_t) v[(size_t) row]] : nullptr;
    }

    void BankView::ensurePlayerReady()
    {
        if (playerReady) return;
        formatManager.registerBasicFormats();
        playbackThread.startThread (juce::Thread::Priority::normal);
        deviceManager.initialiseWithDefaultDevices (0, 2);
        deviceManager.addAudioCallback (&sourcePlayer);
        sourcePlayer.setSource (&transport);
        playerReady = true;
    }

    void BankView::refreshWaveform (const String& id)
    {
        waveformForId = id;
        waveformPeaks.clear();
        if (id.isEmpty()) return;
        // Named, not chained straight off json::get()'s return -- getArray() hands back a
        // pointer into the var's own storage, and a var returned by value from a plain
        // `if (auto* x = expr.getArray())` is destroyed the instant it's initialised, before the
        // body runs, which would leave that pointer dangling.
        const var peaks = json::get (model.lib().readBake (id), "preview/peaks");
        if (auto* arr = peaks.getArray())
            for (auto& p : *arr)
                if (auto* pair = p.getArray(); pair != nullptr && pair->size() >= 2)
                    waveformPeaks.push_back ({ (float) (double) (*pair)[0], (float) (double) (*pair)[1] });
    }

    void BankView::loadForPlayback (const String& id)
    {
        transport.stop();
        transport.setSource (nullptr);
        readerSource.reset();
        playingId = id;
        if (id.isEmpty()) return;
        std::unique_ptr<juce::AudioFormatReader> reader (formatManager.createReaderFor (model.lib().previewAudioFile (id)));
        if (reader == nullptr) return;
        const double sr = reader->sampleRate;
        readerSource = std::make_unique<juce::AudioFormatReaderSource> (reader.release(), true);
        transport.setSource (readerSource.get(), 32768, &playbackThread, sr);
    }

    void BankView::stopPlayback()
    {
        transport.stop();
        transport.setPosition (0.0);                        // back to the start
        playButton.setButtonText ("PLAY");
        playButton.setColour (juce::TextButton::textColourOffId, col::text);   // grey again at rest
        stopTimer();
        repaint (playRect);
    }

    void BankView::togglePlay()
    {
        if (transport.isPlaying()) { stopPlayback(); return; }
        const auto id = model.primary();
        if (id.isEmpty()) return;
        ensurePlayerReady();
        if (id != playingId || readerSource == nullptr) loadForPlayback (id);
        if (readerSource == nullptr) { host.notify ("no audio to play for this Bake", true); return; }
        transport.setPosition (0.0);
        transport.start();
        playButton.setButtonText ("STOP");
        playButton.setColour (juce::TextButton::textColourOffId, col::white);  // lit white for as long as it plays
        startTimerHz (15);   // timerCallback() notices the end of the file and calls stopPlayback()
    }

    // Reaching the end on its own gets the same reset as pressing STOP -- ready to play again
    // from the top rather than sitting "finished" at the end of the bar.
    void BankView::timerCallback()
    {
        if (! transport.isPlaying()) { stopPlayback(); return; }
        repaint (playRect);
    }

    void BankView::changeListenerCallback (juce::ChangeBroadcaster*)
    {
        if (playingId.isNotEmpty() && playingId != model.primary()) stopPlayback();
        if (model.primary() != waveformForId) refreshWaveform (model.primary());
        table.updateContent();
        // mirror the model's selection into the table without echoing it back
        syncing = true;
        juce::SparseSet<int> sel;
        for (int i = 0; i < getNumRows(); ++i)
            if (auto* r = rowAt (i); r != nullptr && model.selection().contains (r->id)) sel.addRange ({ i, i + 1 });
        table.setSelectedRows (sel, juce::dontSendNotification);
        syncing = false;
        table.repaint();
        repaint();
        resized();
        if (inlineId.isNotEmpty()) positionInlineEdit();
        // keep the "running" bars moving while the selected Bake's pipeline is still going
        const auto* pr = model.primary().isEmpty() ? nullptr : model.rowById (model.primary());
        const bool animate = pr != nullptr && json::getBool (pr->view, "pipeline_active");
        if (animate && ! pipelineTicker.isTimerRunning()) pipelineTicker.startTimerHz (12);
        else if (! animate && pipelineTicker.isTimerRunning()) pipelineTicker.stopTimer();
    }

    void BankView::sortOrderChanged (int c, bool fwd)
    {
        static const std::map<int, const char*> keys { { cNotation, "notation" }, { cTags, "tags" }, { cBpm, "tempo" }, { cDuration, "length" } };
        if (auto it = keys.find (c); it != keys.end())
            model.setSort (it->second, fwd);
    }

    void BankView::selectedRowsChanged (int)
    {
        if (syncing) return;
        juce::StringArray ids;
        const auto sel = table.getSelectedRows();
        for (int i = 0; i < sel.size(); ++i) if (auto* r = rowAt (sel[i])) ids.add (r->id);
        String primary;
        if (auto* r = rowAt (table.getLastRowSelected())) primary = r->id;
        model.setSelection (ids, primary);
    }

    void BankView::backgroundClicked (const juce::MouseEvent&) { table.deselectAllRows(); }

    void BankView::paintRowBackground (juce::Graphics& g, int, int w, int h, bool selected)
    {
        // Selected rows now get an actual solid white highlight -- the one place in this table
        // that fills a background at all (an unselected row, or the map's own hover
        // cross-highlight, both still show entirely through paintCell()'s text colour, no fill).
        if (selected) { g.setColour (col::white); g.fillRect (0, 0, w, h); }
    }

    void BankView::paintCell (juce::Graphics& g, int row, int c, int w, int h, bool selected)
    {
        if (model.rows().empty())     // the one placeholder row getNumRows() reports when there are no Bakes yet
        {
            if (c == cDelete) return;
            g.setFont (mono());
            g.setColour (selected ? col::bg : col::dim);
            g.drawText (c == cNotation ? String ("no bakes") : String ("--"), 4, 0, w - 8, h,
                        c == cNotation ? juce::Justification::centredLeft : juce::Justification::centred, true);
            return;
        }
        const auto* r = rowAt (row);
        if (r == nullptr) return;
        const auto& v = r->view;
        const bool emphasised = selected || r->id == model.hover();   // selected here, or the same Bake is hovered on the map
        // A selected row now has a solid white background (see paintRowBackground), so every
        // colour used below has to flip to something legible on white instead of black -- the
        // same "swap for contrast" rule the heard bar's own text already follows.
        const juce::Colour emph  = selected ? col::bg   : col::white;
        const juce::Colour dim   = selected ? col::grey : col::dim;
        const juce::Colour text_ = selected ? col::bg   : col::text;
        g.setFont (mono());
        auto text = [&] (const String& s, juce::Colour colour, juce::Justification j = juce::Justification::centredLeft)
        {
            g.setColour (colour);
            g.drawText (s, 4, 0, w - 8, h, j, true);
        };
        switch (c)
        {
            case cVotes:
            {
                // left half upvotes, right half downvotes (see cellClicked). Each field is the
                // list of who voted that way (one slot per user -- see vote()), not a bare
                // counter; the count shown is just that list's length. Your own vote reads
                // emphasised, everyone else's dim.
                const auto ups = json::getStrings (v, "fields/votes_up"), downs = json::getStrings (v, "fields/votes_down");
                const auto me = Settings::localIdentity();
                // A tight pair, centred together, rather than each glyph centred in its own
                // half of the column -- that read as two unrelated readouts as far apart as
                // the column itself was wide.
                const String upText = kUpGlyph + String (ups.size()), downText = kDownGlyph + String (downs.size());
                const int upW = juce::GlyphArrangement::getStringWidthInt (mono(), upText);
                const int downW = juce::GlyphArrangement::getStringWidthInt (mono(), downText);
                constexpr int voteGap = 4;   // up and down read as one pair
                const int x0 = (w - (upW + voteGap + downW)) / 2;
                g.setColour (ups.contains (me) ? emph : dim);
                g.drawText (upText, x0, 0, upW, h, juce::Justification::centred);
                g.setColour (downs.contains (me) ? emph : dim);
                g.drawText (downText, x0 + upW + voteGap, 0, downW, h, juce::Justification::centred);
                break;
            }
            case cNotation:
            {
                auto n = NotationCard::withoutTags (json::getString (v, "notation"));   // #words show as TAGS chips instead
                text (n.isEmpty() ? String ("(no notation)") : n.replaceCharacter ('\n', ' '), n.isEmpty() ? dim : (emphasised ? emph : text_));
                break;
            }
            case cTags:
            {
                // Three groups, left to right in one row: ordinary tags, then spectral tags,
                // then morphology tags -- Denis Smalley's spectromorphology, splitting "what the
                // spectrum looks like" from "how it moves through the Bake's duration" (see
                // promptAddSpectralTag()/promptAddMorphologyTag()). Each is a real drawn box
                // around its own text, not "[TECHNO]" bracket characters folded into one string;
                // the two spectromorphology groups are introduced by their own small dim label
                // (unboxed -- a label, not a chip) so the three stay visibly distinct rather than
                // reading as one longer undifferentiated list. Items are laid out left to right
                // and simply stop -- with a "..." -- once the next one wouldn't fully fit.
                g.setFont (mono());
                int x = 4;
                const int right = w - 4;
                // "..." drawn as three tight dots (2 px squares, 2 px apart) sitting on the text
                // baseline -- in this monospace font both "..." and the single ellipsis glyph spread
                // their dots across whole character cells and read as loose, far-apart dots.
                constexpr int dot = 2, dotGap = 2;
                const int moreW = 3 * dot + 2 * dotGap;
                auto drawMore = [&] (int atX)
                {
                    const int baseY = (h + juce::roundToInt (mono().getAscent())) / 2 - dot;
                    g.setColour (text_);
                    for (int d = 0; d < 3; ++d) g.fillRect (atX + d * (dot + dotGap), baseY, dot, dot);
                };

                struct Item { juce::String text; bool isLabel; };
                std::vector<Item> items;
                for (auto& t : json::getStrings (v, "tags")) items.push_back ({ t.toUpperCase(), false });
                const auto specTags = json::getStrings (v, "spectral_tags");
                const auto morphTags = json::getStrings (v, "morphology_tags");
                if (! specTags.isEmpty())
                {
                    items.push_back ({ "SPEC", true });
                    for (auto& t : specTags) items.push_back ({ t.toUpperCase(), false });
                }
                if (! morphTags.isEmpty())
                {
                    items.push_back ({ "MORPH", true });
                    for (auto& t : morphTags) items.push_back ({ t.toUpperCase(), false });
                }

                bool truncated = false;
                for (size_t ii = 0; ii < items.size(); ++ii)
                {
                    const auto& it = items[ii];
                    const int textW = juce::GlyphArrangement::getStringWidthInt (mono(), it.text);
                    const int itemW = it.isLabel ? textW : textW + 8;   // labels are plain text; chips get 4px padding either side, inside the box
                    const bool last = ii == items.size() - 1;
                    // An item only goes in if it fits -- and, when more items follow it, still
                    // leaves room for the "..." that says some were cut off by the window.
                    if (x + itemW + (last ? 0 : 4 + moreW) > right) { truncated = true; break; }
                    if (it.isLabel)
                    {
                        g.setColour (dim);
                        g.drawText (it.text, x, 0, textW, h, juce::Justification::centredLeft, false);
                    }
                    else
                    {
                        const juce::Rectangle<int> chip (x, 2, itemW, h - 4);
                        g.setColour (dim);
                        g.drawRect (chip, 1);
                        g.setColour (text_);
                        g.drawText (it.text, chip, juce::Justification::centred, true);
                    }
                    x += itemW + 4;   // gap after this item
                }
                if (truncated && x + moreW <= w) drawMore (x);
                break;
            }
            // confidence, not category: a value read from the notation is ordinary text; an
            // estimate is dimmer -- the grayscale ramp carries the distinction, not a hue
            case cBpm: text (AppModel::tempoText (v), json::isNumber (json::get (v, "fields/tempo")) ? text_ : dim); break;
            case cDuration:
            {
                // Seconds is the ground truth (what's actually in the ring/Bake); bars is a
                // derived read-out for musical context, using the same tempo resolution order as
                // the BPM column (AppModel::tempoValue: typed/notation, then host capture, then
                // worker estimate) and the Bake's own captured time signature, defaulting to 4/4
                // when none was captured -- same fallback CapturePanel::beatsPerBar uses.
                const double secs = json::getNumber (v, "duration_s");
                const double bpm = AppModel::tempoValue (v);
                String s = String (secs, 1) + "s";
                if (bpm > 0.0)
                {
                    const auto ts = json::get (v, "capture/time_signature");
                    const double beatsPerBar = ts.getArray() != nullptr && ts.getArray()->size() >= 2 && (double) ts[1] > 0.0
                                                ? (double) ts[0] * 4.0 / (double) ts[1] : 4.0;
                    s << " / " << String (secs / ((60.0 / bpm) * beatsPerBar), 1) << " bars";
                }
                text (s, text_);
                break;
            }
            case cDelete:
            {
                // Centred exactly under the search bar's own clear "X" (not merely in this column),
                // whatever the window width: both positions come from the live layout.
                auto& hd = table.getHeader();
                const int colX = table.getX() + hd.getColumnPosition (hd.getIndexOfColumnId (cDelete, true)).getX()
                               - table.getViewport()->getViewPositionX();
                const int cx = bar.getX() + bar.clearCentreX() - colX;
                g.setColour (text_);
                g.drawText ("X", cx - 20, 0, 40, h, juce::Justification::centred, false);
                break;
            }
            default: break;
        }
    }

    String BankView::getCellTooltip (int row, int c)
    {
        const auto* r = rowAt (row);
        if (r == nullptr) return {};
        const auto& v = r->view;
        // Same reason as NOTATION's tooltip above: the cell itself (paintCell) draws each item
        // as its own boxed chip (or, for the two spectromorphology group labels, plain dim text)
        // and simply stops once the next one wouldn't fit, so hovering has to be able to show the
        // untruncated list -- a native tooltip can't draw boxes, so this falls back to bracketed
        // "[TAG1] [TAG2] ..." text, grouped the same way the cell itself is (ordinary tags, then
        // "SPEC ..." for spectral tags, then "MORPH ..." for morphology tags).
        if (c == cNotation) return json::getString (v, "notation");
        if (c == cTags)
        {
            auto boxedOf = [] (const juce::StringArray& in) { juce::StringArray b; for (auto& tg : in) b.add ("[" + tg.toUpperCase() + "]"); return b; };
            juce::StringArray parts (boxedOf (json::getStrings (v, "tags")));
            if (auto spec = json::getStrings (v, "spectral_tags"); ! spec.isEmpty()) { parts.add ("SPEC"); parts.addArray (boxedOf (spec)); }
            if (auto morph = json::getStrings (v, "morphology_tags"); ! morph.isEmpty()) { parts.add ("MORPH"); parts.addArray (boxedOf (morph)); }
            return parts.isEmpty() ? String() : parts.joinIntoString (" ");
        }
        if (c == cVotes) return "click left to upvote, right to downvote -- click your own vote again to remove it";
        if (c == cDelete) return "delete this Bake (you can undo)";
        if (c == cBpm) return json::isNumber (json::get (v, "fields/tempo")) ? "from notation / user" : "~ estimated (host or analysis)";
        return {};
    }

    var BankView::getDragSourceDescription (const juce::SparseSet<int>& rows)
    {
        juce::Array<var> ids;
        for (int i = 0; i < rows.size(); ++i) if (auto* r = rowAt (rows[i])) ids.add (r->id);
        return ids.isEmpty() ? var() : json::object ({ { "kind", "bakes" }, { "ids", var (ids) } });
    }

    void BankView::vote (const String& id, bool up)
    {
        const auto* r = model.rowById (id);
        if (r == nullptr) return;
        // One vote slot per user, tracked by who (not just how many): clicking your own side
        // again clears it, clicking the other side moves you there -- never both at once.
        const auto me = Settings::localIdentity();
        auto ups = json::getStrings (r->view, "fields/votes_up");
        auto downs = json::getStrings (r->view, "fields/votes_down");
        auto& mine = up ? ups : downs;
        auto& other = up ? downs : ups;
        if (mine.contains (me)) mine.removeString (me);
        else { mine.addIfNotAlreadyThere (me); other.removeString (me); }
        SemanticEdit e;
        e.setFields = json::object ({ { "votes_up", json::array (ups) }, { "votes_down", json::array (downs) } });
        if (auto err = model.editSemantic ({ id }, e); err.isNotEmpty()) host.notify (err, true);
    }

    void BankView::cellClicked (int row, int col, const juce::MouseEvent& e)
    {
        if (col == cDelete && ! e.mods.isPopupMenu())
        {
            if (auto* r = rowAt (row)) confirmTrash (model, host, { r->id });
            return;
        }
        if (col == cVotes && ! e.mods.isPopupMenu())
        {
            if (auto* r = rowAt (row))
                vote (r->id, e.getPosition().x < table.getHeader().getColumnWidth (cVotes) / 2);
            return;
        }
        if (! e.mods.isPopupMenu()) return;
        if (! table.isRowSelected (row)) table.selectRow (row);
        showContextMenu (model, host, &table, model.selection());
    }

    void BankView::cellDoubleClicked (int row, int col, const juce::MouseEvent&)
    {
        if (col == cVotes || col == cDelete) return;   // those cells are buttons
        if (auto* r = rowAt (row)) beginInlineEdit (r->id);
    }

    void BankView::positionInlineEdit()
    {
        // Over the NOTATION + TAGS cells of the Bake's row (wherever that row is right now).
        int rowIdx = -1;
        for (int i = 0; i < getNumRows(); ++i) if (auto* r = rowAt (i); r != nullptr && r->id == inlineId) { rowIdx = i; break; }
        if (rowIdx < 0) { finishInlineEdit (false); return; }
        auto& hd = table.getHeader();
        const auto rowR = table.getRowPosition (rowIdx, true);
        const auto notR = hd.getColumnPosition (hd.getIndexOfColumnId (cNotation, true));
        const auto tagR = hd.getColumnPosition (hd.getIndexOfColumnId (cTags, true));
        const int x0 = table.getX() + notR.getX() - table.getViewport()->getViewPositionX();
        const int x1 = table.getX() + tagR.getRight() - table.getViewport()->getViewPositionX();
        inlineEdit.setBounds (x0, table.getY() + rowR.getY(), juce::jmax (40, x1 - x0), rowR.getHeight());
    }

    void BankView::beginInlineEdit (const String& id)
    {
        const auto* row = model.rowById (id);
        if (row == nullptr) return;
        if (inlineId.isNotEmpty()) finishInlineEdit (true);
        // "notation #tag #tag" -- tags already written as #words in the notation aren't repeated
        auto text = json::getString (row->view, "notation");
        for (auto& t : json::getStrings (row->view, "tags"))
            if (! NotationCard::parseTags (text).contains (t, true))
                text << (text.isEmpty() ? "" : " ") << "#" << t.replaceCharacter (' ', '-');
        inlineId = id;
        inlineOriginal = text;
        inlineEdit.setText (text, false);
        positionInlineEdit();
        inlineEdit.setVisible (true);
        inlineEdit.toFront (true);
        inlineEdit.grabKeyboardFocus();
        // Starts at the beginning of the notation/tags, not the end -- editing what's already
        // there (a typo up front, an early word) shouldn't need an extra Home keypress first.
        inlineEdit.setCaretPosition (0);
        juce::Desktop::getInstance().addGlobalMouseListener (&clickAway);
    }

    void BankView::finishInlineEdit (bool save)
    {
        if (inlineId.isEmpty()) return;
        juce::Desktop::getInstance().removeGlobalMouseListener (&clickAway);
        const auto id = inlineId;
        const auto text = inlineEdit.getText();
        inlineId = {};
        inlineEdit.setVisible (false);
        if (save && text != inlineOriginal)
        {
            SemanticEdit e;
            e.setRawNotation = true; e.rawNotation = text;                 // verbatim, #words included
            e.setTags = true;        e.tags = NotationCard::parseTags (text);
            if (auto err = model.editSemantic ({ id }, e); err.isNotEmpty()) host.notify (err, true);
        }
        focusTable();
    }

    bool BankView::keyPressed (const juce::KeyPress& k)
    {
        const auto& sel = model.selection();
        if ((k == juce::KeyPress::deleteKey || k == juce::KeyPress::backspaceKey) && ! sel.isEmpty()) { confirmTrash (model, host, sel); return true; }
        if (k == juce::KeyPress ('z', juce::ModifierKeys::commandModifier, 0) && model.canUndoTrash()) { model.undoTrash(); return true; }
        if (k == juce::KeyPress ('f', juce::ModifierKeys::commandModifier, 0) || k == juce::KeyPress ('/')) { bar.focusSearch(); return true; }
        // (Return is NOT handled here: it falls through to the editor, where Enter = BAKE. Edit a
        // Bake's notation with double-click or the right-click menu.)
        return false;
    }

    // ---- shared actions ------------------------------------------------------------------------------------------
    void BankView::promptEditNotation (AppModel& m, UiHost& host, const String& id)
    {
        // One field, same form as when baking: "weird nosy rise #inharmonic #ascent". The text is
        // kept verbatim (old text stays in the Bake's history); its #words become the tag list.
        const auto* row = m.rowById (id);
        if (row == nullptr) return;
        auto cur = json::getString (row->view, "notation");
        for (auto& t : json::getStrings (row->view, "tags"))     // tags not already written as #words in it
            if (! NotationCard::parseTags (cur).contains (t, true))
                cur << (cur.isEmpty() ? "" : " ") << "#" << t.replaceCharacter (' ', '-');
        host.prompt ("Edit notation", "#words become tags   " + ids::shortId (id),
                     juce::Array<PromptField> { PromptField { "NOTATION", cur, "e.g. weird nosy rise #inharmonic #ascent", true } },
                     "SAVE", [&m, &host, id] (juce::StringArray v)
        {
            SemanticEdit e;
            e.setRawNotation = true; e.rawNotation = v[0];
            e.setTags = true;        e.tags = NotationCard::parseTags (v[0]);
            if (auto err = m.editSemantic ({ id }, e); err.isNotEmpty()) host.notify (err, true);
        });
    }

    void BankView::promptAddTag (AppModel& m, UiHost& host, const juce::StringArray& ids_)
    {
        host.prompt ("Add tag", String (ids_.size()) + " Bake" + (ids_.size() == 1 ? "" : "s") + " - write each tag as a #word",
                     { { "TAGS", "", "e.g. #convergence #ascent #inharmonic", false } }, "ADD", [&m, &host, ids_] (juce::StringArray v)
        {
            SemanticEdit e;
            e.addTags = NotationCard::parseTags (v[0].containsChar ('#') ? v[0] : "#" + v[0].trim().replace (" ", " #"));
            if (e.addTags.isEmpty()) return;
            if (auto err = m.editSemantic (ids_, e); err.isNotEmpty()) host.notify (err, true);
        });
    }

    // Spectromorphology (Denis Smalley, "Spectromorphology: Explaining Sound-Shapes", 1997):
    // spectral tags describe the spectrum itself, frozen -- roughly Smalley's note/harmonic/
    // inharmonic/noise continuum, plus how dense or wide it is. The hint text below is that
    // vocabulary offered as EXAMPLES only, the same way "e.g. #convergence #ascent #inharmonic" above
    // is a suggestion, not a checklist -- parseTags() takes whatever words are actually typed,
    // in whatever language, same as an ordinary tag.
    void BankView::promptAddSpectralTag (AppModel& m, UiHost& host, const juce::StringArray& ids_)
    {
        host.prompt ("Add spectrum tag", String (ids_.size()) + " Bake" + (ids_.size() == 1 ? "" : "s") + " - the spectrum's own shape, not how it moves. Write each tag as a #word.",
                     { { "SPECTRUM", "", "e.g. #note #harmonic #inharmonic #noise #dense #sparse", false } }, "ADD", [&m, &host, ids_] (juce::StringArray v)
        {
            SemanticEdit e;
            e.addSpectralTags = NotationCard::parseTags (v[0].containsChar ('#') ? v[0] : "#" + v[0].trim().replace (" ", " #"));
            if (e.addSpectralTags.isEmpty()) return;
            if (auto err = m.editSemantic (ids_, e); err.isNotEmpty()) host.notify (err, true);
        });
    }

    // Morphology tags describe how that spectrum moves/evolves over the Bake's own duration --
    // Smalley's onset-continuant-termination archetypes and motion typology (attack, dilation,
    // ascent...), again offered only as example vocabulary, never enforced.
    void BankView::promptAddMorphologyTag (AppModel& m, UiHost& host, const juce::StringArray& ids_)
    {
        host.prompt ("Add morphology tag", String (ids_.size()) + " Bake" + (ids_.size() == 1 ? "" : "s") + " - how the spectrum moves/evolves over time. Write each tag as a #word.",
                     { { "MORPHOLOGY", "", "e.g. #attack #graduated #ascending #descending #oscillating #dilating #contracting #iterative", false } }, "ADD", [&m, &host, ids_] (juce::StringArray v)
        {
            SemanticEdit e;
            e.addMorphologyTags = NotationCard::parseTags (v[0].containsChar ('#') ? v[0] : "#" + v[0].trim().replace (" ", " #"));
            if (e.addMorphologyTags.isEmpty()) return;
            if (auto err = m.editSemantic (ids_, e); err.isNotEmpty()) host.notify (err, true);
        });
    }

    void BankView::promptAddGroup (AppModel& m, UiHost& host, const juce::StringArray& ids_)
    {
        host.prompt ("Add to group", "Groups are just names you choose - a Bake can be in several.",
                     { { "GROUP", "", "e.g. risers", false } }, "ADD", [&m, &host, ids_] (juce::StringArray v)
        {
            SemanticEdit e;
            if (v[0].trim().isEmpty()) return;
            e.addGroups.add (v[0].trim());
            if (auto err = m.editSemantic (ids_, e); err.isNotEmpty()) host.notify (err, true);
        });
    }

    void BankView::promptSetField (AppModel& m, UiHost& host, const juce::StringArray& ids_)
    {
        host.prompt ("Set field", "Your own structured value on " + String (ids_.size()) + " Bake(s). Numbers are stored as numbers.",
                     juce::Array<PromptField> { PromptField { "NAME", "", "e.g. density_class", false }, PromptField { "VALUE", "", "empty = remove the field", false } }, "SET", [&m, &host, ids_] (juce::StringArray v)
        {
            const auto name = v[0].trim(), val = v[1].trim();
            if (name.isEmpty() || name.containsChar ('/') || name.length() > 64) { host.notify ("field names must be 1-64 characters and cannot contain '/'", true); return; }
            SemanticEdit e;
            if (val.isEmpty()) e.removeFields.add (name);
            else
            {
                var x = val;
                if (val.containsOnly ("0123456789.-+") && val.containsAnyOf ("0123456789")) x = val.getDoubleValue();
                else if (val.equalsIgnoreCase ("true")) x = true;
                else if (val.equalsIgnoreCase ("false")) x = false;
                e.setFields = json::object ({ { name.toRawUTF8(), x } });
            }
            if (auto err = m.editSemantic (ids_, e); err.isNotEmpty()) host.notify (err, true);
        });
    }

    void BankView::promptDatasetMenu (AppModel& m, UiHost& host, juce::Component* target, const juce::StringArray& ids_)
    {
        juce::PopupMenu menu;
        const auto sets = m.snapshot().datasets;
        for (int i = 0; i < sets.size(); ++i) menu.addItem (100 + i, sets[i].name + "  (" + String (sets[i].members) + ")");
        if (! sets.isEmpty()) menu.addSeparator();
        menu.addItem (1, "New dataset...");
        menu.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (target), [&m, &host, ids_, sets] (int r)
        {
            if (r == 1)
                host.prompt ("New dataset", "A dataset is a named working set of Bakes. Training uses immutable versions of it.",
                             { { "NAME", "", "e.g. risers v1", false } }, "CREATE", [&m, &host, ids_] (juce::StringArray v)
                {
                    if (auto err = m.createDatasetWith (v[0], ids_); err.isNotEmpty()) host.notify (err, true);
                });
            else if (r >= 100 && r - 100 < sets.size())
                if (auto err = m.addToDataset (sets[r - 100].id, ids_); err.isNotEmpty()) host.notify (err, true);
        });
    }

    void BankView::confirmTrash (AppModel& m, UiHost& host, const juce::StringArray& ids_)
    {
        const auto pinned = m.lib().bakesPinnedByDatasetVersions();
        int nPinned = 0;
        for (auto& id : ids_) if (pinned.count (id)) ++nPinned;
        String msg = "Move " + String (ids_.size()) + " Bake" + (ids_.size() == 1 ? "" : "s") + " to the library's .trash folder? You can undo this with Ctrl/Cmd+Z during this session.";
        if (nPinned > 0)
            msg << "\n\nWARNING: " << nPinned << " of them are pinned by dataset versions. Removing them means those versions can no longer be exported or retrained exactly.";
        host.confirm ("Delete Bakes", msg, "DELETE", [&m, &host, ids_]
        {
            if (auto err = m.trash (ids_); err.isNotEmpty()) host.notify (err, true);
        }, true);
    }

    void BankView::showContextMenu (AppModel& m, UiHost& host, juce::Component* target, const juce::StringArray& ids_)
    {
        if (ids_.isEmpty()) return;
        const bool one = ids_.size() == 1;
        juce::PopupMenu menu;
        menu.addSectionHeader (one ? ids::shortId (ids_[0]) : String (ids_.size()) + " Bakes");
        if (one) menu.addItem (1, "Edit notation...");
        menu.addItem (2, "Add tag...");
        juce::PopupMenu rm;
        juce::StringArray tags;
        for (auto& id : ids_) if (auto* r = m.rowById (id)) for (auto& t : json::getStrings (r->view, "tags")) if (! tags.contains (t, true)) tags.add (t);
        for (int i = 0; i < tags.size() && i < 40; ++i) rm.addItem (1000 + i, tags[i]);
        menu.addSubMenu ("Remove tag", rm, ! tags.isEmpty());
        // Spectromorphology: same add/remove shape as the plain tag above, just its own two
        // free categories -- see promptAddSpectralTag()/promptAddMorphologyTag().
        menu.addItem (10, "Add spectrum tag...");
        juce::PopupMenu rSpec;
        juce::StringArray specTags;
        for (auto& id : ids_) if (auto* r = m.rowById (id)) for (auto& t : json::getStrings (r->view, "spectral_tags")) if (! specTags.contains (t, true)) specTags.add (t);
        for (int i = 0; i < specTags.size() && i < 40; ++i) rSpec.addItem (5000 + i, specTags[i]);
        menu.addSubMenu ("Remove spectrum tag", rSpec, ! specTags.isEmpty());
        menu.addItem (11, "Add morphology tag...");
        juce::PopupMenu rMorph;
        juce::StringArray morphTags;
        for (auto& id : ids_) if (auto* r = m.rowById (id)) for (auto& t : json::getStrings (r->view, "morphology_tags")) if (! morphTags.contains (t, true)) morphTags.add (t);
        for (int i = 0; i < morphTags.size() && i < 40; ++i) rMorph.addItem (6000 + i, morphTags[i]);
        menu.addSubMenu ("Remove morphology tag", rMorph, ! morphTags.isEmpty());
        menu.addItem (3, "Set field...");
        menu.addItem (4, "Add to group...");
        menu.addSeparator();
        menu.addItem (5, "Add to dataset (-> models)...");
        juce::PopupMenu rd;
        juce::StringArray dsNames;
        for (auto& id : ids_) if (auto* r = m.rowById (id)) for (auto& d : json::getStrings (r->view, "datasets")) if (! dsNames.contains (d)) dsNames.add (d);
        for (int i = 0; i < dsNames.size(); ++i) rd.addItem (2000 + i, dsNames[i]);
        menu.addSubMenu ("Remove from dataset", rd, ! dsNames.isEmpty());
        menu.addSeparator();
        juce::PopupMenu rel;
        rel.addItem (3001, "same dataset");  rel.addItem (3002, "same model");  rel.addItem (3003, "same group");  rel.addItem (3004, "sharing a tag");
        menu.addSubMenu ("Select related", rel, one);
        juce::PopupMenu rp;
        rp.addItem (4001, "everything (stems + analysis)");  rp.addItem (4002, "stems only");  rp.addItem (4003, "analysis only");
        menu.addSubMenu ("Reprocess", rp);
        menu.addSeparator();
        if (one) menu.addItem (6, "Reveal in file manager");
        menu.addItem (7, "Copy id");
        menu.addItem (8, "Delete...");
        menu.addItem (9, "Undo delete", m.canUndoTrash());

        menu.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (target), [&m, &host, target, ids_, tags, specTags, morphTags, dsNames] (int r)
        {
            if (r == 1) promptEditNotation (m, host, ids_[0]);
            else if (r == 2) promptAddTag (m, host, ids_);
            else if (r == 3) promptSetField (m, host, ids_);
            else if (r == 4) promptAddGroup (m, host, ids_);
            else if (r == 5) promptDatasetMenu (m, host, target, ids_);
            else if (r == 6) m.lib().bakeDir (ids_[0]).revealToUser();
            else if (r == 7) juce::SystemClipboard::copyTextToClipboard (ids_.joinIntoString ("\n"));
            else if (r == 8) confirmTrash (m, host, ids_);
            else if (r == 9) m.undoTrash();
            else if (r == 10) promptAddSpectralTag (m, host, ids_);
            else if (r == 11) promptAddMorphologyTag (m, host, ids_);
            else if (r >= 1000 && r < 2000)
            {
                SemanticEdit e; e.removeTags.add (tags[r - 1000]);
                if (auto err = m.editSemantic (ids_, e); err.isNotEmpty()) host.notify (err, true);
            }
            else if (r >= 5000 && r < 6000)
            {
                SemanticEdit e; e.removeSpectralTags.add (specTags[r - 5000]);
                if (auto err = m.editSemantic (ids_, e); err.isNotEmpty()) host.notify (err, true);
            }
            else if (r >= 6000 && r < 7000)
            {
                SemanticEdit e; e.removeMorphologyTags.add (morphTags[r - 6000]);
                if (auto err = m.editSemantic (ids_, e); err.isNotEmpty()) host.notify (err, true);
            }
            else if (r >= 2000 && r < 3000)
            {
                for (auto& d : m.snapshot().datasets) if (d.name == dsNames[r - 2000]) { m.removeFromDataset (d.id, ids_); break; }
            }
            else if (r >= 3001 && r <= 3004)
            {
                const char* kinds[] = { "dataset", "model", "group", "tag" };
                auto related = m.relatedIds (kinds[r - 3001], ids_[0]);
                m.setSelection (related, ids_[0]);
                host.notify (String (related.size()) + " related Bakes selected");
            }
            else if (r >= 4001 && r <= 4003)
            {
                if (auto err = m.reprocess (ids_, r == 4001 ? "all" : r == 4002 ? "decompose" : "analyze"); err.isNotEmpty()) host.notify (err, true);
            }
        });
    }
}
