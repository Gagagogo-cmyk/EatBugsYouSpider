#pragma once
#include <juce_audio_utils/juce_audio_utils.h>
#include <vector>
#include "PluginProcessor.h"
#include "ui/Theme.h"
#include "ui/AppModel.h"
#include "ui/UiHost.h"
#include "ui/CapturePanel.h"
#include "ui/BankView.h"
#include "ui/MapView.h"
#include "ui/InspectorView.h"
#include "ui/ModelMenu.h"
#include "ui/ModelHub.h"
#include "ui/Account.h"
#include "ui/SpectromorphologyTree.h"

namespace gnumbat
{
    class GnumbatEditor final : public juce::AudioProcessorEditor,
                                public ui::UiHost,
                                public juce::DragAndDropContainer,
                                public juce::FileDragAndDropTarget,
                                private juce::ChangeListener,
                                private juce::Timer
    {
    public:
        explicit GnumbatEditor (GnumbatProcessor&);
        ~GnumbatEditor() override;

        void paint (juce::Graphics&) override;
        void resized() override;
        bool keyPressed (const juce::KeyPress&) override;
        void mouseMove (const juce::MouseEvent&) override;
        void mouseExit (const juce::MouseEvent&) override;
        void mouseUp (const juce::MouseEvent&) override;

        // UiHost
        void prompt (const juce::String&, const juce::String&, const juce::Array<ui::PromptField>&, const juce::String&, std::function<void (juce::StringArray)>) override;
        void confirm (const juce::String&, const juce::String&, const juce::String&, std::function<void()>, bool danger) override;
        void notify (const juce::String&, bool isError = false) override;

        // drag & drop
        bool isInterestedInFileDrag (const juce::StringArray&) override;
        void filesDropped (const juce::StringArray&, int, int) override;
        bool shouldDropFilesWhenDraggedExternally (const juce::DragAndDropTarget::SourceDetails&, juce::StringArray&, bool&) override;

        // exposed for tests
        ui::AppModel& appModel() { return model; }
        void showTab (bool map);
        void refreshEbys();                                   // re-resolve the EBYS repo + its active session (also called by a timer)
        bool handoffActive() const;
        juce::String ebysStatusText() const { return ebysStatus; }
        void beginBake();                              // same path as the BAKE button
        void beginImport (const juce::Array<juce::File>&);
        bool dialogOpen() const { return dialog != nullptr; }
        ui::CapturePanel& capturePanel() { return capture; }
        ui::MapView& mapView() { return mapPane; }
        ui::BankView& bankView() { return bankPane; }
        ui::ModelMenu& modelMenu() { return modelPage; }
        ui::Account& userAccount() { return account; }
        ui::LoginBar& loginFields() { return loginBar; }
        bool modelPageVisible() const { return modelPageShown; }
        ui::ModelHub* modelHub() { return hub.get(); }
        void showModelPage (bool show);                   // MODEL page <-> capture + LIBRARY/MAP page

    private:
        GnumbatProcessor& proc;
        ui::TerminalLookAndFeel laf;
        ui::ThresholdEffect thresholdFx;   // hard-edges every anti-aliased pixel JUCE still draws -- see Theme.h
        ui::AppModel model;
        ui::CapturePanel capture;
        ui::BankView bankPane;
        ui::MapView mapPane;
        ui::InspectorView inspector;
        std::shared_ptr<ui::ModelHub> hub;          // the shared model list (EBYS hub registry) -- see ui/ModelHub.h
        void attachHub();                           // (re)connect to this library's ModelHub
        ui::ModelMenu modelPage { model, *this };   // the MODEL page (a full page, not a popup) -- see showModelPage()
        bool modelPageShown = false;
        // Accounts (see ui/Account.h): the two fields centred in the top line, and the clickable
        // "register  forgot password" (logged out, left of the credit) or "log out" (logged in, at
        // the right) text in the bottom line.
        ui::Account account { model.settings(), *this };
        ui::LoginBar loginBar { account };
        juce::Rectangle<int> bottomRect;
        enum class Link { none, reg, forgot, logout };
        std::vector<std::pair<Link, juce::Rectangle<int>>> linkRects;
        Link hoverLink = Link::none;
        void layoutLoginBar();
        void clickLink (Link);
        juce::TooltipWindow tooltip { this, 500 };
        juce::TextButton bankTab { "LIBRARY" }, mapTab { "MAP" }, lexiconTab { "LEXICON" };
        // Only meaningful (and visible) while the Lexicon is the selected tab -- sits in the
        // Lexicon panel's own bottom-left corner (see resized()), not on tabsRect's row up top or
        // on a header row of its own inside SpectromorphologyTree.
        juce::TextButton lexiconFitButton { "FIT" };
        // The Spectromorphology Lexicon: a normal third tab, a peer of LIBRARY/MAP, not a
        // floating dialog and not a placeholder that replaces the other two -- see
        // showLexiconInline(). [LIBRARY][MAP][LEXICON] all stay visible all the time; only one of
        // Library/Map/the tree occupies the content area below them at once, exactly like
        // Library/Map already worked before Lexicon existed. Clicking "(?)" (CapturePanel's heard
        // bar) or the LEXICON tab itself both just select it -- see showSpectromorphologyLexicon().
        // Closing it (the tree's own "X", or Escape) restores whichever of Library/Map was showing
        // before.
        ui::SpectromorphologyTree lexicon;
        bool lexiconShown = false;
        bool autoSelected = false;   // the one-time "open with a Bake selected" (see changeListenerCallback)
        juce::String currentModelId;      // this session's current Model (core/ModelTree.h); "" until one is picked
        std::unique_ptr<juce::Component> dialog;
        std::unique_ptr<juce::FileChooser> chooser;
        bool mapShown = false;
        juce::String status;
        bool statusIsError = false;
        juce::int64 statusUntil = 0;
        juce::Rectangle<int> tabsRect, statusRect;
        juce::Array<juce::File> importQueue;
        juce::String lastProfileId = "np_freeform";
        bool ebysOk = false;                 // the EBYS repo Gnumbat lives inside resolved OK; hand-off enabled state is read via handoffActive()
        juce::String ebysSession, ebysStatus;
        juce::int64 lastEbysCheck = 0;

        void changeListenerCallback (juce::ChangeBroadcaster*) override;
        void timerCallback() override;
        void showDialog (std::unique_ptr<juce::Component>);
        void closeDialogSoon();
        void chooseLibrary();
        juce::String autoLabel() const;
        void restoreUi();
        void saveUi();
        void importNext();
        void openModelMenu();                             // = showModelPage (true)
        void showSpectromorphologyLexicon();              // opens the Lexicon inline (see showLexiconInline())
        void showLexiconInline (bool show);

        void setCurrentModel (const juce::String& id);   // resolves the display name too, and keeps proc's ui-state in sync
        void runBake (NewBake, const juce::String& label);
        void bakeFinished (const juce::Result&, const juce::String& id, const juce::String& label, const juce::String& warning, const juce::String& handoffStatus);
        juce::StringArray decomposerChoices() const;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GnumbatEditor)
    };
}
