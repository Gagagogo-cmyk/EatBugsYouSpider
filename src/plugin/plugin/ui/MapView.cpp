#include "MapView.h"
#include "BankView.h"
#include "Theme.h"
#include "../../core/JsonIo.h"
#include "../../core/Ids.h"

namespace gnumbat::ui
{
    using juce::String;
    using juce::var;

    // No hue anywhere, and no ramp either -- flat levels only, hard edges between them. This
    // mirrors panel.html's own t-SNE plot, which colours every dot the same mid-grey and marks
    // only the one that matters (.dot.live) brighter and bigger, rather than giving each category
    // its own shade. Every non-"state" category renders as the same plain grey dot; only "colour
    // by state" gets real colour (green/white/grey, from forState -- it's a 3-way signal, not a
    // category list, so it already fits the palette). The legend still spells out labels in text
    // either way.
    static juce::Colour gradient (double t)      // grey -> white: an ordering, not a category --
                                                  // posterized to three flat bands (a fixed
                                                  // midpoint tone, not a continuous ramp), same as
                                                  // every other value in this UI: hard cutoffs, no
                                                  // per-pixel blend.
    {
        static const juce::Colour mid = col::grey.interpolatedWith (col::white, 0.5f);
        t = juce::jlimit (0.0, 1.0, t);
        if (t < 1.0 / 3.0) return col::grey;
        if (t < 2.0 / 3.0) return mid;
        return col::white;
    }

    MapView::MapView (AppModel& m, UiHost& h) : model (m), host (h)
    {
        for (auto* b : { &spaceBox, &methodBox, &colourBox }) addAndMakeVisible (b);
        addAndMakeVisible (computeButton);
        addAndMakeVisible (fitButton);
        spaceBox.onChange = [this] { model.setMapSpace (spaceBox.getSelectedId() >= 1 ? spaceBox.getText().upToFirstOccurrenceOf ("  ", false, false) : String()); };
        colourBox.onChange = [this] { refreshColourRange(); repaint(); };
        computeButton.onClick = [this]
        {
            const int idx = spaceBox.getSelectedItemIndex();
            const auto& fs = model.snapshot().featureSets;
            const String id = idx >= 0 && idx < fs.size() ? fs[idx].id : model.mapSpace();
            if (auto err = model.computeMap (id, methodBox.getText()); err.isNotEmpty()) host.notify (err, true);
            else host.notify ("projecting '" + id + "' with " + methodBox.getText() + " ...");
        };
        computeButton.setTooltip ("Ask the worker to (re)compute this projection. Heavy maths never runs in the DAW.");
        fitButton.onClick = [this] { fitView(); repaint(); };
        setWantsKeyboardFocus (true);
        model.addChangeListener (this);
        rebuildControls();
    }

    MapView::~MapView() { model.removeChangeListener (this); }

    void MapView::changeListenerCallback (juce::ChangeBroadcaster*)
    {
        rebuildControls();
        rebuildPositions();
        repaint();
    }

    void MapView::rebuildControls()
    {
        // feature spaces come from the library (extensible: whatever feature sets exist on disk)
        const auto& snap = model.snapshot();
        const int n = snap.featureSets.size();
        if (spaceBox.getNumItems() != n || (n > 0 && ! spaceBox.getText().startsWith (model.mapSpace())))
        {
            spaceBox.clear (juce::dontSendNotification);
            int sel = 0;
            for (int i = 0; i < n; ++i)
            {
                const bool has = snap.mapSpaces.contains (snap.featureSets[i].id);
                spaceBox.addItem (snap.featureSets[i].id + "  " + (has ? "" : "(no map yet)"), i + 1);
                if (snap.featureSets[i].id == model.mapSpace()) sel = i + 1;
            }
            if (n == 0) { spaceBox.addItem (model.mapSpace() + "  (worker not started yet)", 1); sel = 1; }
            spaceBox.setSelectedId (sel > 0 ? sel : 1, juce::dontSendNotification);
        }

        // projection methods = what the worker says it can do (tsne/pca now, umap when someone adds it)
        auto methods = snap.worker.projectors;
        if (methods.isEmpty()) methods = { "tsne", "pca" };
        bool same = methodBox.getNumItems() == methods.size();
        for (int i = 0; same && i < methods.size(); ++i) same = methodBox.getItemText (i) == methods[i];
        if (! same)
        {
            const auto prev = methodBox.getText();
            methodBox.clear (juce::dontSendNotification);
            for (int i = 0; i < methods.size(); ++i) methodBox.addItem (methods[i], i + 1);
            const int keep = methods.indexOf (prev);
            methodBox.setSelectedItemIndex (keep >= 0 ? keep : 0, juce::dontSendNotification);
        }

        // colour-by options from what is actually in the library
        if ((int) model.rows().size() != lastRows || colourBox.getNumItems() == 0)
        {
            lastRows = (int) model.rows().size();
            const auto prev = colourBox.getText();
            colourBox.clear (juce::dontSendNotification);
            colourSpecs.clear();
            auto add = [&] (const String& label, ColourSpec::Kind k, const String& path = {}, bool numeric = false)
            {
                colourSpecs.push_back ({ k, path, numeric });
                colourBox.addItem (label, (int) colourSpecs.size());
            };
            add ("state", ColourSpec::state);
            add ("first tag", ColourSpec::firstTag);
            add ("group", ColourSpec::group);
            add ("dataset", ColourSpec::dataset);
            add ("model", ColourSpec::model);
            add ("origin", ColourSpec::origin);
            for (auto& f : filter::catalog (model.allViews()))
            {
                const bool isField = f.path.startsWith ("fields/");
                const bool isStat = f.path.startsWith ("analysis/summary/mix/") && f.path.endsWith ("/mean");
                const bool cap = f.path == "capture/tempo_bpm" || f.path == "duration_s" || f.path == "analysis/tempo_bpm";
                if (! (isField || isStat || cap)) continue;
                const bool numeric = f.types.size() == 1 && f.types[0] == "number";
                if (! numeric && ! (f.types.size() == 1 && f.types[0] == "string")) continue;
                add ((numeric ? "# " : "a ") + f.path.replace ("analysis/summary/mix/", "").replace ("/mean", ""), ColourSpec::field, f.path, numeric);
            }
            int sel = 1;
            for (int i = 0; i < colourBox.getNumItems(); ++i) if (colourBox.getItemText (i) == prev) sel = i + 1;
            colourBox.setSelectedId (sel, juce::dontSendNotification);
            refreshColourRange();
        }
    }

    void MapView::setColourModeByText (const String& t)
    {
        for (int i = 0; i < colourBox.getNumItems(); ++i)
            if (colourBox.getItemText (i) == t) { colourBox.setSelectedItemIndex (i, juce::sendNotificationSync); return; }
    }

    void MapView::rebuildPositions()
    {
        pos.clear();
        if (auto* m = model.map())
        {
            for (auto& p : m->points) if (model.rowById (p.bakeId) != nullptr) pos[p.bakeId] = { p.x, p.y };
            if (m->mapId != lastMapId) { lastMapId = m->mapId; fitView(); }
        }
        visibleSet.clear();
        for (int i : model.visible()) visibleSet.insert (model.rows()[(size_t) i].id);
        refreshColourRange();
    }

    // ---- colouring ------------------------------------------------------------------------------------------------
    String MapView::categoryFor (const var& v) const
    {
        const int i = colourBox.getSelectedId() - 1;
        if (i < 0 || i >= (int) colourSpecs.size()) return {};
        const auto& s = colourSpecs[(size_t) i];
        auto firstOf = [] (const juce::StringArray& a) { return a.isEmpty() ? String ("(none)") : a[0]; };
        switch (s.kind)
        {
            case ColourSpec::state:    return json::getString (v, "state");
            case ColourSpec::firstTag: return firstOf (json::getStrings (v, "tags"));
            case ColourSpec::group:    return firstOf (json::getStrings (v, "groups"));
            case ColourSpec::dataset:  return firstOf (json::getStrings (v, "datasets"));
            case ColourSpec::model:    return firstOf (json::getStrings (v, "models"));
            case ColourSpec::origin:   return json::getString (v, "origin");
            case ColourSpec::field:    { auto x = json::get (v, s.path); return x.isString() ? x.toString() : String ("(none)"); }
        }
        return {};
    }

    bool MapView::numberFor (const var& v, double& out) const
    {
        const int i = colourBox.getSelectedId() - 1;
        if (i < 0 || i >= (int) colourSpecs.size() || ! colourSpecs[(size_t) i].numeric) return false;
        const auto x = json::get (v, colourSpecs[(size_t) i].path);
        if (! json::isNumber (x)) return false;
        out = (double) x;
        return true;
    }

    void MapView::refreshColourRange()
    {
        categories.clear();
        numMin = 1e300; numMax = -1e300;
        const int i = colourBox.getSelectedId() - 1;
        const bool numeric = i >= 0 && i < (int) colourSpecs.size() && colourSpecs[(size_t) i].numeric;
        for (auto& r : model.rows())
        {
            if (numeric) { double d; if (numberFor (r.view, d)) { numMin = juce::jmin (numMin, d); numMax = juce::jmax (numMax, d); } }
            else { auto c = categoryFor (r.view); if (! categories.contains (c)) categories.add (c); }
        }
        categories.sort (true);
        if (numMin > numMax) { numMin = 0; numMax = 1; }
    }

    juce::Colour MapView::colourFor (const var& v) const
    {
        double d;
        if (numberFor (v, d)) return gradient (numMax > numMin ? (d - numMin) / (numMax - numMin) : 0.5);
        const auto c = categoryFor (v);
        if (c == "(none)") return col::dim;
        if (colourBox.getText() == "state") return col::forState (c);
        return col::grey;   // an arbitrary category list can't fit a 4-colour palette -- position on the map still clusters it, the legend still names it
    }

    // ---- geometry ---------------------------------------------------------------------------------------------------
    float MapView::baseScale() const { return (float) juce::jmin (plot.getWidth(), plot.getHeight()) * 0.5f * 0.90f; }

    juce::Point<float> MapView::worldToScreen (juce::Point<float> w) const
    {
        return plot.getCentre().toFloat() + (w - centre) * (baseScale() * zoom);
    }

    juce::Point<float> MapView::screenToWorld (juce::Point<float> s) const
    {
        return centre + (s - plot.getCentre().toFloat()) / (baseScale() * zoom);
    }

    void MapView::fitView() { centre = { 0.f, 0.f }; zoom = 1.0f; }

    String MapView::pointAt (juce::Point<float> s, float radius) const
    {
        String best;
        float bestD = radius * radius;
        for (auto& [id, w] : pos)
        {
            const auto p = worldToScreen (w);
            const float d = p.getDistanceSquaredFrom (s);
            if (d <= bestD) { bestD = d; best = id; }
        }
        return best;
    }

    void MapView::resized()
    {
        auto r = getLocalBounds();
        auto top = r.removeFromTop (24);
        spaceBox.setBounds (top.removeFromLeft (150));           top.removeFromLeft (4);
        methodBox.setBounds (top.removeFromLeft (60));           top.removeFromLeft (4);
        computeButton.setBounds (top.removeFromLeft (74));       top.removeFromLeft (8);
        top.removeFromLeft (46);                                 // "COLOR" label painted
        colourBox.setBounds (top.removeFromLeft (150));          top.removeFromLeft (4);
        fitButton.setBounds (top.removeFromLeft (40));
        plot = r.withTrimmedBottom (46).reduced (1);
    }

    // ---- painting ---------------------------------------------------------------------------------------------------
    void MapView::paint (juce::Graphics& g)
    {
        g.fillAll (col::bg);
        g.setColour (col::dim); g.setFont (mono());
        g.drawText ("COLOR", colourBox.getX() - 44, colourBox.getY(), 40, colourBox.getHeight(), juce::Justification::centredRight);

        // the plot is bounded by nothing but the header row above it and the legend below --
        // no frame, no reference grid; panning/zooming is perceptible from the points themselves.
        g.setColour (col::bg);   g.fillRect (plot);

        const auto* map = model.map();
        g.saveState();
        g.reduceClipRegion (plot);

        if (map == nullptr || pos.empty())
        {
            g.restoreState();
            g.setColour (col::dim); g.setFont (mono());
            String msg;
            if (model.rows().empty()) msg = "No Bakes yet.";
            else if (map == nullptr) msg = "No map for '" + model.mapSpace() + "' yet.\n\nPress COMPUTE - the worker analyses every READY Bake and projects it to 2-D.";
            else msg = "This map contains none of the current Bakes. Press COMPUTE.";
            if (! model.snapshot().worker.alive) msg << "\n\n(no worker running: it starts automatically when you queue work)";
            drawWrapped (g, msg, plot.reduced (40), juce::Justification::centred, 6);
            return;
        }

        const float r = juce::jlimit (3.0f, 9.0f, 3.5f + std::sqrt (zoom) * 1.2f);
        const auto& sel = model.selection();
        std::vector<std::pair<String, juce::Point<float>>> drawLater;
        for (auto& [id, w] : pos)
        {
            const auto* row = model.rowById (id);
            if (row == nullptr) continue;
            const auto p = worldToScreen (w);
            if (! plot.expanded (10).toFloat().contains (p)) continue;
            const bool vis = visibleSet.count (id) > 0;
            if (sel.contains (id) || id == model.hover()) { drawLater.push_back ({ id, p }); continue; }
            auto c = colourFor (row->view);
            g.setColour (c.withAlpha (vis ? 0.85f : 0.13f));
            g.fillEllipse (p.x - r, p.y - r, 2 * r, 2 * r);
        }
        for (auto& [id, p] : drawLater)
        {
            const auto* row = model.rowById (id);
            const bool s = sel.contains (id);
            g.setColour (colourFor (row->view));
            g.fillEllipse (p.x - r, p.y - r, 2 * r, 2 * r);
            g.setColour (col::white);   // the one reserved emphasis step for both hover and selection rings; stroke width already tells them apart
            g.drawEllipse (p.x - r - 2.5f, p.y - r - 2.5f, 2 * r + 5.0f, 2 * r + 5.0f, s ? 1.8f : 1.2f);
        }
        if (banding)
        {
            // the rubber-band itself is transient interaction feedback (it only exists while
            // dragging), the same exception as a text-selection highlight -- not a static zone.
            g.setColour (col::grey.withAlpha (0.15f)); g.fillRect (band);
            g.setColour (col::white.withAlpha (0.8f)); g.drawRect (band, 1.0f);
        }
        g.restoreState();

        // hover card
        if (const auto* hr = model.rowById (model.hover()); hr != nullptr && pos.count (hr->id))
        {
            const auto p = worldToScreen (pos[hr->id]);
            auto n = json::getString (hr->view, "notation");
            if (n.length() > 60) n = n.substring (0, 59) + "...";
            const auto tags = json::getStrings (hr->view, "tags").joinIntoString (" · ");
            const String l1 = n.isEmpty() ? String ("(no notation)") : n;
            const String l2 = ids::shortId (hr->id) + "  " + json::getString (hr->view, "state") + "  " + String (json::getNumber (hr->view, "duration_s"), 1) + "s  " + AppModel::tempoText (hr->view) + " bpm";
            const int cw = juce::jmax (juce::GlyphArrangement::getStringWidthInt (mono(), l1), juce::GlyphArrangement::getStringWidthInt (mono(), l2)) + 20;
            juce::Rectangle<int> card ((int) p.x + 14, (int) p.y + 14, cw, tags.isEmpty() ? 42 : 58);
            if (card.getRight() > plot.getRight()) card.setX ((int) p.x - 14 - cw);
            if (card.getBottom() > plot.getBottom()) card.setY ((int) p.y - 14 - card.getHeight());
            // floating overlay, no fixed neighbour -- keeps the single hairline all around
            g.setColour (col::bg.withAlpha (0.96f)); g.fillRect (card);
            g.setColour (col::line);                 g.drawRect (card, 1);
            g.setColour (col::text); g.setFont (mono()); g.drawText (l1, card.getX() + 10, card.getY() + 5, cw - 12, 16, juce::Justification::centredLeft, true);
            g.setColour (col::dim);  g.setFont (mono()); g.drawText (l2, card.getX() + 10, card.getY() + 22, cw - 12, 14, juce::Justification::centredLeft, true);
            if (tags.isNotEmpty()) { g.setColour (col::dim); g.drawText (tags, card.getX() + 10, card.getY() + 38, cw - 12, 14, juce::Justification::centredLeft, true); }
        }

        // legend + honesty footer
        auto foot = getLocalBounds().removeFromBottom (44);
        g.setFont (mono());
        const int i = colourBox.getSelectedId() - 1;
        int x = 6;
        if (i >= 0 && i < (int) colourSpecs.size() && colourSpecs[(size_t) i].numeric)
        {
            for (int k = 0; k < 80; ++k) { g.setColour (gradient (k / 79.0)); g.fillRect (x + k, foot.getY() + 6, 1, 8); }
            g.setColour (col::dim);
            g.drawText (String (numMin, 2), x + 84, foot.getY() + 2, 70, 14, juce::Justification::centredLeft);
            g.drawText (".. " + String (numMax, 2), x + 84 + 60, foot.getY() + 2, 90, 14, juce::Justification::centredLeft);
        }
        else
            for (int k = 0; k < categories.size() && k < 9; ++k)
            {
                const auto c = categories[k];
                const auto colour = c == "(none)" ? col::dim : colourBox.getText() == "state" ? col::forState (c) : col::grey;
                g.setColour (colour); g.fillEllipse ((float) x, (float) foot.getY() + 5.0f, 8.0f, 8.0f);
                g.setColour (col::text);
                const int tw = juce::GlyphArrangement::getStringWidthInt (mono(), c) + 6;
                g.drawText (c, x + 12, foot.getY() + 2, tw, 14, juce::Justification::centredLeft);
                x += 12 + tw + 8;
            }
        g.setColour (col::dim);
        String info = map->method == "tsne" ? "t-SNE" : map->method == "pca" ? "PCA" : map->method.toUpperCase();
        info << "  ·  " << (int) pos.size() << " of " << (int) model.rows().size() << " Bakes";
        if (map->hasTrust) info << "  ·  trustworthiness " << String (map->trustworthiness, 2);
        if (! map->excluded.empty()) info << "  ·  " << (int) map->excluded.size() << " not analysed yet";
        if (map->note.isNotEmpty()) info << "  ·  " << map->note;
        g.drawText (info, 6, foot.getY() + 18, getWidth() - 12, 12, juce::Justification::centredLeft, true);
        g.setColour (col::dim.withAlpha (0.7f));
        g.drawText (map->disclaimer, 6, foot.getY() + 30, getWidth() - 12, 12, juce::Justification::centredLeft, true);
    }

    // ---- interaction ------------------------------------------------------------------------------------------------
    void MapView::mouseMove (const juce::MouseEvent& e)
    {
        if (banding || panning) return;
        model.setHover (pointAt (e.position));
    }
    void MapView::mouseExit (const juce::MouseEvent&) { model.setHover ({}); }

    void MapView::mouseDown (const juce::MouseEvent& e)
    {
        grabKeyboardFocus();
        dragStartScreen = e.position;
        panStartCentre = centre;
        downWasRight = e.mods.isRightButtonDown();
        // Right-click, middle-click and Alt-drag still pan immediately (old muscle memory kept
        // working); everything else -- including a plain left-drag now -- waits to see how the
        // drag actually moves (see mouseDrag()), so a plain click that never crosses the 4 px
        // threshold still falls through to point-selection in mouseUp() instead of being read as
        // "was panning".
        panning = downWasRight || e.mods.isMiddleButtonDown() || e.mods.isAltDown();
        banding = false;
        bandBase = e.mods.isShiftDown() ? model.selection() : juce::StringArray();
    }

    void MapView::mouseDrag (const juce::MouseEvent& e)
    {
        auto updateBand = [&]
        {
            band = juce::Rectangle<float> (dragStartScreen, e.position);
            juce::StringArray ids = bandBase;
            for (auto& [id, w] : pos)
                if (band.contains (worldToScreen (w)) && visibleSet.count (id) > 0 && ! ids.contains (id)) ids.add (id);
            model.setSelection (ids);
        };
        if (panning)
        {
            centre = panStartCentre - (e.position - dragStartScreen) / (baseScale() * zoom);
            repaint();
            return;
        }
        if (banding) { updateBand(); repaint(); return; }
        if (e.getDistanceFromDragStart() < 4) return;
        // First real movement past the click threshold decides the gesture for the rest of this
        // drag: Shift rubber-band-selects (still extending whatever was already selected -- see
        // bandBase in mouseDown()); anything else pans -- the same click-and-drag-to-look-around
        // gesture the Lexicon tree uses (see SpectromorphologyTree::mouseDrag()). Decided once
        // here, not re-checked every event, so pressing/releasing Shift mid-drag doesn't flip
        // whatever's already under way.
        if (e.mods.isShiftDown()) { banding = true; updateBand(); }
        else { panning = true; centre = panStartCentre - (e.position - dragStartScreen) / (baseScale() * zoom); }
        repaint();
    }

    void MapView::mouseUp (const juce::MouseEvent& e)
    {
        const bool wasBanding = banding, wasPanning = panning;
        banding = panning = false;
        const bool clicked = e.getDistanceFromDragStart() < 4;
        if (downWasRight && clicked)                                   // right-click without dragging: context menu (drag = pan)
        {
            const auto h = pointAt (e.position);
            if (h.isNotEmpty() && ! model.selection().contains (h)) model.setSelection ({ h }, h);
            if (! model.selection().isEmpty()) BankView::showContextMenu (model, host, this, model.selection());
            downWasRight = false;
            return;
        }
        downWasRight = false;
        if (wasBanding || wasPanning) { repaint(); return; }
        const auto hit = pointAt (e.position);
        if (hit.isEmpty()) { if (! e.mods.isAnyModifierKeyDown()) model.setSelection ({}); return; }
        auto sel = model.selection();
        if (e.mods.isAnyModifierKeyDown()) { if (sel.contains (hit)) sel.removeString (hit); else sel.add (hit); model.setSelection (sel, hit); }
        else model.setSelection ({ hit }, hit);
    }

    void MapView::mouseDoubleClick (const juce::MouseEvent& e)
    {
        const auto hit = pointAt (e.position);
        if (hit.isNotEmpty()) { centre = pos[hit]; zoom = juce::jmax (zoom, 4.0f); }
        else fitView();
        repaint();
    }

    void MapView::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& w)
    {
        const auto before = screenToWorld (e.position);
        zoom = juce::jlimit (0.5f, 200.0f, zoom * std::exp (w.deltaY * 1.1f));
        const auto after = screenToWorld (e.position);
        centre += before - after;                              // keep the point under the cursor fixed
        repaint();
    }

    bool MapView::keyPressed (const juce::KeyPress& k)
    {
        if (k.getTextCharacter() == 'f' || k.getTextCharacter() == 'F') { fitView(); repaint(); return true; }
        if (k == juce::KeyPress::escapeKey) { model.setSelection ({}); return true; }
        const auto& sel = model.selection();
        if (! sel.isEmpty() && (k == juce::KeyPress::deleteKey)) { BankView::confirmTrash (model, host, sel); return true; }
        return false;
    }
}
