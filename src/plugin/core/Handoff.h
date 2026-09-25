#pragma once
// Hand a Bake's audio to the EBYS instrument's own pipeline.
//
// The instrument watches  <EBYS>/data/sessions/<session>/raw_uploads/  (src/demucs/watch_demucs.py): a new audio
// file there is separated with Demucs, tagged, written to stream.txt and analysed with FluCoMa. This module only
// *drops the file*; it never touches that pipeline's own state. Facts it depends on (checked against the repo):
//   - the session is whatever <EBYS>/data/current_session.txt says right now ("default" when empty),
//   - the watcher reacts to a file being CREATED in raw_uploads/ (not renamed inside it), waits 2 s, and skips
//     dot-files, so the file is written elsewhere on the same volume and renamed in whole,
//   - the track name is the file name without extension, and Demucs leaves <track>_{vocals,drums,bass,other}.wav
//     in <session>/stems/htdemucs/<track>/, which is where the worker later adopts them from.
#include <juce_core/juce_core.h>

namespace gnumbat
{
    struct CapturedAudio;

    namespace handoff
    {
        struct Target
        {
            juce::File root, sessionDir, rawUploads;
            juce::String sessionId;
            juce::File stemsDirFor (const juce::String& track) const { return sessionDir.getChildFile ("stems/htdemucs").getChildFile (track); }
        };

        /** Validates that `ebysRoot` is the EBYS repo and finds the active session. Creates raw_uploads/ if missing
            (the watcher would too). Reads one small text file; cheap, but not for the audio thread. */
        juce::Result resolve (const juce::File& ebysRoot, Target& out, bool createRawUploads = true);

        /** "<slug of notation>__<bake id>": ASCII, filesystem-safe, and the Bake id is recoverable from it. */
        juce::String trackName (const juce::String& notation, const juce::String& bakeId);

        /** Float32 WAV -> handoff_tmp/ (same volume, not watched) -> renamed into raw_uploads/<track>.wav. */
        juce::Result write (const Target&, const CapturedAudio&, const juce::String& track, juce::File& written);

        /** The "handoff" block stored in bake.json. */
        juce::var writtenManifest (const Target&, const juce::String& track, const juce::File& written);
        juce::var failedManifest (const juce::String& error);
    }
}
