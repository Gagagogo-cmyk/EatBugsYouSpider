#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include "../PluginProcessor.h"
#include "UiHost.h"

namespace gnumbat::ui
{
    /** Host detection + BAKE. Gnumbat never defines its own capture range: a Bake is always exactly the host's
        current loop / cycle region (the "looping time selection"), never a manually typed range, bar count or
        second count. A plugin cannot render the host timeline, so that region is captured by PLAYING it through
        the plugin: the coverage bar shows how much of it has actually been heard. */
    class CapturePanel : public juce::Component, private juce::Timer
    {
    public:
        CapturePanel (GnumbatProcessor&, UiHost&);
        ~CapturePanel() override;
        void paint (juce::Graphics&) override;
        void paintOverChildren (juce::Graphics&) override;   // the notation field's own text, split-coloured over the heard fill
        void resized() override;
        void mouseUp (const juce::MouseEvent&) override;
        void mouseMove (const juce::MouseEvent&) override;
        void mouseExit (const juce::MouseEvent&) override;
        std::function<void()> onImport;   // dropping files anywhere on the window, or Cmd/Ctrl+I to browse
        std::function<void()> onBake;         // BAKE lives on the heard/coverage row, right after it
        std::function<void()> onModelClick;   // clicking the word "model" in the top line opens the MODEL page
        std::function<void()> onTitleLayout;  // the top line's free middle moved (see titleMiddle())
        std::function<void()> onShowLexicon;  // "(?)", same row as bpm/time-signature, under model/name
        /** The top line's free middle, between "Reaper / MASTER" and "model / x" (panel coordinates). */
        juce::Rectangle<int> titleMiddle() const { return titleRect.withLeft (titleLeftEnd).withRight (juce::jmax (titleLeftEnd, titleRightStart)); }
        void refreshFromPlan();                       // after state restore: pins the plan back to loop mode
        juce::String notationText() const { return notation.getText().trim(); }
        void clearNotation() { notation.clear(); }     // called once a Bake is actually accepted, not on every capture

        /** x (panel coordinates) where the notation field's text starts -- other rows (the Bank's
            waveform) line up with it. */
        static int notationX();
        static juce::String formatMarker (const Marker&, const TransportSnapshot&);
        static bool parseMarker (const juce::String& text, const Marker& now, const TransportSnapshot&, Marker& out);

    private:
        GnumbatProcessor& proc;
        UiHost& host;
        juce::TextButton bake { "BAKE" };
        juce::TextButton helpButton { "(?)" };
        // Lives inside the heard bar itself (see resized()/paint()) -- whatever's typed here
        // seeds the NotationCard's own notation field the moment BAKE is pressed (beginBake(),
        // PluginEditor.cpp), so notation/tags can be jotted down *while listening*, before the
        // dialog ever opens, instead of trying to remember it a few seconds later.
        juce::TextEditor notation;
        double coverage = 0.0;
        bool tapeFull = false;
        bool heardComplete = false;
        bool prevHeardComplete = false;   // so layoutNotation() re-runs on the pos-drops-out transition even if ringLabel()'s width happens not to change that same tick
        int titleLeftEnd = 0, titleRightStart = 0;
        juce::Rectangle<int> clearRect;   // the notation field's clear "X" inside the heard bar (far right)
        juce::Rectangle<int> posRect;     // the host position readout -- empty once heardComplete (see layoutNotation()/paint()), since pos is dropped entirely once the loop's fully heard
        bool clearHover = false;
        int lastRingW = -1;
        juce::String ringLabel() const;
        void layoutNotation();
        int debugTicks = 0;   // whole selection heard: shows "heard" + the notation field
        std::vector<std::pair<double, double>> coveredFractions;   // where within the loop it's actually been heard
        TransportSnapshot t;
        // Peak-hold per channel, in dB: pushed straight up to a new high the instant the signal
        // exceeds it, then decays back down on its own over time (see timerCallback) -- this is
        // what the compact meter's own peak marker line tracks, rather than the raw per-tick
        // level, so the marker reads as a hold instead of jittering at 15 Hz.
        double peakDb[2] = { -60.0, -60.0 };
        // titleRect: the "(c) 2026 ..." credit line (now also carrying the host/track name)
        // lives here, not in the editor's own header -- this panel's whole left-column text
        // stack (title, host status, loop range) sits one row below the panel's own top edge.
        // meterRect: the compact L/R VU meter that replaced the transport LED -- see paint().
        // None of these rows are given a fixed pixel budget any more (see resized()), so they
        // can't get clipped when the window opens or is resized small.
        juce::Rectangle<int> coverageRect, meterRect, hostRect, loopRect, bakeRect, titleRect;
        // The heard bar's grey-filled zones, in this component's coordinates -- computed in
        // paint(), reused by paintOverChildren() so every piece of text on the bar (heard %,
        // ring, and the notation field) switches to black over exactly the same grey.
        juce::RectangleList<int> greyRects;
        juce::Rectangle<int> modelRect;   // the clickable "model / NAME" run in the credit line (set in paint())
        bool modelHover = false;
        void drawOverGrey (juce::Graphics&, const juce::String&, juce::Rectangle<int> area, juce::Justification,
                           juce::Colour offGrey, const juce::RectangleList<int>& grey) const;

        void timerCallback() override;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CapturePanel)
    };
}
