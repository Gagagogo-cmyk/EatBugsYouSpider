# EBYS — VST Plugin Roadmap

Status: **plan, nothing built yet**. This supersedes `REAPER_INTEGRATION.md` — that doc was scoped around a REAPER-only ReaScript extension; the decision since then is a real VST3/AU plugin (JUCE/C++), for portability across DAWs. The Max/PD instrument keeps being the live rig throughout — nothing here touches it, and it doesn't block or get blocked by this.

One page, meant to be read start to finish. If any of this feels like it contradicts something said earlier in planning, this doc wins.

---

## 1. The decision, in one paragraph

EBYS becomes a VST3/AU **studio tool**, not a live-performance engine — that job stays with the Max/PD instrument (and eventually hardware). The flow: the plugin renders a snapshot of the user's mix, hands it to a background service to analyze, decompose into stems, and remix or regenerate, then the results come back and the user uploads them into the DAW as new audio. The plugin's C++ core (JUCE) only does the two ends of that — capture and delivery — both non-real-time.

The background service is three things, not one: the Python pipeline (Demucs/madmom/Essentia/taste model/generation), PD running headlessly for FluCoMa analysis (the actual descriptor computation — onset slicing, spectral/pitch/timbre — genuinely has to run inside PD, not as a standalone script; only the *live playback* half of PD, `karma~`/`pfft~`, is what the DAW replaces), and Ollama for Cricket. None of it needs to be visible to the user — the plugin checks whether it's running on load and launches/supervises it itself if not, so from the outside it's just "install the VST, use it in your DAW."

Cricket becomes the recommendation and search interface into the growing archive this produces — same assistant, same `ebys.db`, surfacing candidates for "what comes next" from the scored catalog rather than translating live engine commands.

---

## 2. What you already have — this is most of the hard part

Worth sitting with this, because the vision can feel bigger than it is: the ML and decision-making core of EBYS already exists and already works.

- **Stem separation, analysis, indexing** — Demucs, madmom, Essentia, FluCoMa — all built, all running today.
- **Slice selection / "alternative versions" of a stem** — `slicer.js`'s `selectSegment()`, descriptor-distance scoring. Built.
- **A taste model that scores a candidate** — `train_bias.py`. Built, working.
- **A score → train loop** — `:bake`, `bake_snapshots` in `ebys.db`, decay over time. Built, working, already database-backed.
- **True generative audio (not just remixing existing material)** — designed in detail (`GENERATIVE_LAYER.md`, `USER_LORA.md`), code written, just not yet run on a GPU.
- **Remix / generate / blend switching** — `AGENT_MODE`. Built.
- **Cricket** — Ollama-backed assistant, already reads descriptor/vocabulary context. Built for command translation; repurposing it as an archive-search interface (Step 6) is a new prompt mode, not new infrastructure.

None of that gets rebuilt. The plugin's job is to become a new *host* for this — replacing Max/PD's role as the thing that plays audio and shows you what's happening — not to reinvent what the system already knows how to do.

---

## 3. What's actually left, in order

Each step is small enough to be a real milestone, and each one only depends on the step before it — so if momentum stalls, you'll always know exactly where you stopped and what "done" looked like for the last thing that worked.

**Step 1 — Design the panel (mockup, no code).**
Work out what the GUI actually needs to show and do: live descriptors per stem, a way to audition and score candidate takes, bake/train controls, section markers. Get the layout right on screen before writing a line of C++. This is the very next thing to do, and it's low-stakes — it's a picture, not a commitment.

**Step 2 — A plugin that does nothing (the "hello world").**
Stand up the smallest possible JUCE project: compiles, loads in a DAW, passes audio through unchanged. No stems, no Python, no GUI beyond a blank window. The entire goal of this step is proving the toolchain — compiler, JUCE, plugin format, your DAW — actually works together before anything else depends on it. Skipping this step is the single most common way plugin projects stall out on tooling problems disguised as feature problems.

**Step 3 — Audio capture (the "snapshot").**
The plugin sits on a track, passes audio through unchanged, and on request writes what's passed through it to a WAV. Standard JUCE recording — no custom DSP, nothing real-time-critical beyond "don't drop samples." This is the only audio-handling code the plugin needs.

*Implementation:* never write to disk from `processBlock()` directly — that's a blocking call on the real-time thread, the one rule established early on. Push incoming samples into a `juce::AudioFormatWriter::ThreadedWriter` (JUCE's built-in tool for exactly this — audio thread writes into a lock-free FIFO, a background `juce::TimeSliceThread` drains it to disk). Toggle capture on/off from a GUI button, which just flips a flag the audio thread checks. On stop: close the writer, hand the finished file path to Step 4.

```cpp
// sketch, not final code
std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> writer;
juce::TimeSliceThread backgroundThread { "EBYS capture writer" };

void startCapture (const juce::File& outFile) {
    backgroundThread.startThread();
    auto stream = outFile.createOutputStream();
    auto* baseWriter = juce::WavAudioFormat().createWriterFor (
        stream.release(), getSampleRate(), getTotalNumOutputChannels(), 24, {}, 0);
    writer.reset (new juce::AudioFormatWriter::ThreadedWriter (baseWriter, backgroundThread, 32768));
}

void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override {
    if (writer != nullptr) writer->write (buffer.getArrayOfReadPointers(), buffer.getNumSamples());
    // pass audio through unchanged either way
}
```

**Step 4 — The socket bridge.**
Wire the plugin's background thread to talk to the background service: hand it the captured WAV, trigger separation → FluCoMa analysis → scoring (and later generation), get results back, confirm `ebys.db` updates land where the plugin can read them. This proves the architecture actually works, using real backend code.

The background service is Python (Demucs/madmom/Essentia/taste model/generation) + PD running headlessly for FluCoMa analysis, via `libpd` and a minimal analysis-only patch (just the FluCoMa chain — no `karma~`, no audio out, no GUI) + Ollama for Cricket. **Validate the riskiest part of this first, before building the rest of the bridge on top of it:** confirm FluCoMa's PD externals actually run correctly headless under `libpd`. Everything downstream assumes this works.

The plugin should own this service's whole lifecycle, not the user — check the local socket on load, launch and supervise Python/PD/Ollama itself if nothing answers, restart on crash. Goal is zero visible setup: install the VST, open the DAW, it works.

**Step 5 — Result delivery.**
Get the separated/generated files back into the DAW. Two portable options, can coexist: multi-out buses (plugin exposes extra outputs, user routes once, same as a multi-out drum sampler) and drag-and-drop straight out of the plugin window onto the timeline (JUCE supports this natively — no pre-configuration needed). No automatic track creation — that's a host-scripting capability (REAPER only), ruled out when portability won over a REAPER-only build.

*Implementation:* each result (a stem, a generated take) is a row/card in the GUI backed by a real file already on disk (it came back from Step 4 as a file). Make that component a `juce::DragAndDropContainer` (usually the top-level editor) and start a drag on mouse-down-and-move via `performExternalDragDropOfFiles()` — this is the literal API for "drag a file out of my plugin window onto anything on the user's system," including the DAW's own timeline.

```cpp
// sketch, not final code
void ResultCard::mouseDrag (const juce::MouseEvent& e) {
    if (e.mouseWasDraggedSinceMouseDown()) {
        auto* container = juce::DragAndDropContainer::findParentDragContainerFor (this);
        container->performExternalDragDropOfFiles ({ resultFile.getFullPathName() }, false, this, nullptr);
    }
}
```

**Step 6 — Wire the GUI to real data.**
Connect Step 1's mockup to the live system: real descriptors, a progress display while separation/analysis runs, real bake/score controls writing to `ebys.db`. This is where the "training tab" from the original vision becomes real — as a studio tool, not a live-performance surface. Include Cricket here as a recommender, not just a search box: it surfaces candidates from the scored catalog for "what should come next," and the user picks from what it suggests for each section of the track.

**Step 7 — Packaging for other people.**
Only after Steps 1–6 work for you: decide whether to bundle a Python runtime so strangers don't need their own install, or move the neural inference paths to a Python-free C++ runtime (ONNX/libtorch). Deliberately last — it's a distribution problem, not a capability problem.

**Not in this plugin:** live playback, pitch-shifted real-time sequencing, and mid-set "dimension switching" stay with the Max/PD instrument (and eventually hardware) — that's a different tool for a different moment, sharing the same `ebys.db`/Python backend rather than duplicating it in C++.

---

## 4. What doesn't change while this happens

The full Max/PD instrument — sequencing, `karma~`/`pfft~` playback, the whole performance patch — keeps being what you actually perform with. Its own roadmap (0.3 PD migration, deadline Aug 8; 1.0 stability) runs on its own track. What the VST needs from PD is narrower and different: just the FluCoMa analysis chain, running headlessly with no playback and no GUI. Same underlying engine, two separate patches for two separate jobs — this plan doesn't compete with the performance patch's migration, and a settled PD/FluCoMa chain post-migration is exactly what Step 4's `libpd` validation depends on.

---

## 5. Right now

Step 1. A mockup of the panel — nothing else needs deciding today.
