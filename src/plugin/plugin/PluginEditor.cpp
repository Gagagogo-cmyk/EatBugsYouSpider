#include "PluginEditor.h"
#include "../core/Handoff.h"
#include "ui/NotationCard.h"
#include "ui/ModelMenu.h"
#include "../core/ModelTree.h"
#include "../core/Jobs.h"
#include "../core/Ids.h"
#include "../core/JsonIo.h"

namespace gnumbat
{
    using juce::String;
    using juce::var;

    GnumbatEditor::GnumbatEditor (GnumbatProcessor& p)
        : AudioProcessorEditor (&p), proc (p), capture (p, *this), bankPane (model, *this), mapPane (model, *this), inspector (model, *this)
    {
        setLookAndFeel (&laf);
        juce::LookAndFeel::setDefaultLookAndFeel (&laf);
        setOpaque (true);
        // Runs on the whole window's already-rendered, already-anti-aliased pixels (this
        // component and every child painted inside it -- capture strip, Bank/Map, dialogs);
        // a popup menu or tooltip is its own separate native window, so it isn't reached by
        // this. See ThresholdEffect's own comment in Theme.h for why this exists at all.
        setComponentEffect (&thresholdFx);

        addAndMakeVisible (capture);
        addAndMakeVisible (bankPane);
        addChildComponent (mapPane);   // one of Bank/Map is shown at a time -- see showTab()/resized()

        // Gnumbat's own source lives at <EBYS>/src/plugin, so it is linked to that EBYS repo
        // de facto -- no folder to choose, nothing to unlink. refreshEbys() below (and again on
        // a timer) just resolves it and reads the instrument's currently active session.
        refreshEbys();
        for (auto* b : { &bankTab, &mapTab, &lexiconTab }) { b->setClickingTogglesState (false); addAndMakeVisible (*b); }
        bankTab.onClick = [this] { showTab (false); };
        mapTab.onClick = [this] { showTab (true); };
        lexiconTab.onClick = [this] { showSpectromorphologyLexicon(); };   // same "select, don't toggle" as the "(?)" button
        lexiconFitButton.setTooltip ("Fit the whole tree in view (F)");
        lexiconFitButton.onClick = [this] { lexicon.fitView(); lexicon.repaint(); };
        addChildComponent (lexiconFitButton);   // hidden until the Lexicon is actually selected -- see showLexiconInline()/showTab()
        addChildComponent (lexicon);
        lexicon.onClose = [this] { showTab (mapShown); };   // the tree's own X / Escape: back to whichever of Library/Map was active before
        // No separate "<" button in the header any more: clicking the model name in the
        // capture panel's credit line opens the Model menu (see CapturePanel::onModelClick).
        capture.onModelClick = [this] { openModelMenu(); };
        addAndMakeVisible (loginBar);
        account.addChangeListener (this);
        capture.onTitleLayout = [this] { layoutLoginBar(); };
        account.validateStoredLogin();   // a saved login that has since expired quietly logs out
        // The MODEL page: clicking a model makes it current and enters the next page.
        addChildComponent (modelPage);
        modelPage.onSelect = [this] (juce::String id) { setCurrentModel (id); showModelPage (false); };
        modelPage.onBack = [this] { if (currentModelId.isNotEmpty()) showModelPage (false); };
        // no dedicated "start worker" button: BAKE (and every other job-queuing action) already
        // calls model.ensureWorker() itself. The worker status text in the header is the one
        // fallback -- click it to retry if autostart is off or the process died.

        capture.onShowLexicon = [this] { showSpectromorphologyLexicon(); };

        capture.onImport = [this]
        {
            chooser = std::make_unique<juce::FileChooser> ("Import audio as Bakes", juce::File(), "*.wav;*.aif;*.aiff;*.flac;*.mp3;*.ogg");
            chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectMultipleItems | juce::FileBrowserComponent::canSelectFiles,
                                  [this] (const juce::FileChooser& fc) { beginImport (fc.getResults()); });
        };
        capture.onBake = [this] { beginBake(); };   // BAKE lives on CapturePanel again, top-right of the capture strip

        if (auto r = model.openLibrary (model.settings().libraryRoot()); r.failed())
            notify (r.getErrorMessage(), true);
        // One-time, per library: the OS login name the plugin used to write as creator / voter
        // becomes this machine's anonymous identity (Settings::localIdentity()).
        {
            // Also mirrored into AppModel's in-memory settings, so a later save of that copy (e.g.
            // choosing a library) can't drop them and hand this machine a new identity next launch.
            const auto me = Settings::localIdentity();
            model.settings().set ("local_identity", me);
            if (model.hasLibrary())
            {
                const auto flag = "identity_migrated:" + model.root().getFullPathName();
                auto st = Settings::load();
                if (! (bool) st.get (flag, false))
                {
                    replaceIdentity (model.root(), juce::SystemStats::getLogonName(), me);
                    st.set (flag, true);
                    st.save();
                    model.refreshNow();
                }
                model.settings().set (flag, true);
            }
        }
        attachHub();
        restoreUi();
        model.addChangeListener (this);
        changeListenerCallback (nullptr);
        // A fresh instance (no model picked yet) opens on the MODEL page; one that already has a
        // model goes straight to the capture + LIBRARY page.
        if (currentModelId.isEmpty()) showModelPage (true);

        setResizable (true, true);
        // Small by default and small at the floor: the previous 1200x800 default (680x440
        // minimum) opened far bigger than a lot of DAW plugin-window viewports, which is what
        // was clipping BAKE and the right-hand table columns off-screen. CapturePanel's own
        // layout (see its resized()) no longer assumes any fixed pixel budget either, so nothing
        // here gets cut off at this smaller floor.
        setResizeLimits (380, 260, 2600, 1800);
        setSize (640, 318);   // default window: wide, short (matches the size Alex settled on in REAPER)
        startTimerHz (2);
    }

    GnumbatEditor::~GnumbatEditor()
    {
        setComponentEffect (nullptr);   // thresholdFx is a member; detach before it's destroyed
        stopTimer();
        model.removeChangeListener (this);
        account.removeChangeListener (this);
        if (hub != nullptr) { hub->removeChangeListener (this); hub->setFastPolling (false); }
        saveUi();
        dialog.reset();
        // only clear the global default if it's still ours -- with more than one editor open at
        // once (several tracks), the last-constructed one's laf otherwise wins for everybody's
        // popups; not clearing a default set by an editor that outlived this one would dangle.
        if (&juce::LookAndFeel::getDefaultLookAndFeel() == &laf) juce::LookAndFeel::setDefaultLookAndFeel (nullptr);
        setLookAndFeel (nullptr);
    }

    // ---------------------------------------------------------------------------------------------------------- state
    void GnumbatEditor::restoreUi()
    {
        mapShown = proc.getUiState ("tab", "bank").toString() == "map";
        model.setSearch (proc.getUiState ("search", "").toString());
        if (auto* chips = proc.getUiState ("chips", {}).getArray()) { juce::Array<var> c = *chips; model.setChips (c); }
        model.setSort (proc.getUiState ("sort", "created").toString(), (bool) proc.getUiState ("sort_asc", false));
        if (auto sp = proc.getUiState ("map_space", "spectral").toString(); sp.isNotEmpty()) model.setMapSpace (sp);
        const auto cm = proc.getUiState ("colour_by", "").toString();
        if (cm.isNotEmpty()) mapPane.setColourModeByText (cm);
        lastProfileId = proc.getUiState ("profile", "np_freeform").toString();
        {
            // No silent default any more: until a model is picked (on the MODEL page, which a fresh
            // instance opens on), there is none.
            auto storedModelId = proc.getUiState ("model_id", "").toString();
            setCurrentModel (storedModelId);   // also resolves + caches model_name, even if the id is unchanged
        }
        capture.refreshFromPlan();
        showTab (mapShown);
    }

    void GnumbatEditor::saveUi()
    {
        proc.setUiState ("tab", mapShown ? "map" : "bank");
        proc.setUiState ("search", model.search());
        proc.setUiState ("chips", var (model.chips()));
        proc.setUiState ("sort", model.sortKey());
        proc.setUiState ("sort_asc", model.sortAscending());
        proc.setUiState ("map_space", model.mapSpace());
        proc.setUiState ("colour_by", mapPane.colourMode());
        proc.setUiState ("profile", lastProfileId);
        proc.setUiState ("model_id", currentModelId);
    }

    void GnumbatEditor::showTab (bool map)
    {
        mapShown = map;
        lexiconShown = false;
        lexicon.setVisible (false);
        lexiconFitButton.setVisible (false);
        bankPane.setVisible (! map);
        mapPane.setVisible (map);
        bankTab.setToggleState (! map, juce::dontSendNotification);
        mapTab.setToggleState (map, juce::dontSendNotification);
        lexiconTab.setToggleState (false, juce::dontSendNotification);
        // [brackets] mark whichever tab is currently selected -- drawn by TerminalLookAndFeel
        // itself off getToggleState() (see Theme.cpp::drawButtonText), never folded into the
        // button's own label, so switching tabs never resizes or re-centres the word itself (an
        // estimated/approximate value gets a "~" suffix instead, so the two meanings never
        // collide). No re-layout needed here any more -- the label text never changes.
        // Bank gets focused on its inner table now, not the BankView container itself -- that's
        // what lets the table's native arrow-key row navigation actually receive the key events
        // (see BankView::focusTable()).
        if (isShowing()) { if (map) mapPane.grabKeyboardFocus(); else bankPane.focusTable(); }   // not showable yet during construction
        repaint();
    }

    void GnumbatEditor::changeListenerCallback (juce::ChangeBroadcaster* source)
    {
        repaint (bottomRect);   // the account links change with the login state (and the hub indicator lives there)
        if (hub != nullptr && source == hub.get())
        {
            // The shared model list changed (here, on the website, or the hub came/went): a model
            // created offline may have its real id now, and a rename on the website shows up here.
            setCurrentModel (hub->resolve (currentModelId));
            if (modelPageShown) modelPage.refresh (hub->libraryRoot(), currentModelId);
            return;
        }
        if (model.lastMessage.isNotEmpty()) { notify (model.lastMessage, false); model.lastMessage = {}; }
        // Open with a Bake already selected (the first one in the Library's current order), so the
        // PLAY row and details are there straight away. Only once per editor: after that, an empty
        // selection is the user's choice and stays empty.
        if (! autoSelected && model.selection().isEmpty() && ! model.visible().empty())
        {
            autoSelected = true;
            const auto& row = model.rows()[(size_t) model.visible().front()];
            model.setSelection ({ row.id }, row.id);
        }
        else if (! model.selection().isEmpty())
        {
            autoSelected = true;
        }
    }

    void GnumbatEditor::timerCallback()
    {
        if (statusUntil != 0 && juce::Time::currentTimeMillis() > statusUntil) { status = {}; statusUntil = 0; repaint (statusRect); }
        if (juce::Time::currentTimeMillis() - lastEbysCheck > 3000) refreshEbys();      // the instrument's session can change under us
        layoutLoginBar();   // cheap; keeps the account fields centred if the host/track name changed
    }

    void GnumbatEditor::notify (const String& msg, bool isError)
    {
        status = msg.replaceCharacter ('\n', ' ');
        statusIsError = isError;
        statusUntil = juce::Time::currentTimeMillis() + (isError ? 12000 : 6000);
        repaint (statusRect);
    }

    // ---------------------------------------------------------------------------------------------------------- layout
    void GnumbatEditor::paint (juce::Graphics& g)
    {
        g.fillAll (ui::col::bg);
        // No separate worker LED/status readout: starting the worker is implied by BAKE itself
        // (model.ensureWorker() is called wherever a job gets queued), and per-tool progress for
        // whichever Bake is actually processing lives on that Bake -- see InspectorView's
        // ANALYSIS section -- not as a standing global widget up here.

        // status line in its own thin row below the tabs: white for a failure (the same "needs
        // attention" language as everything else), green for ordinary good news, nothing
        // painted when there's none.
        // ---- bottom line: account links from the left margin ("register  forgot password" logged
        // out, "log out" logged in); the login fields, on the right margin -- where the credit used
        // to sit (the credit itself swapped up to the top line's free middle gap, where the login
        // fields used to be -- see CapturePanel::paint()). Links grey, white under the pointer;
        // "register" also stays white while its two steps are showing (click it again, or Escape,
        // to go back to logging in).
        if (! bottomRect.isEmpty() && ! modelPageShown)
        {
            g.setFont (ui::mono());
            const auto row = bottomRect.reduced (10, 0);
            auto textW = [] (const String& t) { return juce::GlyphArrangement::getStringWidthInt (ui::mono(), t); };
            linkRects.clear();
            auto link = [&] (Link l, const String& text, int x, bool lit)
            {
                const int w = textW (text);
                const juce::Rectangle<int> r (x, row.getY(), w, row.getHeight());
                g.setColour (lit || hoverLink == l ? ui::col::white : ui::col::text);
                g.drawText (text, r.withWidth (w + 2), juce::Justification::centredLeft, false);
                linkRects.push_back ({ l, r.expanded (3, 0) });
                return r.getRight();
            };
            constexpr int gap = 12;
            // hub indicator: "hub on" / "hub off (2 queued)" -- is the shared model list live?
            // Centred on the window (same "centred, falls back to the free gap" language the
            // credit line uses -- see CapturePanel::paint()), between the account links on the
            // left and the login fields on the right; dropped entirely if neither side leaves
            // enough room for it at all.
            auto drawHub = [&] (int from, int loginX)
            {
                if (hub == nullptr) return;
                const auto t = hub->statusText();
                const int w = textW (t);
                if (from + w + gap > loginX) return;
                int hx = getWidth() / 2 - w / 2;
                if (hx < from || hx + w > loginX) hx = from;
                g.setColour (hub->connected() ? ui::col::text : ui::col::dim);
                g.drawText (t, juce::Rectangle<int> (hx, row.getY(), w + 2, row.getHeight()), juce::Justification::centredLeft, false);
            };
            int afterLinksX;
            if (account.loggedIn())
            {
                g.setColour (ui::col::white);
                // logged in: "log out" on the left margin (where "register" is when logged out)
                afterLinksX = link (Link::logout, "log out", row.getX(), false) + gap;
            }
            else
            {
                // "register" on the left margin, "forgot password" right after it.
                int x = link (Link::reg, "register", row.getX(), account.mode() != ui::Account::Mode::login) + gap;
                afterLinksX = link (Link::forgot, "forgot password", x, false) + gap;
            }
            // The login fields sit flush on the right margin -- exactly where the credit used to be
            // right-aligned -- falling back to right after the links (like the credit did) if the
            // window's too narrow for both.
            const int loginW = juce::jmin (ui::LoginBar::preferredWidth(), row.getWidth());
            const int loginX = juce::jmax (afterLinksX, row.getRight() - loginW);
            drawHub (afterLinksX, loginX);
            loginBar.setBounds (loginX, row.getY(), juce::jmax (0, loginW), row.getHeight());
        }

        if (status.isNotEmpty())
        {
            g.setColour (ui::col::green);   // every status message, errors included, reads the same green
            g.setFont (ui::mono());
            g.drawText (status, statusRect.reduced (6, 0), juce::Justification::centredLeft, true);
        }
    }

    void GnumbatEditor::resized()
    {
        auto whole = getLocalBounds();
        modelPage.setBounds (whole);
        auto r = whole;
        capture.setBounds (r.removeFromTop (96));   // tall enough for the stacked L/R VU meters + their dB readouts
        // bottom line: account links left/right
        bottomRect = r.removeFromBottom (19);   // one line: account links
        tabsRect = r.removeFromTop (16);
        {
            // Each tab is sized to its own (fixed -- see showTab()) label, not a fixed 52px slot
            // -- a fixed slot left a lot of empty space around text this short, which read as a
            // much bigger gap between BANK and MAP than the 2-4px explicit gap alone would
            // suggest. Measured off the literal words rather than bankTab/mapTab.getButtonText()
            // -- same reasoning CapturePanel gives bakeW its own literal "BAKE" -- so this stays
            // correct regardless of what either button's text happens to be at the time.
            // Each tab is exactly its word plus room for its selection brackets on both sides
            // ("[" + 1 px gap, see TerminalLookAndFeel::drawButtonText -- as tight as the bracket
            // can sit against the word and still read as its own glyph). "[LIBRARY]" as a whole
            // starts on the 10 px left margin -- its "[" sits exactly on it; MAP and LEXICON
            // follow right after, each with a small gap.
            auto t = tabsRect.reduced (0, 1);
            // FIT no longer lives on this row -- see lexicon.setBounds() below, it now sits in
            // the Lexicon panel's own bottom-left corner instead.
            const int bw = juce::jmax (juce::GlyphArrangement::getStringWidthInt (ui::mono(), "["),
                                       juce::GlyphArrangement::getStringWidthInt (ui::mono(), "]")) + 1;
            auto tabW = [&] (const char* word) { return juce::GlyphArrangement::getStringWidthInt (ui::mono(), word) + 2 * bw; };
            bankTab.setBounds (t.getX() + 8, t.getY(), tabW ("LIBRARY"), t.getHeight());   // 2 px left of the 10 px margin: the "[" glyph's own side bearing puts its ink on the margin
            t.setLeft (bankTab.getRight() + 2);
            mapTab.setBounds (t.removeFromLeft (tabW ("MAP")));
            t.setLeft (mapTab.getRight() + 2);
            lexiconTab.setBounds (t.removeFromLeft (tabW ("LEXICON")));
        }
        // The Lexicon gets the space right below the tabs row -- no 14 px status-strip gap for
        // it, since it has no status line of its own to show there (that's a Library/Map-only
        // readout, see below), and the extra height means more of the tree fits without being
        // cut off. Library/Map still get their own status row.
        lexicon.setBounds (r);
        {
            // FIT: bottom-left corner of the Lexicon panel itself now (was the tabsRect row) --
            // the same 10 px left margin every other left-edge control in this editor starts on,
            // sitting just above the Lexicon's own definition strip (a fixed 68 px when something
            // is selected -- see SpectromorphologyTree::resized() -- which is true from the very
            // first layout in practice, see its constructor) rather than overlapping that text.
            const int fitW = juce::GlyphArrangement::getStringWidthInt (ui::mono(), "FIT") + 8;
            const int fitH = 16;
            lexiconFitButton.setBounds (r.getX() + 10, r.getBottom() - 68 - fitH - 6, fitW, fitH);
        }
        statusRect = r.removeFromTop (14);
        // Library and Map: one at a time, filling the whole remaining width/height -- no more
        // inspector column eating the right edge either way.
        bankPane.setBounds (r);
        mapPane.setBounds (r);
        layoutLoginBar();
        if (dialog) dialog->setBounds (whole);
    }

    void GnumbatEditor::layoutLoginBar()
    {
        // Rough placement for the very first frame, before paint() has measured the account links'
        // own text -- flush against the bottom line's right margin, same as the credit used to sit
        // (the credit itself moved up to the top line's free middle -- see CapturePanel::paint()).
        // paint() repositions the fields precisely every frame once the links' width is known, the
        // same way it already works out linkRects itself.
        auto row = bottomRect.reduced (10, 0);
        const int w = juce::jmin (ui::LoginBar::preferredWidth(), row.getWidth());
        loginBar.setBounds (juce::jmax (row.getX(), row.getRight() - w), row.getY(), juce::jmax (0, w), row.getHeight());
    }

    void GnumbatEditor::clickLink (Link l)
    {
        switch (l)
        {
            case Link::reg:
                // toggles: start the two register steps, or (while in them) go back to log in
                if (account.mode() == ui::Account::Mode::login) account.beginRegister(); else account.backToLogin();
                loginBar.focusFirst();
                break;
            case Link::forgot: account.forgotPassword (loginBar.firstField()); break;
            case Link::logout: account.logout(); break;
            case Link::none:   break;
        }
    }

    void GnumbatEditor::mouseMove (const juce::MouseEvent& e)
    {
        Link h = Link::none;
        for (auto& lr : linkRects) if (lr.second.contains (e.getPosition())) h = lr.first;
        if (h != hoverLink) { hoverLink = h; repaint (bottomRect); }
        setMouseCursor (h != Link::none ? juce::MouseCursor::PointingHandCursor : juce::MouseCursor::NormalCursor);
    }

    void GnumbatEditor::mouseExit (const juce::MouseEvent&)
    {
        if (hoverLink != Link::none) { hoverLink = Link::none; repaint (bottomRect); }
    }

    void GnumbatEditor::mouseUp (const juce::MouseEvent& e)
    {
        if (! e.mouseWasClicked()) return;
        for (auto& lr : linkRects) if (lr.second.contains (e.getPosition())) { clickLink (lr.first); return; }
    }

    bool GnumbatEditor::keyPressed (const juce::KeyPress& k)
    {
        if (modelPageShown) return false;   // the MODEL page handles its own keys
        if (k == juce::KeyPress::tabKey) { showTab (! mapShown); return true; }
        // Enter = BAKE on this page (Enter on the MODEL page opens the selected model instead).
        if (k == juce::KeyPress::returnKey && ! dialogOpen()) { beginBake(); return true; }
        // commandModifier is JUCE's idiomatic "primary shortcut" modifier: Cmd on macOS, Ctrl
        // elsewhere -- so this reads as (control-B (Windows/Linux) / Cmd-B (Mac) for the
        // window's one primary action, same key everywhere the modifier itself is spelled out.
        if (k == juce::KeyPress ('b', juce::ModifierKeys::commandModifier, 0)) { beginBake(); return true; }
        if (k == juce::KeyPress ('l', juce::ModifierKeys::commandModifier, 0)) { chooseLibrary(); return true; }
        // the drop zone's click-to-browse is gone along with the box itself -- dropping files
        // anywhere on the window still imports them (see filesDropped()), and this is the one
        // remaining way to open the file chooser instead of dragging.
        if (k == juce::KeyPress ('i', juce::ModifierKeys::commandModifier, 0)) { if (capture.onImport) capture.onImport(); return true; }
        return false;
    }

    // ---------------------------------------------------------------------------------------------------------- dialogs
    void GnumbatEditor::showSpectromorphologyLexicon()
    {
        showLexiconInline (true);   // "(?)" and the LEXICON tab both just select it -- neither one toggles it closed
    }

    // The Lexicon is a normal third tab now, a peer of LIBRARY/MAP (see the header's own comment
    // on lexicon and on lexiconTab): [LIBRARY][MAP][LEXICON] stay visible all the time, and
    // whichever one is selected fills the same content rect below them (see resized()). The
    // capture panel above (title/host/loop/heard bar, BAKE) stays fully live throughout -- Baking
    // doesn't stop just because you're looking something up.
    void GnumbatEditor::showLexiconInline (bool show)
    {
        lexiconShown = show;
        lexicon.setVisible (show);
        bankPane.setVisible (! show && ! mapShown);
        mapPane.setVisible (! show && mapShown);
        bankTab.setToggleState (! show && ! mapShown, juce::dontSendNotification);
        mapTab.setToggleState (! show && mapShown, juce::dontSendNotification);
        lexiconTab.setToggleState (show, juce::dontSendNotification);
        lexiconFitButton.setVisible (show);
        if (show)
        {
            lexicon.grabKeyboardFocus();   // so Esc/F reach SpectromorphologyTree::keyPressed() right away
        }
        else if (isShowing())
        {
            if (mapShown) mapPane.grabKeyboardFocus(); else bankPane.focusTable();
        }
        repaint();
    }

    void GnumbatEditor::showDialog (std::unique_ptr<juce::Component> d)
    {
        dialog = std::move (d);
        addAndMakeVisible (*dialog);
        dialog->setBounds (getLocalBounds());
        dialog->toFront (true);
    }

    void GnumbatEditor::closeDialogSoon()
    {
        juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<GnumbatEditor> (this)]
        {
            if (safe != nullptr) { safe->dialog.reset(); safe->repaint(); }
        });
    }

    void GnumbatEditor::prompt (const String& title, const String& message, const juce::Array<ui::PromptField>& fields, const String& okText, std::function<void (juce::StringArray)> onOk)
    {
        auto card = std::make_unique<ui::DialogCard> (title, message);
        for (auto& f : fields) card->addField (f);
        card->addButton ("CANCEL");
        card->addButton (okText, true);
        auto* raw = card.get();
        card->onResult = [this, onOk] (int b, const juce::StringArray& v, const juce::Array<bool>&)
        {
            closeDialogSoon();
            if (b == 1 && onOk) onOk (v);
        };
        showDialog (std::move (card));
        raw->focusFirst();
    }

    void GnumbatEditor::confirm (const String& title, const String& message, const String& okText, std::function<void()> onYes, bool danger)
    {
        auto card = std::make_unique<ui::DialogCard> (title, message);
        card->addButton ("CANCEL");
        card->addButton (okText, true, danger);
        card->onResult = [this, onYes] (int b, const juce::StringArray&, const juce::Array<bool>&)
        {
            closeDialogSoon();
            if (b == 1 && onYes) onYes();
        };
        showDialog (std::move (card));
        if (dialog->isShowing()) dialog->grabKeyboardFocus();
    }

    void GnumbatEditor::attachHub()
    {
        const auto root = model.hasLibrary() ? model.root() : Settings::defaultLibraryRoot();
        if (hub != nullptr && hub->libraryRoot() == root) return;
        if (hub != nullptr) hub->removeChangeListener (this);
        hub = ui::ModelHub::forLibrary (root, model.settings().get ("hub_url", "").toString());
        hub->addChangeListener (this);
        hub->setFastPolling (modelPageShown);
        modelPage.setHub (hub);
    }

    void GnumbatEditor::openModelMenu() { showModelPage (true); }

    void GnumbatEditor::showModelPage (bool show)
    {
        modelPageShown = show;
        if (hub != nullptr) { hub->setFastPolling (show); if (show) hub->syncNow(); }
        if (show)
        {
            // Model lineage is per-library, not per-track/per-instance -- same reasoning as
            // chooseLibrary()'s own fallback for a not-yet-opened library.
            modelPage.refresh (model.hasLibrary() ? model.root() : Settings::defaultLibraryRoot(), currentModelId);
        }
        modelPage.setVisible (show);
        loginBar.setVisible (! show);
        for (auto* c : std::initializer_list<juce::Component*> { &capture, &bankTab, &mapTab, &lexiconTab }) c->setVisible (! show);
        bankPane.setVisible (! show && ! mapShown && ! lexiconShown);
        mapPane.setVisible (! show && mapShown && ! lexiconShown);
        lexicon.setVisible (! show && lexiconShown);
        lexiconFitButton.setVisible (! show && lexiconShown);
        if (show) { modelPage.toFront (false); modelPage.focusFirst(); }
        repaint();
    }

    void GnumbatEditor::setCurrentModel (const juce::String& id)
    {
        currentModelId = hub != nullptr ? hub->resolve (id) : id;
        juce::String name;
        if (currentModelId.isNotEmpty())
        {
            if (const auto* m = hub != nullptr ? hub->find (currentModelId) : nullptr) name = m->name;
            else if (hub == nullptr || ! hub->everLoaded() || ! hub->connected())
                name = proc.getUiState ("model_name", "").toString();   // no live list to check against: keep what we had
            if (name.isEmpty()) currentModelId = {};   // the shared list (live) no longer has it => none
        }
        // Kept live in proc's ui-state (not just written at shutdown -- see saveUi()) so
        // CapturePanel can read the current model's name straight off proc, the same way it
        // already reads hostName()/trackName(), without needing its own library/AppModel access.
        proc.setUiState ("model_id", currentModelId);
        proc.setUiState ("model_name", name);
        repaint();
    }

    // ---------------------------------------------------------------------------------------------------------- library chooser
    void GnumbatEditor::chooseLibrary()
    {
        chooser = std::make_unique<juce::FileChooser> ("Choose (or create) a Gnumbat library folder", model.hasLibrary() ? model.root() : Settings::defaultLibraryRoot(), "");
        chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories, [this] (const juce::FileChooser& fc)
        {
            const auto dir = fc.getResult();
            if (dir == juce::File()) return;
            if (auto r = model.openLibrary (dir); r.failed()) { notify (r.getErrorMessage(), true); return; }
            model.settings().save();
            attachHub();
            notify ("library: " + dir.getFileName());
        });
    }

    // ---------------------------------------------------------------------------------------------------------- EBYS hand-off
    bool GnumbatEditor::handoffActive() const { return ebysOk && model.settings().handoffEnabled(); }
    juce::String GnumbatEditor::autoLabel() const { return handoffActive() ? String ("auto (EBYS instrument)") : String ("auto"); }

    void GnumbatEditor::refreshEbys()
    {
        lastEbysCheck = juce::Time::currentTimeMillis();
        // Settings::ebysRoot() resolves this on its own now -- settings.json, then
        // GNUMBAT_EBYS_ROOT, then the EBYS repo this plugin was built from (baked in at compile
        // time, since Gnumbat's source lives at <EBYS>/src/plugin) -- so there is nothing left
        // to choose here, only to read back for the status text and for beginBake()'s detail line.
        const auto root = model.settings().ebysRoot();
        ebysOk = false;
        ebysSession = {};
        ebysStatus = "EBYS: not found";
        if (root != juce::File())
        {
            handoff::Target t;
            if (auto r = handoff::resolve (root, t, false); r.wasOk())
            {
                ebysOk = true;
                ebysSession = t.sessionId;
                ebysStatus = "EBYS: " + t.sessionId;
            }
            else ebysStatus = "EBYS: " + r.getErrorMessage();
        }
    }

    // ---------------------------------------------------------------------------------------------------------- bake
    juce::StringArray GnumbatEditor::decomposerChoices() const
    {
        auto d = model.snapshot().worker.decomposers;
        if (! model.snapshot().worker.alive) d = { "demucs", "testsplit" };     // worker not running yet: show what it usually offers
        return d;
    }

    void GnumbatEditor::beginBake()
    {
        if (dialog != nullptr) return;
        if (! model.hasLibrary()) { notify ("Choose a library folder first (Cmd/Ctrl+L).", true); return; }

        // 1. Copy the audio out of the ring NOW: the ring keeps overwriting itself while the user types.
        auto pc = proc.prepareCapture (proc.plan);
        if (! pc.ok) { notify (pc.problem, true); return; }

        String detail = pc.summary + "   ·   " + proc.hostName();
        if (handoffActive()) detail << "   ·   -> EBYS raw_uploads (" + ebysSession + ")";
        {
            Marker la, lb;                                     // a Bake's range is always the host's loop, never a typed one
            if (proc.loopMarkers (la, lb))
                detail << "   ·   " << ui::CapturePanel::formatMarker (la, proc.transport()) << " -> " << ui::CapturePanel::formatMarker (lb, proc.transport());
        }
        String warning;
        if (pc.coverage < 0.999)
            warning = "Only " + String (juce::roundToInt (pc.coverage * 100.0)) + " % of the requested span has been heard - the rest would be silence. The Bake will be marked partial.";

        auto profiles = model.lib().listProfiles();
        // Whatever's been jotted into the heard bar's own notation/tag field while listening
        // (CapturePanel::notationText()) seeds the dialog instead of it opening blank -- the
        // dialog itself is still the one place that actually commits it.
        auto card = std::make_unique<ui::NotationCard> ("Notate this Bake", detail, capture.notationText(), profiles, lastProfileId, decomposerChoices(), true, warning, autoLabel());
        auto shared = std::make_shared<NewBake> (std::move (pc.bake));
        card->onDone = [this, shared] (ui::NotationCard::Result r)
        {
            closeDialogSoon();
            if (! r.accepted) { notify ("capture discarded"); return; }
            capture.clearNotation();                       // only once the Bake is actually accepted -- a discarded
                                                             // capture leaves it in place, nothing was lost by baking
            lastProfileId = json::getString (r.profile, "profile_id", "np_freeform");
            auto nb = std::move (*shared);
            nb.rawNotation = r.rawNotation;
            nb.modelId = currentModelId;                  // which Model's lineage this Bake belongs to
            nb.profile = r.profile;
            nb.extraTags = r.extraTags;
            nb.submit = r.decompose || true;                              // analysis always runs; `decompose` picks whether stems are made
            nb.decomposer = r.decompose ? (r.decomposer.isEmpty() ? model.settings().decomposer() : r.decomposer) : String ("skip");
            runBake (std::move (nb), r.rawNotation.isEmpty() ? String ("Bake") : r.rawNotation);
        };
        auto* raw = card.get();
        showDialog (std::move (card));
        raw->focusFirst();
    }

    void GnumbatEditor::runBake (NewBake nb, const String& label)
    {
        const auto root = model.root();
        auto settings = model.settings().deepCopy();
        nb.handoff.enabled = handoffActive();
        nb.handoff.ebysRoot = settings.ebysRoot();
        notify ("writing Bake ...");
        juce::Thread::launch ([nb = std::move (nb), root, settings, label, safe = juce::Component::SafePointer<GnumbatEditor> (this)]() mutable
        {
            String id, warn, hs;
            Library lib (root);
            auto r = lib.createBake (nb, id, &warn);
            if (r.wasOk()) hs = json::getString (lib.readBake (id), "handoff/status");
            if (r.wasOk() && settings.autostartWorker()) launchWorker (settings, root);
            juce::MessageManager::callAsync ([safe, r, id, label, warn, hs]
            {
                if (safe != nullptr) safe->bakeFinished (r, id, label, warn, hs);
            });
        });
    }

    void GnumbatEditor::bakeFinished (const juce::Result& r, const String& id, const String& label, const String& warning, const String& handoffStatus)
    {
        if (r.failed()) { notify ("BAKE FAILED: " + r.getErrorMessage(), true); return; }
        model.refreshNow();
        if (hub != nullptr)
        {
            // Tell the shared model list about it (panel.html counts it too); queued if the hub is off.
            const auto bake = model.lib().readBake (id);
            const auto sem = model.lib().readSemantic (id);
            const auto mid = json::getString (bake, "model_id");
            if (mid.isNotEmpty())
                hub->addBake (mid, id, json::getString (sem, "raw_notation", label), json::getNumber (sem, "fields/duration_bars"));
        }
        model.setSelection ({ id }, id);
        String msg = "baked " + ids::shortId (id) + "  \"" + label.substring (0, 40) + "\"";
        msg << (handoffStatus == "written" ? "  -> sent to EBYS raw_uploads: its Demucs + FluCoMa take over; analysis here starts now"
                                           : "  - stems + analysis are queued");
        if (warning.isNotEmpty()) msg << "   ! " << warning;
        notify (msg, warning.isNotEmpty());
    }

    // ---------------------------------------------------------------------------------------------------------- import / drag & drop
    static bool decodeAudio (const juce::File& f, CapturedAudio& out, String& err)
    {
        juce::AudioFormatManager fm;
        fm.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> rd (fm.createReaderFor (f));
        if (rd == nullptr) { err = "cannot read " + f.getFileName() + " (unsupported or corrupt)"; return false; }
        if (rd->sampleRate < 8000.0 || rd->lengthInSamples < 1) { err = f.getFileName() + " is empty"; return false; }
        if ((double) rd->lengthInSamples / rd->sampleRate > 20.0 * 60.0) { err = f.getFileName() + " is longer than 20 minutes - trim it first (a Bake is a musical phrase, not an album)"; return false; }
        const int n = (int) rd->lengthInSamples;
        juce::AudioBuffer<float> buf ((int) rd->numChannels, n);
        if (! rd->read (&buf, 0, n, 0, true, true)) { err = "read error in " + f.getFileName(); return false; }
        out.sampleRate = rd->sampleRate;
        out.channels.resize ((size_t) buf.getNumChannels());
        for (int c = 0; c < buf.getNumChannels(); ++c)
            out.channels[(size_t) c].assign (buf.getReadPointer (c), buf.getReadPointer (c) + n);
        return true;
    }

    bool GnumbatEditor::isInterestedInFileDrag (const juce::StringArray& files)
    {
        juce::AudioFormatManager fm;
        fm.registerBasicFormats();
        for (auto& f : files) if (fm.findFormatForFileExtension (juce::File (f).getFileExtension()) != nullptr) return dialog == nullptr;
        return false;
    }

    void GnumbatEditor::filesDropped (const juce::StringArray& files, int, int)
    {
        juce::Array<juce::File> fs;
        for (auto& f : files) fs.add (juce::File (f));
        beginImport (fs);
    }

    void GnumbatEditor::beginImport (const juce::Array<juce::File>& files)
    {
        if (! model.hasLibrary()) { notify ("Choose a library folder first (Cmd/Ctrl+L).", true); return; }
        for (auto& f : files) if (f.existsAsFile()) importQueue.add (f);
        if (dialog == nullptr) importNext();
    }

    void GnumbatEditor::importNext()
    {
        if (importQueue.isEmpty() || dialog != nullptr) return;
        const auto file = importQueue.removeAndReturn (0);
        notify ("reading " + file.getFileName() + " ...");
        juce::Thread::launch ([file, safe = juce::Component::SafePointer<GnumbatEditor> (this)]
        {
            auto audio = std::make_shared<CapturedAudio>();
            String err;
            const bool ok = decodeAudio (file, *audio, err);
            juce::MessageManager::callAsync ([safe, file, audio, ok, err]
            {
                if (safe == nullptr) return;
                if (! ok) { safe->notify (err, true); safe->importNext(); return; }
                auto& me = *safe;
                const String detail = file.getFileName() + "   ·   " + String ((double) audio->frames() / audio->sampleRate, 2) + " s   ·   " + String (audio->numChannels()) + " ch   ·   imported";
                auto card = std::make_unique<ui::NotationCard> ("Notate imported audio", detail, file.getFileNameWithoutExtension(), me.model.lib().listProfiles(), me.lastProfileId, me.decomposerChoices(), true, juce::String(), me.autoLabel());
                card->onDone = [&me, audio, file] (ui::NotationCard::Result r)
                {
                    me.closeDialogSoon();
                    if (r.accepted)
                    {
                        me.lastProfileId = json::getString (r.profile, "profile_id", "np_freeform");
                        NewBake nb;
                        nb.audio = std::move (*audio);
                        nb.isImport = true;
                        nb.importOriginalName = file.getFileName();
                        nb.importSourcePath = file.getFullPathName();
                        nb.rawNotation = r.rawNotation;
                        nb.modelId = me.currentModelId;
                        nb.profile = r.profile;
                        nb.extraTags = r.extraTags;
                        nb.decomposer = r.decompose ? (r.decomposer.isEmpty() ? me.model.settings().decomposer() : r.decomposer) : String ("skip");
                        me.runBake (std::move (nb), r.rawNotation.isEmpty() ? file.getFileNameWithoutExtension() : r.rawNotation);
                    }
                    juce::MessageManager::callAsync ([safe = juce::Component::SafePointer<GnumbatEditor> (&me)] { if (safe != nullptr) safe->importNext(); });
                };
                auto* raw = card.get();
                me.showDialog (std::move (card));
                raw->focusFirst();
            });
        });
    }

    bool GnumbatEditor::shouldDropFilesWhenDraggedExternally (const juce::DragAndDropTarget::SourceDetails& d, juce::StringArray& files, bool& canMove)
    {
        if (json::getString (d.description, "kind") != "bakes" || ! model.hasLibrary()) return false;
        if (auto* ids_ = d.description.getProperty ("ids", {}).getArray())
            for (auto& id : *ids_)
            {
                const auto f = model.lib().audioFile (id.toString());
                if (f.existsAsFile()) files.add (f.getFullPathName());
            }
        canMove = false;
        return ! files.isEmpty();
    }
}
