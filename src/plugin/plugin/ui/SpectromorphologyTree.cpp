#include "SpectromorphologyTree.h"
#include <functional>

namespace gnumbat::ui
{
    using juce::String;

    namespace
    {
        // Tighter than the rest of the UI's one type size -- this diagram needs to pack ~30
        // boxes into a plugin window, not read as a single line of text -- so its own labels
        // (buildLayout()'s width measurements and paint()'s drawing both use this, never mono()
        // directly) are smaller, and the boxes/rows follow suit.
        juce::Font labelFont() { return mono().withHeight (kFontSize * 0.8f); }
        // Tightened on request ("much tighter... more compact") -- every side-by-side sibling row
        // that isn't a stack group (see isStackGroup()/buildLayout()) turns out to be short labels
        // only (NOISE/NODE/NOTE under SPECTRAL TYPE; SPECTRUM/MORPHOLOGY, kept apart by their own
        // wide subtrees below rather than by this constant) -- every long-labelled row is a stack
        // group instead, which already sizes its own slot off its widest child's actual box width
        // (see the maxRight/kStackIndent math below), not off kSlotW. So kSlotW/kRowH can shrink
        // a good deal with no real overlap risk.
        constexpr float kSlotW = 68.0f;    // horizontal spacing between sibling leaf slots (world units)
        constexpr float kRowH  = 40.0f;    // vertical spacing between depth levels
        constexpr float kBoxH  = 16.0f;

        int textW (const String& s) { return juce::GlyphArrangement::getStringWidthInt (labelFont(), s); }
    }

    SpectromorphologyTree::SpectromorphologyTree()
    {
        setWantsKeyboardFocus (true);
        buildLayout();
        selectedId = rootId;   // opens with a definition already showing, not an empty strip
    }

    // Classic "tidy tree" pass: every leaf gets the next free horizontal slot in traversal order,
    // every internal node sits above the average x of its own children -- computed bottom-up
    // (post-order) off the lexicon's flat parent links, not hand-placed coordinates, so the tree
    // stays correct if the vocabulary itself ever grows.
    void SpectromorphologyTree::buildLayout()
    {
        auto& lex = spectromorphologyLexicon();
        std::map<String, std::vector<String>> children;
        std::map<String, const SpectroTerm*> byId;
        for (auto& t : lex)
        {
            byId[t.id] = &t;
            if (t.parentId.isEmpty()) rootId = t.id;
            else children[t.parentId].push_back (t.id);
        }

        std::map<String, int> depthOf;
        std::function<int (const String&)> depthOfFn = [&] (const String& id) -> int
        {
            if (auto it = depthOf.find (id); it != depthOf.end()) return it->second;
            auto* term = byId[id];
            const int d = term->parentId.isEmpty() ? 0 : depthOfFn (term->parentId) + 1;
            depthOf[id] = d;
            return d;
        };

        // A "stack group": a parent whose children are ALL leaves themselves (no grandchildren),
        // e.g. SPECTRUM SHAPE's three or MOTION's seven -- those get piled into one vertical
        // column (see below) instead of spreading sideways one slot per child. A mixed group like
        // spectral_type's (NOTE still branches to HARMONIC/INHARMONIC) stays a normal side-by-side
        // row, since one of its children genuinely needs the row below to itself.
        auto isStackGroup = [&] (const String& id) -> bool
        {
            auto it = children.find (id);
            if (it == children.end() || it->second.size() < 2) return false;
            for (auto& c : it->second)
                if (! children[c].empty())
                    return false;
            return true;
        };

        constexpr float kStackRowH  = kBoxH + 4.0f;   // tight vertical gap inside a stacked column
        constexpr float kStackIndent = 9.0f;          // trunk-to-box gap (see paint()'s tick marks)
        stackChildrenOf.clear();

        float nextLeafX = 0.0f;
        std::map<String, float> xOf;
        std::map<String, float> yOf;   // set only for stacked children -- overrides depth*kRowH below
        std::function<float (const String&)> layout = [&] (const String& id) -> float
        {
            auto& kids = children[id];
            float x;
            if (kids.empty())
            {
                x = nextLeafX; nextLeafX += kSlotW;
            }
            else if (isStackGroup (id))
            {
                // One slot for the whole column (not one per child) -- the parent still ends up
                // centred above it below, same as a normal single-child case.
                x = nextLeafX;
                const float topY = (float) (depthOfFn (id) + 1) * kRowH;
                float maxRight = x;
                for (size_t i = 0; i < kids.size(); ++i)
                {
                    const float w = juce::jmax (44.0f, (float) textW (byId[kids[i]]->label) + 12.0f);
                    xOf[kids[i]] = x + kStackIndent + w * 0.5f;
                    yOf[kids[i]] = topY + (float) i * kStackRowH;
                    maxRight = juce::jmax (maxRight, x + kStackIndent + w);
                }
                stackChildrenOf[id] = kids;
                // A little extra breathing room after a BIG stack group (3+ children) specifically
                // -- e.g. the gaps between [PRIMITIVE]/[SECTIONAL MOTION]/[COMPOSITE] under
                // MORPHOLOGY, each a stack in its own right -- vs. the tighter 0.25 kept for a
                // small 2-item stack like NOTE's own HARMONIC/INHARMONIC, which never asked for more.
                const float gapFactor = kids.size() >= 3 ? 0.9f : 0.25f;
                nextLeafX = juce::jmax (nextLeafX + kSlotW, maxRight + kSlotW * gapFactor);
            }
            else
            {
                float sum = 0.0f;
                for (auto& c : kids) sum += layout (c);
                x = sum / (float) kids.size();
            }
            xOf[id] = x;
            return x;
        };
        if (rootId.isNotEmpty()) layout (rootId);

        boxes.clear();
        indexOf.clear();
        for (auto& t : lex)
        {
            const float w = juce::jmax (44.0f, (float) textW (t.label) + 12.0f);
            const float cx = xOf[t.id];
            const float y = yOf.count (t.id) ? yOf[t.id] : (float) depthOfFn (t.id) * kRowH;
            indexOf[t.id] = (int) boxes.size();
            boxes.push_back ({ t.id, juce::Rectangle<float> (cx - w * 0.5f, y, w, kBoxH) });
        }

        worldBounds = boxes.empty() ? juce::Rectangle<float>() : boxes.front().world;
        for (auto& b : boxes) worldBounds = worldBounds.getUnion (b.world);
        worldBounds = worldBounds.expanded (kSlotW * 0.5f, kRowH * 0.5f);

        // Fallback centre/zoom for before this component has real bounds -- resized() replaces
        // this with fitView() (the whole tree, scaled to the plugin window) the first time it's
        // actually laid out; see there.
        centre = (! boxes.empty() && indexOf.count (rootId)) ? boxes[(size_t) indexOf[rootId]].world.getCentre() : juce::Point<float>();
        zoom = 1.0f;
    }

    void SpectromorphologyTree::fitView()
    {
        if (worldBounds.isEmpty() || canvas.isEmpty()) return;
        const float zx = (float) canvas.getWidth()  / worldBounds.getWidth();
        const float zy = (float) canvas.getHeight() / worldBounds.getHeight();
        const float wholeTreeZoom = juce::jmin (zx, zy) * 0.94f;
        // labelFont() is a fixed on-screen size -- it isn't scaled by zoom (see paint()) -- so
        // once a box shrinks below roughly its own world size, that fixed-size text stops fitting
        // it and starts truncating. Rather than pick an arbitrary comfort margin, the floor is
        // derived directly from the ROOT box (SPECTROMORPHOLOGY): it carries the single longest
        // label in the whole tree, and every box's world width is already sized to its OWN label's
        // pixel width (see buildLayout()'s `textW (label) + 12`), so the root is mathematically
        // the first -- and only -- box that can ever truncate as zoom drops. Keeping IT legible
        // keeps every shorter label legible too, with none of the extra margin the old flat 1.35
        // constant spent on trees that didn't need it. That makes this the true maximum zoom-out:
        // "zoom out until SPECTROMORPHOLOGY would get cut, don't cut it, go to the max" -- go
        // exactly as far as the root itself allows, not a fixed comfortable-looking number.
        float rootFloor = 1.0f;
        if (auto it = indexOf.find (rootId); it != indexOf.end())
        {
            const auto& rootWorld = boxes[(size_t) it->second].world;
            if (auto* term = findSpectroTerm (rootId))
            {
                constexpr float kRootPad = 4.0f;   // a hair of margin -- not drawn flush on the box edge
                rootFloor = ((float) textW (term->label) + kRootPad) / rootWorld.getWidth();
            }
        }
        zoom = juce::jlimit (rootFloor, 4.0f, wholeTreeZoom);
        // Centred on the root box (SPECTROMORPHOLOGY itself), not on worldBounds' own geometric
        // centre -- the tree is lopsided (MORPHOLOGY's side carries far more descendants than
        // SPECTRUM's), so that bounding box's centre drifts off toward the busier side rather than
        // sitting on the one box every branch actually starts from. FIT should always bring you
        // back to the root, centred, on request.
        centre = indexOf.count (rootId) ? boxes[(size_t) indexOf[rootId]].world.getCentre() : worldBounds.getCentre();
    }

    juce::Point<float> SpectromorphologyTree::worldToScreen (juce::Point<float> w) const
    {
        return canvas.getCentre().toFloat() + (w - centre) * zoom;
    }

    juce::Rectangle<float> SpectromorphologyTree::worldToScreen (juce::Rectangle<float> r) const
    {
        return juce::Rectangle<float> (worldToScreen (r.getTopLeft()), worldToScreen (r.getBottomRight()));
    }

    juce::Point<float> SpectromorphologyTree::screenToWorld (juce::Point<float> s) const
    {
        return centre + (s - canvas.getCentre().toFloat()) / zoom;
    }

    juce::String SpectromorphologyTree::hitTest (juce::Point<float> screenPos) const
    {
        for (auto& b : boxes)
            if (worldToScreen (b.world).contains (screenPos))
                return b.id;
        return {};
    }

    void SpectromorphologyTree::resized()
    {
        auto r = getLocalBounds();
        // No header row reserved here any more -- FIT lives in GnumbatEditor's tabsRect now (see
        // the header's own comment), so the whole component is just canvas + the detail strip.
        // The definition strip only exists while something's selected -- it opens (reserving its
        // own space at the bottom) the moment a box is, and closes (the canvas reclaiming that
        // height) the moment nothing is; see mouseUp(). Opens already selected (the root -- see
        // the constructor), so this is true from the very first layout in practice.
        detailRect = selectedId.isNotEmpty() ? r.removeFromBottom (68) : juce::Rectangle<int>();
        canvas = r;
        // The first real layout (this component starts at 0x0 until GnumbatEditor::showDialog()
        // gives it the window's actual bounds) opens on the whole tree, not centred on the root
        // at 1:1 -- the point is to fit the plugin window, not to require panning just to see the
        // two main branches. Later resizes (the plugin window itself resized while this stays
        // open, or the definition strip opening/closing) leave a pan/zoom the user already set
        // alone.
        if (! didInitialFit && ! canvas.isEmpty()) { fitView(); didInitialFit = true; }
    }

    void SpectromorphologyTree::paint (juce::Graphics& g)
    {
        g.fillAll (col::bg);
        g.setFont (mono());

        // This header row just holds CLOSE/FIT, placed by resized() on the right -- no credit
        // is drawn here (it lives on the main page's title row -- see CapturePanel::paint()).

        g.saveState();
        g.reduceClipRegion (canvas);

        // connecting lines: an ordinary parent/child pair gets the elbow (vertical/horizontal/
        // vertical, shared verticals between siblings naturally overlapping into one continuous
        // "bus", the same look the ASCII tree in the brief draws by hand); a stack group's
        // children (see buildLayout()) are skipped here and drawn as a directory-tree trunk below
        // instead, since they all share their parent's x and would otherwise draw one straight
        // line per child, each passing through every box above it.
        g.setColour (col::line);
        for (auto& t : spectromorphologyLexicon())
        {
            if (t.parentId.isEmpty()) continue;
            if (stackChildrenOf.count (t.parentId)) continue;
            auto pIt = indexOf.find (t.parentId);
            auto cIt = indexOf.find (t.id);
            if (pIt == indexOf.end() || cIt == indexOf.end()) continue;
            const auto pRect = worldToScreen (boxes[(size_t) pIt->second].world);
            const auto cRect = worldToScreen (boxes[(size_t) cIt->second].world);
            const float yMid = (pRect.getBottom() + cRect.getY()) * 0.5f;
            g.drawLine (pRect.getCentreX(), pRect.getBottom(), pRect.getCentreX(), yMid, 1.0f);
            g.drawLine (pRect.getCentreX(), yMid, cRect.getCentreX(), yMid, 1.0f);
            g.drawLine (cRect.getCentreX(), yMid, cRect.getCentreX(), cRect.getY(), 1.0f);
        }
        // Stack groups: one vertical trunk from the parent's bottom down to the last stacked
        // box's mid-height, with a short horizontal tick out to each box's left edge -- a plain
        // directory-tree look, and it never crosses through a box the way per-child elbows would.
        for (auto& [parentId, kids] : stackChildrenOf)
        {
            auto pIt = indexOf.find (parentId);
            if (pIt == indexOf.end() || kids.empty()) continue;
            const auto pRect = worldToScreen (boxes[(size_t) pIt->second].world);
            const float trunkX = pRect.getCentreX();
            float lastMidY = pRect.getBottom();
            for (auto& cid : kids)
            {
                auto cIt = indexOf.find (cid);
                if (cIt == indexOf.end()) continue;
                const auto cRect = worldToScreen (boxes[(size_t) cIt->second].world);
                lastMidY = cRect.getCentreY();
                g.drawLine (trunkX, lastMidY, cRect.getX(), lastMidY, 1.0f);
            }
            g.drawLine (trunkX, pRect.getBottom(), trunkX, lastMidY, 1.0f);
        }

        // boxes -- rectangle + centred label, grey at rest, white for the hovered/selected one
        // (the same hover language every other control here uses), never colour-coded by branch
        // (see Theme.h: colour marks emphasis/state, never category).
        g.setFont (labelFont());
        for (auto& b : boxes)
        {
            const auto r = worldToScreen (b.world);
            if (! r.intersects (canvas.toFloat())) continue;
            const bool hot = b.id == hoverId || b.id == selectedId;
            g.setColour (hot ? col::white : col::line);
            g.drawRect (r, 1.0f);
            g.setColour (hot ? col::white : col::text);
            if (auto* term = findSpectroTerm (b.id))
                g.drawText (term->label, r, juce::Justification::centred, true);
        }
        g.setFont (mono());

        g.restoreState();

        // detail strip: the selected box's definition/examples, no separating hairline -- the
        // strip's own empty space above the text already reads as a break from the tree, and it
        // only exists at all while something's selected (see resized()). The tree above never
        // moves or hides to make room for it either way.
        if (auto* t = findSpectroTerm (selectedId))
        {
            auto area = detailRect.reduced (10, 6);
            auto labelRow = area.removeFromTop (16);
            g.setColour (col::white);
            g.drawText (t->label, labelRow, juce::Justification::centredLeft);

            String ex;
            if (! t->examples.isEmpty())
            {
                ex = "e.g. ";
                for (auto& e : t->examples) ex << "#" << e << " ";
                ex = ex.trim();
            }
            const auto exRow = ex.isNotEmpty() ? area.removeFromBottom (14) : juce::Rectangle<int>();
            g.setColour (col::text);
            g.drawFittedText (t->definition, area, juce::Justification::topLeft, 3);
            if (ex.isNotEmpty())
            {
                g.setColour (col::dim);
                g.drawText (ex, exRow, juce::Justification::bottomLeft, true);
            }
        }
        // else: nothing selected -- detailRect is empty (see resized()), so there's no strip to
        // draw into at all; the canvas already reclaimed that height.
    }

    void SpectromorphologyTree::mouseDown (const juce::MouseEvent& e)
    {
        dragStartScreen = e.position;
        panStartCentre = centre;
        panning = false;
    }

    void SpectromorphologyTree::mouseDrag (const juce::MouseEvent& e)
    {
        if (! panning && e.position.getDistanceFrom (dragStartScreen) > 4.0f) panning = true;
        if (panning)
        {
            centre = panStartCentre - (e.position - dragStartScreen) / zoom;
            repaint (canvas);
        }
    }

    void SpectromorphologyTree::mouseUp (const juce::MouseEvent& e)
    {
        if (! panning)
        {
            const auto id = hitTest (e.position);
            if (id != selectedId)
            {
                selectedId = id;
                resized();   // the definition strip opening/closing changes canvas -- see there
            }
            repaint();
        }
        panning = false;
    }

    void SpectromorphologyTree::mouseMove (const juce::MouseEvent& e)
    {
        const auto id = hitTest (e.position);
        if (id != hoverId)
        {
            hoverId = id;
            setMouseCursor (hoverId.isNotEmpty() ? juce::MouseCursor::PointingHandCursor : juce::MouseCursor::NormalCursor);
            repaint (canvas);
        }
    }

    void SpectromorphologyTree::mouseExit (const juce::MouseEvent&)
    {
        if (hoverId.isNotEmpty()) { hoverId.clear(); setMouseCursor (juce::MouseCursor::NormalCursor); repaint (canvas); }
    }

    void SpectromorphologyTree::mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails& w)
    {
        zoom = juce::jlimit (0.15f, 4.0f, zoom * std::exp (w.deltaY * 1.1f));
        repaint (canvas);
    }

    bool SpectromorphologyTree::keyPressed (const juce::KeyPress& k)
    {
        if (k == juce::KeyPress::escapeKey) { if (onClose) onClose(); return true; }
        if (k.getTextCharacter() == 'f' || k.getTextCharacter() == 'F') { fitView(); repaint(); return true; }
        return false;
    }
}
