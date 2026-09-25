#include "InspectorView.h"
#include "BankView.h"
#include "Theme.h"
#include "../../core/Ids.h"
#include "../../core/JsonIo.h"
#include <utility>

namespace gnumbat::ui
{
    using juce::String;
    using juce::var;

    InspectorView::InspectorView (AppModel& m, UiHost& h) : model (m), host (h)
    {
        notes.setMultiLine (true, true);
        notes.setReturnKeyStartsNewLine (true);
        notes.setFont (mono());
        notes.setTextToShowWhenEmpty ("notes (free text)", col::dim);
        notes.onFocusLost = [this] { saveNotes(); };
        addChildComponent (notes);
        model.addChangeListener (this);
        reload();
    }

    InspectorView::~InspectorView() { model.removeChangeListener (this); }

    void InspectorView::changeListenerCallback (juce::ChangeBroadcaster*) { reload(); repaint(); }

    void InspectorView::reload()
    {
        const auto id = model.selection().size() == 1 ? model.selection()[0] : String();
        const auto* row = model.rowById (id);
        view = row ? row->view : var();
        if (id != shownId || (row != nullptr && (int) json::getNumber (row->view, "rev") != notesRev))
        {
            shownId = id;
            bake = sem = state = var();
            if (row != nullptr)
            {
                bake = model.lib().readBake (id);
                sem = model.lib().readSemantic (id);
                state = model.lib().readState (id);
                if (notesLoadedFor != id || ! notes.hasKeyboardFocus (true))
                {
                    notes.setText (json::getString (sem, "notes"), false);
                    notesLoadedFor = id;
                }
                notesRev = (int) json::getNumber (sem, "rev");
            }
        }
        else if (row != nullptr)
        {
            state = model.lib().readState (id);              // progress + history move without a semantic rev change
        }
    }

    void InspectorView::saveNotes()
    {
        if (shownId.isEmpty()) return;
        if (notes.getText() == json::getString (sem, "notes")) return;
        SemanticEdit e;
        e.setNotes = true; e.notes = notes.getText();
        if (auto err = model.editSemantic ({ shownId }, e); err.isNotEmpty()) host.notify (err, true);
    }

    void InspectorView::placeNotes()
    {
        notes.setVisible (! notesRect.isEmpty());
        if (! notesRect.isEmpty()) notes.setBounds (notesRect.translated (0, -scrollY));
    }

    void InspectorView::resized()
    {
        contentHeight = draw (nullptr, getWidth() - 10);
        scrollY = juce::jlimit (0, juce::jmax (0, contentHeight - getHeight()), scrollY);
        placeNotes();
    }

    void InspectorView::paint (juce::Graphics& g)
    {
        g.fillAll (col::panel);
        contentHeight = draw (nullptr, getWidth() - 10);          // measure + build zones
        scrollY = juce::jlimit (0, juce::jmax (0, contentHeight - getHeight()), scrollY);
        placeNotes();
        g.saveState();
        g.reduceClipRegion (getLocalBounds());
        g.setOrigin (0, -scrollY);
        draw (&g, getWidth() - 10);
        g.restoreState();
        if (contentHeight > getHeight())
        {
            const float f = (float) getHeight() / (float) contentHeight;
            g.setColour (col::grey);
            g.fillRect (getWidth() - 4, (int) ((float) scrollY * f), 3, (int) ((float) getHeight() * f));
        }
    }

    void InspectorView::mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails& w)
    {
        scrollY = juce::jlimit (0, juce::jmax (0, contentHeight - getHeight()), scrollY - (int) (w.deltaY * 260.0f));
        placeNotes();
        repaint();
    }

    void InspectorView::mouseUp (const juce::MouseEvent& e)
    {
        if (e.mouseWasDraggedSinceMouseDown()) return;
        const auto p = e.getPosition().translated (0, scrollY);
        for (auto& z : zones) if (z.r.contains (p) && z.act) { z.act(); return; }
    }

    void InspectorView::mouseMove (const juce::MouseEvent& e)
    {
        const auto p = e.getPosition().translated (0, scrollY);
        bool hit = false;
        for (auto& z : zones) if (z.r.contains (p) && z.act) { hit = true; setTooltip (z.tip); break; }
        setMouseCursor (hit ? juce::MouseCursor::PointingHandCursor : juce::MouseCursor::NormalCursor);
        if (! hit) setTooltip ({});
    }

    // ---------------------------------------------------------------------------------------------------------------
    int InspectorView::draw (juce::Graphics* gp, int width)
    {
        const bool measure = gp == nullptr;
        if (measure) { zones.clear(); notesRect = {}; }
        juce::Graphics dummyTarget (juce::Image (juce::Image::ARGB, 1, 1, false));
        juce::Graphics& g = gp != nullptr ? *gp : dummyTarget;
        const int X = 12, W = width - 2 * X;
        int y = 10;

        auto heading = [&] (const String& t)
        {
            y += 14;
            g.setColour (col::dim); g.setFont (mono());
            g.drawText (t, X, y, W, 14, juce::Justification::centredLeft);
            y += 20;
        };
        // text only -- no box. The clickable zone is still tracked for hit-testing/tooltips.
        auto button = [&] (int x, int bw, const String& label, std::function<void()> act, juce::Colour c = col::text, const String& tip = {})
        {
            juce::Rectangle<int> r (x, y, bw, 22);
            g.setColour (c); g.setFont (mono());
            g.drawText (label, r, juce::Justification::centred);
            if (measure) zones.push_back ({ r, std::move (act), tip });
            return x + bw + 6;
        };
        auto chipRow = [&] (const juce::StringArray& items, juce::Colour c, std::function<void (const String&)> onClick, const String& addLabel, std::function<void()> onAdd, const String& tip)
        {
            int x = X;
            // text only, no fill -- a wider gap between items is what marks where one ends and
            // the next begins now that there's no chip background to do it.
            auto place = [&] (const String& t, juce::Colour cc, std::function<void()> act)
            {
                const int cw = juce::GlyphArrangement::getStringWidthInt (mono(), t) + 10;
                if (x + cw > X + W) { x = X; y += 24; }
                juce::Rectangle<int> r (x, y, cw, 20);
                g.setColour (cc); g.setFont (mono()); g.drawText (t, r, juce::Justification::centred);
                if (measure && act) zones.push_back ({ r, std::move (act), tip });
                x += cw + 14;
            };
            for (auto& t : items) place (t, c, [=] { onClick (t); });
            place (addLabel, col::dim, onAdd);
            y += 26;
        };
        auto kv = [&] (const String& k, const String& v, juce::Colour c = col::text)
        {
            g.setFont (mono());
            g.setColour (col::dim); g.drawText (k, X, y, 96, 16, juce::Justification::centredLeft);
            g.setColour (c);        g.drawText (v, X + 100, y, W - 100, 16, juce::Justification::centredLeft, true);
            y += 17;
        };

        const auto& sel = model.selection();
        if (sel.isEmpty())
        {
            notesRect = {};
            return 0;
        }
        if (sel.size() > 1)
        {
            notesRect = {};
            g.setColour (col::white); g.setFont (mono());
            g.drawText (String (sel.size()) + " Bakes selected", X, y, W, 20, juce::Justification::centredLeft);
            y += 30;
            int x = X;
            x = button (x, 76, "+ TAG", [this, sel] { BankView::promptAddTag (model, host, sel); });
            x = button (x, 84, "+ GROUP", [this, sel] { BankView::promptAddGroup (model, host, sel); });
            x = button (x, 84, "+ FIELD", [this, sel] { BankView::promptSetField (model, host, sel); });
            y += 28; x = X;
            x = button (x, 100, "DATASET...", [this, sel] { BankView::promptDatasetMenu (model, host, this, sel); });
            x = button (x, 96, "REPROCESS", [this, sel] { model.reprocess (sel, "all"); });
            x = button (x, 76, "DELETE", [this, sel] { BankView::confirmTrash (model, host, sel); }, col::white);
            y += 34;
            heading ("SHARED TAGS");
            juce::StringArray common;
            if (auto* first = model.rowById (sel[0]))
                for (auto& t : json::getStrings (first->view, "tags"))
                {
                    bool all = true;
                    for (auto& id : sel) if (auto* r = model.rowById (id)) all = all && json::getStrings (r->view, "tags").contains (t, true);
                    if (all) common.add (t);
                }
            g.setColour (common.isEmpty() ? col::dim : col::text); g.setFont (mono());
            drawWrapped (g, common.isEmpty() ? String ("(none)") : common.joinIntoString ("  |  "), { X, y, W, 32 }, juce::Justification::topLeft, 2);
            y += 36;
            double total = 0; int ready = 0;
            for (auto& id : sel) if (auto* r = model.rowById (id)) { total += json::getNumber (r->view, "duration_s"); ready += json::getString (r->view, "state") == "READY"; }
            heading ("SUMMARY");
            kv ("total length", String (total, 1) + " s");
            kv ("READY", String (ready) + " / " + String (sel.size()), ready == sel.size() ? col::text : col::white);
            return y + 16;
        }

        // ---------------- single Bake
        const auto id = sel[0];
        const auto stateName = json::getString (view, "state");
        g.setColour (col::white); g.setFont (mono());
        g.drawText (ids::shortId (id), X, y, 110, 20, juce::Justification::centredLeft);
        g.setColour (col::forState (stateName)); g.setFont (mono());
        g.drawText (stateName, X + 112, y, W - 112, 20, juce::Justification::centredLeft);
        g.setColour (col::dim); g.setFont (mono());
        g.drawText (id, X, y + 20, W, 14, juce::Justification::centredLeft, true);
        y += 40;
        {
            int x = X;
            x = button (x, 74, "NOTATE", [this, id] { BankView::promptEditNotation (model, host, id); });
            x = button (x, 96, "DATASET...", [this, id] { BankView::promptDatasetMenu (model, host, this, { id }); });
            x = button (x, 88, "REPROC.", [this, id] { model.reprocess ({ id }, "all"); }, col::text, "re-run stems + analysis");
            x = button (x, 64, "MENU", [this, id] { BankView::showContextMenu (model, host, this, { id }); });
            y += 30;
        }
        if (stateName == "ERROR")
        {
            g.setColour (col::white); g.setFont (mono());
            drawWrapped (g, json::getString (state, "error/code") + ": " + json::getString (state, "error/message"), { X, y, W, 48 }, juce::Justification::topLeft, 3);
            y += 52;
        }

        // waveform: no box around it any more -- the peaks themselves are the only mark, drawn
        // straight onto the shared black.
        {
            juce::Rectangle<int> wr (X, y, W, 54);
            if (auto* peaks = bake.getProperty ("preview", {}).getProperty ("peaks", {}).getArray())
                if (peaks->size() > 1)
                {
                    g.setColour (col::text.withAlpha (0.85f));
                    const float mid = (float) wr.getCentreY(), amp = (float) wr.getHeight() * 0.45f;
                    for (int i = 0; i < peaks->size(); ++i)
                    {
                        const float x = (float) wr.getX() + 1.0f + (float) i / (float) peaks->size() * ((float) wr.getWidth() - 2.0f);
                        const float lo = (float) (double) (*peaks)[i][0], hi = (float) (double) (*peaks)[i][1];
                        g.drawVerticalLine ((int) x, mid - hi * amp - 0.5f, mid - lo * amp + 0.5f);
                    }
                }
            g.setColour (col::dim); g.setFont (mono());
            g.drawText (String (json::getNumber (view, "duration_s"), 2) + " s  ·  " + String ((int) json::getNumber (bake, "audio/sample_rate")) + " Hz  ·  " + String ((int) json::getNumber (bake, "audio/channels")) + " ch",
                        wr.reduced (4, 2), juce::Justification::bottomRight);
            y += 62;
        }

        heading ("NOTATION  (raw, as entered)");
        {
            const auto raw = json::getString (sem, "raw_notation");
            juce::AttributedString as;
            as.append (raw.isEmpty() ? String ("(none)") : raw, mono(), raw.isEmpty() ? col::dim : col::text);
            as.setWordWrap (juce::AttributedString::byChar);
            juce::TextLayout tl;
            tl.createLayout (as, (float) W);
            tl.draw (g, juce::Rectangle<float> ((float) X, (float) y, (float) W, tl.getHeight() + 2.0f));
            if (measure) zones.push_back ({ { X, y, W, (int) tl.getHeight() + 2 }, [this, id] { BankView::promptEditNotation (model, host, id); }, "click to edit" });
            y += (int) tl.getHeight() + 6;
            g.setColour (col::dim); g.setFont (mono());
            g.drawText ("profile: " + json::getString (sem, "notation_profile/id", "none") + " v" + String ((int) json::getNumber (sem, "notation_profile/version", 1)) + "   ·   rev " + String ((int) json::getNumber (sem, "rev")),
                        X, y, W, 14, juce::Justification::centredLeft);
            y += 4;   // tightened -- TAGS reads as directly attached to NOTATION, not a separately-spaced section
        }

        heading ("TAGS  (click to remove)");
        chipRow (json::getStrings (view, "tags"), col::text, [this, id] (const String& t) { SemanticEdit e; e.removeTags.add (t); model.editSemantic ({ id }, e); },
                 "+ tag", [this, id] { BankView::promptAddTag (model, host, { id }); }, "remove this tag");

        heading ("FIELDS");
        {
            auto* fo = json::get (view, "fields").getDynamicObject();
            int n = 0;
            if (fo != nullptr)
                for (auto& nv : fo->getProperties())
                {
                    const auto name = nv.name.toString();
                    const auto origin = json::getString (sem, "field_origin/" + name, "user");
                    g.setFont (mono());
                    g.setColour (col::dim);  g.drawText (name, X, y, 104, 16, juce::Justification::centredLeft, true);
                    g.setColour (col::text); g.drawText (nv.value.isArray() ? juce::JSON::toString (nv.value, true) : nv.value.toString(), X + 108, y, W - 108 - 22, 16, juce::Justification::centredLeft, true);
                    g.setColour (col::dim);  g.drawText (origin.substring (0, 1), X + W - 18, y, 18, 16, juce::Justification::centred);
                    if (measure) zones.push_back ({ { X, y, W, 16 }, [this, id] { BankView::promptSetField (model, host, { id }); }, origin + " - click to set a field" });
                    y += 17; ++n;
                }
            if (n == 0) { g.setColour (col::dim); g.setFont (mono()); g.drawText ("(none)", X, y, W, 16, juce::Justification::centredLeft); y += 17; }
            button (X, 80, "+ field", [this, id] { BankView::promptSetField (model, host, { id }); });
            y += 26;
        }

        heading ("GROUPS");
        chipRow (json::getStrings (view, "groups"), col::text, [this, id] (const String& t) { SemanticEdit e; e.removeGroups.add (t); model.editSemantic ({ id }, e); },
                 "+ group", [this, id] { BankView::promptAddGroup (model, host, { id }); }, "remove from this group");

        heading ("NOTES");
        if (measure) notesRect = { X, y, W, 64 };            // notes is a real child component: placed by placeNotes() after scrolling
        y += 72;

        heading ("CAPTURE");
        {
            const auto cap = json::get (view, "capture");
            if (json::getString (view, "origin") == "import")
                kv ("imported", json::getString (bake, "import/original_name"));
            else
            {
                kv ("host", json::getString (cap, "host/name", "-") + (json::getString (cap, "track_name").isEmpty() ? String() : " / " + json::getString (cap, "track_name")));
                const double bpm = json::getNumber (cap, "tempo_bpm");
                const auto ts = json::get (cap, "time_signature");
                kv ("tempo", bpm > 0 ? String (bpm, 1) + " bpm" + (ts.getArray() ? "  " + ts[0].toString() + "/" + ts[1].toString() : String()) : String ("-"));
                if (json::has (cap, "timeline"))
                    kv ("timeline", String ((juce::int64) json::getNumber (cap, "timeline/start_sample")) + " -> " + String ((juce::int64) json::getNumber (cap, "timeline/end_sample")) + " smp");
                const bool complete = json::getBool (cap, "complete", true);
                kv ("coverage", String (juce::roundToInt (json::getNumber (cap, "coverage", 1.0) * 100.0)) + " %" + (complete ? "" : "  (partial)"), complete ? col::text : col::white);
                kv ("mode", json::getString (cap, "mode", "-") + (json::getBool (cap, "offline") ? "  (offline bounce)" : ""));
            }
            kv ("created", json::getString (view, "created_at"));
            kv ("creator", json::getString (view, "creator").isEmpty() ? String ("-") : json::getString (view, "creator"));
            kv ("last edited", json::getString (view, "updated_at"));
        }

        heading ("ANALYSIS");
        {
            const auto card = json::get (state, "card");
            if (stateName == "DECOMPOSING" || stateName == "ANALYZING")
            {
                // demucs / flucoma / madmom / essentia each get their own % line when the worker
                // reports per-tool progress (state.progress.tools) -- they run at different points
                // in the same process_bake job, so this is the one place all of them show at once,
                // "implied in the bake process" rather than a separate worker-status widget.
                static const std::pair<const char*, const char*> kKnownTools[] = {
                    { "demucs", "demucs" }, { "instrument", "instrument" }, { "testsplit", "testsplit" },
                    { "pd-flucoma", "flucoma" }, { "python-ref", "flucoma (ref)" },
                    { "madmom", "madmom" }, { "essentia", "essentia" },
                };
                auto* tools = json::get (state, "progress/tools").getDynamicObject();
                bool any = false;
                if (tools != nullptr)
                    for (auto& t : kKnownTools)
                        if (tools->hasProperty (t.first))
                        {
                            const double f = (double) tools->getProperty (t.first);
                            kv (t.second, String (juce::roundToInt (f * 100.0)) + " %", f >= 0.999 ? col::green : col::text);
                            any = true;
                        }
                if (! any)     // an older worker with no per-tool breakdown yet: the one combined line
                    kv (stateName.toLowerCase(), String (juce::roundToInt (json::getNumber (state, "progress/fraction") * 100.0)) + " %  " + json::getString (state, "progress/message"), col::text);
            }
            auto stems = json::getStrings (card, "stems");
            if (stems.isEmpty()) if (auto* a = json::get (view, "stems").getArray()) for (auto& s : *a) stems.add (s.toString());
            kv ("stems", stems.isEmpty() ? String ("-") : stems.joinIntoString (" · "), stems.isEmpty() ? col::dim : col::text);
            if (const auto ho = json::getString (view, "handoff"); ho.isNotEmpty())
                kv ("instrument", ho == "waiting" ? String ("sent to raw_uploads · waiting for its Demucs stems")
                                : ho == "adopted" ? String ("stems adopted from the instrument")
                                                  : String ("hand-off failed (see bake.json > handoff)"),
                    ho == "adopted" ? col::text : ho == "waiting" ? col::dim : col::white);
            kv ("slices", json::has (card, "n_slices") ? String ((int) json::getNumber (card, "n_slices")) : String ("-"));
            // estimates are system-filled, never written to this Bake's tempo/key/genre fields --
            // marked with a "~" prefix, the same "approximate" mark tempo uses elsewhere.
            // [Brackets] mean something else here: which tab/menu option is currently selected.
            // Tempo/key prefer madmom's estimate when it ran (see analysis/__init__.py::assemble),
            // the mix's own onset/chroma analysis otherwise.
            const auto te = json::get (card, "tempo_estimate"), ke = json::get (card, "key_estimate"), me = json::get (card, "meter_estimate");
            kv ("est. tempo", json::isNumber (te) ? "~" + String ((double) te, 1) + " bpm" : String ("-"));
            kv ("est. key", ke.isString() ? "~" + ke.toString() : String ("-"));
            kv ("est. meter", json::isNumber (me) ? "~" + String ((int) me) + " beats/bar" : String ("-"));
            // essentia's genre classification: always just a suggestion -- genre is 100% user-set
            // and nothing here ever writes it anywhere; click "+ field" above to set it yourself.
            if (const auto ge = json::get (card, "genre_suggestion"); ge.isString())
            {
                const auto gc = json::get (card, "genre_confidence");
                kv ("genre (essentia)", "~" + ge.toString() + (json::isNumber (gc) ? "  " + String ((double) gc * 100.0, 0) + " %" : String()), col::dim);
            }
            if (auto* spark = json::get (card, "spark").getDynamicObject())
                for (auto& nv : spark->getProperties())
                {
                    auto* arr = nv.value.getArray();
                    if (arr == nullptr || arr->size() < 2) continue;
                    g.setFont (mono()); g.setColour (col::dim);
                    g.drawText (nv.name.toString(), X, y, 96, 16, juce::Justification::centredLeft, true);
                    juce::Path p;
                    double lo = 1e300, hi = -1e300;
                    for (auto& v : *arr) { lo = juce::jmin (lo, (double) v); hi = juce::jmax (hi, (double) v); }
                    const float sx = X + 100.0f, sw = (float) W - 100.0f;
                    for (int i = 0; i < arr->size(); ++i)
                    {
                        const float px = sx + (float) i / (float) (arr->size() - 1) * sw;
                        const float py = (float) y + 14.0f - (hi > lo ? (float) (((double) (*arr)[i] - lo) / (hi - lo)) : 0.5f) * 12.0f;
                        if (i == 0) p.startNewSubPath (px, py); else p.lineTo (px, py);
                    }
                    g.setColour (col::text.withAlpha (0.9f)); g.strokePath (p, juce::PathStrokeType (1.2f));
                    y += 17;
                }
            if (auto* hist = json::get (state, "history").getArray())
            {
                y += 4;
                g.setFont (mono());
                for (int i = juce::jmax (0, hist->size() - 5); i < hist->size(); ++i)
                {
                    g.setColour (col::forState (json::getString ((*hist)[i], "state")).withAlpha (0.8f));
                    g.drawText (json::getString ((*hist)[i], "at").substring (11, 19) + "  " + json::getString ((*hist)[i], "state") + " " + json::getString ((*hist)[i], "note"),
                                X, y, W, 14, juce::Justification::centredLeft, true);
                    y += 14;
                }
            }
        }

        heading ("RELATIONSHIPS");
        {
            auto ds = json::getStrings (view, "datasets"), ms = json::getStrings (view, "models");
            g.setFont (mono());
            g.setColour (col::dim); g.drawText ("datasets", X, y, 70, 16, juce::Justification::centredLeft);
            g.setColour (ds.isEmpty() ? col::dim : col::text);
            g.drawText (ds.isEmpty() ? String ("-") : ds.joinIntoString (", "), X + 74, y, W - 74, 16, juce::Justification::centredLeft, true);
            y += 17;
            g.setColour (col::dim); g.drawText ("models", X, y, 70, 16, juce::Justification::centredLeft);
            String mt = ms.isEmpty() ? String ("-") : ms.joinIntoString (", ");
            if (auto* tr = json::get (view, "training").getDynamicObject())
                for (auto& nv : tr->getProperties()) mt << "  [" << nv.name.toString() << " x" << nv.value.toString() << "]";
            g.setColour (ms.isEmpty() ? col::dim : col::text);
            g.drawText (mt, X + 74, y, W - 74, 16, juce::Justification::centredLeft, true);
            y += 20;
            int x = X;
            x = button (x, 86, "SAME SET", [this, id] { auto r = model.relatedIds ("dataset", id); model.setSelection (r, id); }, col::text, "select Bakes sharing a dataset with this one");
            x = button (x, 92, "SAME GROUP", [this, id] { auto r = model.relatedIds ("group", id); model.setSelection (r, id); });
            x = button (x, 84, "SAME TAG", [this, id] { auto r = model.relatedIds ("tag", id); model.setSelection (r, id); });
            y += 30;
        }
        return y + 12;
    }
}
