#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include "AppModel.h"
#include "UiHost.h"
#include "FilterBar.h"

namespace gnumbat::ui
{
    /** Bake Bank: browse / search / filter / multi-select / tag / group / rename / delete / assign to datasets.
        Dense one-line-per-Bake table (terminal style). Drag rows out to a DAW to drop the audio. Only the basic
        columns (votes, notation, tags, bpm, duration) are ever shown in the table itself -- creator/status/dates
        show as a one-line detail strip under the table instead, for whichever row is currently selected. */
    class BankView : public juce::Component, private juce::TableListBoxModel, private juce::ChangeListener, private juce::Timer
    {
    public:
        BankView (AppModel&, UiHost&);
        ~BankView() override;
        void resized() override;
        void paint (juce::Graphics&) override;
        bool keyPressed (const juce::KeyPress&) override;
        FilterBar& filterBar() { return bar; }
        // Focuses the inner table directly, not this container -- juce::ListBox (which
        // TableListBox is built on) already handles up/down/pageup/pagedown/home/end row
        // navigation on its own, but only once IT has keyboard focus. Focusing BankView itself
        // routed arrow keys nowhere, since BankView::keyPressed() doesn't handle them. See
        // GnumbatEditor::showTab(), which calls this instead of grabKeyboardFocus() directly.
        void focusTable() { table.grabKeyboardFocus(); }
        /** Same as double-clicking the Bake's row (exposed for tests). */
        void editInline (const juce::String& id) { beginInlineEdit (id); }
        juce::TextEditor& inlineEditor() { return inlineEdit; }

        // actions shared with the inspector and the map's context menu
        static void showContextMenu (AppModel&, UiHost&, juce::Component* target, const juce::StringArray& ids);
        static void promptEditNotation (AppModel&, UiHost&, const juce::String& id);
        static void promptAddTag (AppModel&, UiHost&, const juce::StringArray& ids);
        // Spectromorphology (Denis Smalley): two more free tag categories alongside the plain
        // one above -- spectral_tags for the spectrum's own shape, morphology_tags for how it
        // moves through the Bake's duration. Same "#word, #word" free entry, a suggested
        // vocabulary offered only as placeholder examples, never enforced -- see BankView.cpp.
        static void promptAddSpectralTag (AppModel&, UiHost&, const juce::StringArray& ids);
        static void promptAddMorphologyTag (AppModel&, UiHost&, const juce::StringArray& ids);
        static void promptAddGroup (AppModel&, UiHost&, const juce::StringArray& ids);
        static void promptSetField (AppModel&, UiHost&, const juce::StringArray& ids);
        static void promptDatasetMenu (AppModel&, UiHost&, juce::Component* target, const juce::StringArray& ids);
        static void confirmTrash (AppModel&, UiHost&, const juce::StringArray& ids);
        /** The instrument pipeline's current step in words ("demucs 57%", "flucoma waiting for Pd",
            "analyzed by EBYS"), or "" for a Bake that wasn't handed to EBYS. */
        static juce::String pipelineStatusText (const juce::var& view);

    private:
        AppModel& model;
        UiHost& host;
        FilterBar bar;
        juce::TableListBox table { "bank", this };
        bool syncing = false;
        // The "created by X on ...; status: ...; last edited on ..." strip for the primary
        // selected row -- empty (and un-painted; see resized()/paint()) whenever nothing's
        // selected, so it doesn't cost the table any height until it's actually needed.
        juce::Rectangle<int> detailRect;
        // Repaints the detail strip a few times a second while the selected Bake's instrument
        // pipeline is still working (moving "running" bars); idle otherwise.
        struct Ticker : juce::Timer { std::function<void()> tick; void timerCallback() override { if (tick) tick(); } } pipelineTicker;
        bool primaryHasPipeline() const;
        void paintPipeline (juce::Graphics&, juce::Rectangle<int> row, const juce::var& view);

        // ---- play/stop, for hearing the selected Bake without leaving the Bank -----------------
        // Plays Library::previewAudioFile() -- the small companion written next to every Bake's
        // full-quality original (see Library.h) -- through its own independent audio device
        // rather than the host's graph (a plugin has no output of its own to route through
        // otherwise). Nothing here is opened until PLAY is actually pressed once (see
        // ensurePlayerReady()), so a session that never uses this never grabs a device at all.
        juce::AudioFormatManager formatManager;
        juce::AudioDeviceManager deviceManager;
        juce::AudioSourcePlayer sourcePlayer;
        juce::AudioTransportSource transport;
        juce::TimeSliceThread playbackThread { "gnumbat-preview" };
        std::unique_ptr<juce::AudioFormatReaderSource> readerSource;
        bool playerReady = false;
        juce::String playingId;             // which Bake readerSource is currently loaded for
        juce::TextButton playButton { "PLAY" };
        // Double-click a Bake: an edit field opens right in its row, over NOTATION + TAGS, holding
        // "notation #tag #tag". Clicking anywhere else (or Enter) saves it -- the text becomes the
        // notation and its #words the tags; Escape cancels.
        juce::TextEditor inlineEdit;
        juce::String inlineId, inlineOriginal;
        struct ClickAway : juce::MouseListener
        {
            std::function<void (const juce::MouseEvent&)> onDown;
            void mouseDown (const juce::MouseEvent& e) override { if (onDown) onDown (e); }
        } clickAway;
        void beginInlineEdit (const juce::String& id);
        void finishInlineEdit (bool save);
        void positionInlineEdit();
        juce::Rectangle<int> playRect;       // whole play row: button + waveform (see resized())
        juce::Rectangle<int> waveRect;       // just the waveform bar, already margined to match
                                              // CapturePanel's own heard bar (see resized())
        // The selected Bake's waveform (from its preview/peaks, written at createBake() time --
        // see Library.cpp/computePeaks), cached against whichever id it was last read for so a
        // repaint at 15 Hz while playing doesn't re-read/parse bake.json every frame.
        juce::String waveformForId;
        std::vector<std::pair<float, float>> waveformPeaks;
        void ensurePlayerReady();
        void loadForPlayback (const juce::String& id);
        void refreshWaveform (const juce::String& id);
        void togglePlay();
        void stopPlayback();
        void timerCallback() override;

        // one placeholder row ("no bakes" -- see paintCell) instead of zero real ones, so the
        // empty state reads as part of the table rather than a blank rectangle under the header
        int getNumRows() override { return model.rows().empty() ? 1 : (int) model.visible().size(); }
        void paintRowBackground (juce::Graphics&, int row, int w, int h, bool selected) override;
        void paintCell (juce::Graphics&, int row, int col, int w, int h, bool selected) override;
        void sortOrderChanged (int col, bool fwd) override;
        void selectedRowsChanged (int lastRow) override;
        void cellClicked (int row, int col, const juce::MouseEvent&) override;
        void cellDoubleClicked (int row, int col, const juce::MouseEvent&) override;
        juce::String getCellTooltip (int row, int col) override;
        juce::var getDragSourceDescription (const juce::SparseSet<int>&) override;
        void backgroundClicked (const juce::MouseEvent&) override;
        void changeListenerCallback (juce::ChangeBroadcaster*) override;
        const BakeRow* rowAt (int) const;
        static juce::String dateText (const juce::String& id);   // absolute created-at timestamp, from the id itself
        void vote (const juce::String& id, bool up);
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BankView)
    };
}
