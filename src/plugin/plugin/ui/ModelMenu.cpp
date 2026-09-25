#include "ModelMenu.h"
#include "../../core/JsonIo.h"
#include "../../core/Settings.h"
#include <algorithm>
#include <map>
#include <set>
#include <functional>

namespace gnumbat::ui
{
    using juce::String;

    static const String kUp (juce::CharPointer_UTF8 ("\xE2\x86\x91"));
    static const String kDown (juce::CharPointer_UTF8 ("\xE2\x86\x93"));
    // tree glyphs, as in the Model select screen: "├── ", "└── ", "│   "
    static const String kTee (juce::CharPointer_UTF8 ("\xE2\x94\x9C\xE2\x94\x80\xE2\x94\x80 "));
    static const String kElbow (juce::CharPointer_UTF8 ("\xE2\x94\x94\xE2\x94\x80\xE2\x94\x80 "));
    static const String kPipe (juce::CharPointer_UTF8 ("\xE2\x94\x82   "));

    static int textW (const String& s) { return juce::GlyphArrangement::getStringWidthInt (mono(), s); }
    static String dateText (juce::int64 ms) { return ms > 0 ? juce::Time (ms).formatted ("%Y-%m-%d %H:%M") : String ("-"); }

    ModelMenu::ModelMenu (AppModel& m, UiHost& h) : model (m), host (h)
    {
        setWantsKeyboardFocus (true);

        nameEntry.setFont (mono());
        nameEntry.setTextToShowWhenEmpty ("e.g. deep techno / ambient drones", col::dim);
        nameEntry.onReturnKey = [this] { confirmCreate(); };
        nameEntry.onEscapeKey = [this] { cancelNaming(); };
        addChildComponent (nameEntry);

        createButton.onClick = [this] { confirmCreate(); };
        cancelNameButton.onClick = [this] { cancelNaming(); };
        addChildComponent (createButton);
        addChildComponent (cancelNameButton);
    }

    void ModelMenu::refresh (const juce::File& libraryRoot, const juce::String& current)
    {
        root = libraryRoot;
        currentId = current;
        static const std::vector<ModelHub::Model> none;
        const auto& models = hub != nullptr ? hub->models() : none;

        // Bakes per Model: the hub's own per-model list (panel.html's bakes + Bakes the plugin
        // reported) plus this Library's Bakes that name the model, counted once each.
        std::map<String, std::set<String>> bakeIds;
        std::map<String, std::set<String>> makers;
        for (auto& m : models) for (auto& b : m.bakeIds) bakeIds[m.id].insert (b);
        for (auto& r : model.rows())
        {
            auto mid = json::getString (r.view, "model_id");
            if (mid.isEmpty()) continue;
            if (hub != nullptr) mid = hub->resolve (mid);
            bakeIds[mid].insert (r.id);
            makers[mid].insert (json::getString (r.view, "creator"));
        }

        std::map<String, std::vector<int>> children;
        std::vector<int> roots;
        for (int i = 0; i < (int) models.size(); ++i)
        {
            auto& m = models[(size_t) i];
            const bool parentExists = std::any_of (models.begin(), models.end(), [&] (const ModelHub::Model& o) { return o.id == m.parentId; });
            if (m.parentId.isEmpty() || ! parentExists) roots.push_back (i); else children[m.parentId].push_back (i);
        }
        // Newest lineage first, like the Model select screen; children stay in creation order.
        std::reverse (roots.begin(), roots.end());

        rows.clear();
        // Depth-first; `lead` carries the "│   " / "    " columns of the ancestors.
        std::function<void (int, const String&, bool, bool)> walk = [&] (int idx, const String& lead, bool isRoot, bool isLast)
        {
            const auto& m = models[(size_t) idx];
            Row r;
            r.id = m.id; r.name = m.name; r.creator = m.creators.joinIntoString (", ");
            r.treePrefix = isRoot ? String() : lead + (isLast ? kElbow : kTee);
            r.created = m.createdMs; r.edited = m.editedMs;
            r.bakes = bakeIds.count (m.id) ? (int) bakeIds[m.id].size() : 0;
            // STATE: panel.html's modelStateText() -- flagged / training / unavailable / ready, else the bake count
            r.state = m.state.isNotEmpty() ? m.state : String (r.bakes) + (r.bakes == 1 ? " bake" : " bakes");
            r.contributors = m.contributors;
            r.up = m.up; r.down = m.down; r.myVote = m.myVote;
            r.pending = m.pending;
            rows.push_back (r);
            const String childLead = isRoot ? String() : lead + (isLast ? String ("    ") : kPipe);
            auto it = children.find (m.id);
            if (it != children.end())
                for (size_t c = 0; c < it->second.size(); ++c)
                    walk (it->second[c], childLead, false, c + 1 == it->second.size());
        };
        for (int r : roots) walk (r, {}, true, true);

        if (cursorId.isEmpty() || std::none_of (rows.begin(), rows.end(), [&] (const Row& r) { return r.id == cursorId; }))
            cursorId = currentId.isNotEmpty() ? currentId : (rows.empty() ? String() : rows.front().id);
        scrollRows = 0; hoverRow = -1;
        resized();
        repaint();
    }

    void ModelMenu::layoutColumns()
    {
        // Priority order: STATE and VOTES always; then EDITED, CREATED, CONTRIB as width allows.
        const int dateW = textW ("2026-09-16 17:42") + 12;
        const int stateW = juce::jmax (textW ("99 bakes"), textW ("unavailable")) + 12;   // panel.html's STATE words
        const int contribW = textW ("CONTRIB") + 12;
        const int votesW = textW (kUp + "99 " + kDown + "99") + 8;
        const int minModel = textW ("wfesgrdbtfngh by local") + 8;
        const int avail = listArea.getWidth();

        bool showEdited = false, showCreated = false, showContrib = false;
        int used = stateW + votesW;
        if (avail - used - dateW >= minModel)    { showEdited = true;  used += dateW; }
        if (avail - used - dateW >= minModel)    { showCreated = true; used += dateW; }
        if (avail - used - contribW >= minModel) { showContrib = true; used += contribW; }
        modelColW = avail - used;

        cols.clear();
        int x = listArea.getX() + modelColW;
        auto add = [&] (ColKind k, const String& label, int w, bool centre) { cols.push_back ({ k, label, x, w, centre }); x += w; };
        if (showCreated) add (ColKind::created, "CREATED", dateW, false);
        if (showEdited)  add (ColKind::edited, "EDITED", dateW, false);
        add (ColKind::state, "STATE", stateW, true);
        if (showContrib) add (ColKind::contrib, "CONTRIB", contribW, true);
        add (ColKind::votes, "VOTES", votesW, true);
    }

    void ModelMenu::resized()
    {
        auto r = getLocalBounds().reduced (10, 0);
        r.removeFromTop (6);
        headerRect = r.removeFromTop (rowH);
        // Bottom line: hub status only now (the credit moved above). While naming a new model,
        // the name field gets its own line just above it.
        hubRect = r.removeFromBottom (19);
        bottomRect = naming ? r.removeFromBottom (19) : hubRect;
        r.removeFromBottom (8);
        listArea = r;
        layoutColumns();

        auto b = bottomRect;
        if (naming)
        {
            createButton.setBounds (b.removeFromRight (textW ("CREATE") + 20));
            b.removeFromRight (6);
            cancelNameButton.setBounds (b.removeFromRight (textW ("CANCEL") + 20));
            b.removeFromRight (8);
            b.removeFromLeft (textW ("NAME") + 10);
            nameEntry.setBounds (b);
        }
    }

    void ModelMenu::updateVisibility()
    {
        nameEntry.setVisible (naming);
        createButton.setVisible (naming);
        cancelNameButton.setVisible (naming);
    }

    void ModelMenu::beginNaming (const String& parentId)
    {
        naming = true;
        namingParent = parentId;
        nameEntry.setText ({}, false);
        updateVisibility();
        resized();
        if (isShowing()) nameEntry.grabKeyboardFocus();
        repaint();
    }

    void ModelMenu::cancelNaming()
    {
        naming = false;
        updateVisibility();
        resized();
        if (isShowing()) grabKeyboardFocus();
        repaint();
    }

    void ModelMenu::confirmCreate()
    {
        const auto name = nameEntry.getText().trim();
        if (name.isEmpty()) return;
        if (hub == nullptr) return;
        const auto idOut = hub->createModel (name, namingParent);
        if (! hub->connected()) host.notify ("hub offline -- \"" + name + "\" is saved here and will be sent when it's back");
        naming = false;
        updateVisibility();
        cursorId = idOut;
        refresh (root, currentId);
        if (isShowing()) grabKeyboardFocus();
    }

    void ModelMenu::enter (const String& id)
    {
        if (naming || id.isEmpty()) return;
        currentId = cursorId = id;
        if (onSelect) onSelect (id);
    }

    void ModelMenu::vote (const String& id, bool up)
    {
        if (hub == nullptr) return;
        for (auto& r : rows)
        {
            if (r.id != id) continue;
            const int want = up ? 1 : -1;
            hub->vote (id, r.myVote == want ? 0 : want);   // clicking your own vote again takes it back
            return;
        }
    }

    void ModelMenu::moveCursor (int delta)
    {
        if (rows.empty()) return;
        int idx = 0;
        for (int i = 0; i < (int) rows.size(); ++i) if (rows[(size_t) i].id == cursorId) { idx = i; break; }
        idx = juce::jlimit (0, (int) rows.size() - 1, idx + delta);
        cursorId = rows[(size_t) idx].id;
        const int vis = juce::jmax (1, listArea.getHeight() / rowH);
        if (idx < scrollRows) scrollRows = idx;
        else if (idx >= scrollRows + vis) scrollRows = idx - vis + 1;
        hoverRow = -1;
        repaint();
    }

    int ModelMenu::rowAt (juce::Point<int> p) const
    {
        if (naming || ! listArea.contains (p)) return -1;
        const int idx = scrollRows + (p.y - listArea.getY()) / rowH;
        return idx >= 0 && idx < (int) rows.size() ? idx : -1;
    }

    const ModelMenu::Col* ModelMenu::colAt (int x) const
    {
        for (auto& c : cols) if (x >= c.x && x < c.x + c.w) return &c;
        return nullptr;
    }

    int ModelMenu::voteSplitX (const Row& row, const Col& c) const
    {
        // Mirrors the centring math in paint()'s ColKind::votes case exactly, so the boundary
        // returned here always matches where the up/down glyphs are actually drawn -- reconstructed
        // from just (row, col) since mouseUp() has no access to paint()'s loop-local cell/rr.
        const auto cell = juce::Rectangle<int> (c.x, 0, c.w, 0).reduced (4, 0);
        const String upT = kUp + String (row.up), downT = kDown + String (row.down);
        const int upW = textW (upT), downW = textW (downT);
        constexpr int votesGap = 4;
        const int gx = cell.getX() + (cell.getWidth() - (upW + votesGap + downW)) / 2;
        return gx + upW + votesGap / 2;
    }

    void ModelMenu::mouseMove (const juce::MouseEvent& e)
    {
        const int r = rowAt (e.getPosition());
        hoverRow = r;   // (no hover highlight -- only the selection is lit)
        setMouseCursor (r >= 0 ? juce::MouseCursor::PointingHandCursor : juce::MouseCursor::NormalCursor);
    }

    void ModelMenu::mouseExit (const juce::MouseEvent&)
    {
        hoverRow = -1;
    }

    void ModelMenu::mouseUp (const juce::MouseEvent& e)
    {
        const int r = rowAt (e.getPosition());
        if (! e.mouseWasClicked() || naming) return;
        if (e.mods.isPopupMenu())
        {
            // Right-click: branch from / enter the model under the pointer, or start a new seed
            // (anywhere, including the empty space below the list -- there's no SEED NEW button).
            juce::PopupMenu menu;
            String id, name;
            if (r >= 0) { id = rows[(size_t) r].id; name = rows[(size_t) r].name; cursorId = id; repaint (listArea); }
            if (r >= 0)
            {
                menu.addItem (1, "Branch from " + name + "...");
                menu.addItem (2, "Enter " + name);
                menu.addSeparator();
            }
            menu.addItem (3, "New seed...");
            menu.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (this).withMousePosition(),
                                [safe = juce::Component::SafePointer<ModelMenu> (this), id] (int res)
                                {
                                    if (safe == nullptr) return;
                                    if (res == 1) safe->beginNaming (id);
                                    else if (res == 2) safe->enter (id);
                                    else if (res == 3) safe->beginNaming ({});
                                });
            return;
        }
        if (r < 0) return;
        const auto& row = rows[(size_t) r];
        if (auto* c = colAt (e.x); c != nullptr && c->kind == ColKind::votes)
        {
            vote (row.id, e.x < voteSplitX (row, *c));   // exact boundary between the drawn up/down glyphs
            return;
        }
        // A click only SELECTS the model; Enter opens it (like panel.html's model select).
        cursorId = row.id;
        grabKeyboardFocus();
        repaint (listArea);
    }

    void ModelMenu::mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails& wheel)
    {
        if (naming || rows.empty()) return;
        const int vis = juce::jmax (1, listArea.getHeight() / rowH);
        scrollRows = juce::jlimit (0, juce::jmax (0, (int) rows.size() - vis), scrollRows - (int) std::lround (wheel.deltaY * 3.0f));
        repaint (listArea);
    }

    bool ModelMenu::keyPressed (const juce::KeyPress& k)
    {
        if (naming) { if (k == juce::KeyPress::escapeKey) cancelNaming(); return true; }
        if (k == juce::KeyPress::escapeKey) { if (onBack) onBack(); return true; }
        if (k == juce::KeyPress::returnKey) { enter (cursorId); return true; }
        if (k == juce::KeyPress::upKey)   { moveCursor (-1); return true; }
        if (k == juce::KeyPress::downKey) { moveCursor (1);  return true; }
        if (k == juce::KeyPress ('b', juce::ModifierKeys::noModifiers, 0) && cursorId.isNotEmpty()) { beginNaming (cursorId); return true; }
        if (k == juce::KeyPress ('n', juce::ModifierKeys::noModifiers, 0)) { beginNaming ({}); return true; }
        return false;
    }

    void ModelMenu::paint (juce::Graphics& g)
    {
        g.fillAll (col::bg);
        g.setFont (mono());

        // the credit now lives in the global header -- see GnumbatEditor::paint().

        // hub indicator: bottom line, left margin -- is this list live?
        if (hub != nullptr && ! naming)
        {
            g.setColour (hub->connected() ? col::text : col::dim);
            g.drawText (hub->statusText(), hubRect, juce::Justification::centred, false);
        }

        // column header
        g.setColour (col::dim);
        g.drawText ("MODEL", headerRect.withWidth (modelColW), juce::Justification::centredLeft, false);
        for (auto& c : cols)
            g.drawText (c.label, juce::Rectangle<int> (c.x, headerRect.getY(), c.w, headerRect.getHeight()).reduced (4, 0),
                        c.centreAlign ? juce::Justification::centred : juce::Justification::centredLeft, false);

        if (naming)
        {
            g.setColour (col::dim);
            g.drawText ("NAME", bottomRect, juce::Justification::centredLeft, false);
        }

        if (rows.empty())
        {
            g.setColour (col::dim);
            g.drawText ("no models yet -- press N (or right-click) to start the first one", listArea.withHeight (rowH), juce::Justification::centredLeft, true);
            return;
        }

        g.saveState();
        g.reduceClipRegion (listArea);
        const int first = scrollRows;
        const int last = juce::jmin ((int) rows.size(), first + listArea.getHeight() / rowH + 1);
        for (int i = first; i < last; ++i)
        {
            const auto& row = rows[(size_t) i];
            const auto rr = listArea.withY (listArea.getY() + (i - first) * rowH).withHeight (rowH);
            const bool lit = row.id == cursorId;   // the selection (click / arrow keys) -- Enter opens it
            const bool current = row.id == currentId;
            // Highlighted row: solid white bar, black text (same as a selected Library row).
            // Otherwise the current model reads white, everything else grey; "by ..." stays dim.
            if (lit) { g.setColour (col::white); g.fillRect (rr); }
            const auto strong = lit ? col::bg : (current ? col::white : col::text);
            const auto weak   = lit ? col::bg : col::dim;

            // MODEL cell: tree prefix, name, "by creator", CURRENT marker -- clipped to its column
            {
                g.saveState();
                g.reduceClipRegion (rr.withWidth (modelColW - 4));
                int x = rr.getX();
                auto run = [&] (const String& s, juce::Colour c)
                {
                    g.setColour (c);
                    g.drawText (s, x, rr.getY(), textW (s) + 2, rr.getHeight(), juce::Justification::centredLeft, false);
                    x += textW (s);
                };
                run (row.treePrefix, weak);
                run (row.name, strong);
                if (row.creator.isNotEmpty()) run (" by " + row.creator, weak);
                if (row.pending) run ("  (not sent yet)", weak);
                if (current) run ("  CURRENT", lit ? col::bg : col::white);
                g.restoreState();
            }

            for (auto& c : cols)
            {
                const auto cell = juce::Rectangle<int> (c.x, rr.getY(), c.w, rr.getHeight()).reduced (4, 0);
                const auto j = c.centreAlign ? juce::Justification::centred : juce::Justification::centredLeft;
                switch (c.kind)
                {
                    case ColKind::created: g.setColour (strong); g.drawText (dateText (row.created), cell, j, false); break;
                    case ColKind::edited:  g.setColour (strong); g.drawText (dateText (row.edited), cell, j, false); break;
                    case ColKind::state:   g.setColour (strong); g.drawText (row.state, cell, j, false); break;
                    case ColKind::contrib: g.setColour (strong); g.drawText (String (row.contributors), cell, j, false); break;
                    case ColKind::votes:
                    {
                        const String upT = kUp + String (row.up), downT = kDown + String (row.down);
                        const int upW = textW (upT), downW = textW (downT);
                        constexpr int votesGap = 4;
                        const int gx = cell.getX() + (cell.getWidth() - (upW + votesGap + downW)) / 2;
                        g.setColour (row.myVote > 0 ? strong : weak);
                        g.drawText (upT, gx, cell.getY(), upW, cell.getHeight(), juce::Justification::centred, false);
                        g.setColour (row.myVote < 0 ? strong : weak);
                        g.drawText (downT, gx + upW + votesGap, cell.getY(), downW, cell.getHeight(), juce::Justification::centred, false);
                        break;
                    }
                }
            }
        }
        g.restoreState();
    }
}
