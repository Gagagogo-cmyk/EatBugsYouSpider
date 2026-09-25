#pragma once
// Producer side of the durable file spool (jobs/pending/<job_id>.json) plus worker discovery.
// The plugin only ever ADDS files to pending/ (atomically); the single worker is the only consumer.
// This is why the plugin works when the worker starts later, dies, or is not installed at all.
#include <juce_core/juce_core.h>
#include "Settings.h"

namespace gnumbat
{
    class JobSubmitter
    {
    public:
        explicit JobSubmitter (const juce::File& libraryRoot) : root (libraryRoot) {}

        /** type: process_bake | decompose_bake | analyze_bake | project_map | reindex | build_dataset_version | train_model */
        juce::String submit (const juce::String& type, const juce::var& params, int priority = 0,
                             const juce::String& app = "gnumbat-plugin", const juce::String& instance = {}) const;

        struct Counts { int pending = 0, running = 0, done = 0, failed = 0; };
        Counts counts() const;
        juce::var result (const juce::String& jobId) const;              // void until finished
        void cancel (const juce::String& jobId) const;

    private:
        juce::File root;
    };

    struct WorkerStatus
    {
        bool present = false;                  // worker.json exists
        bool alive = false;                    // ... and its heartbeat is fresh
        double ageSeconds = 1e9;
        int pid = 0;
        juce::String version, currentJobType, currentJobId;
        juce::StringArray decomposers, analyzers, projectors;
        juce::String summary() const;          // "worker up · testsplit,demucs · idle" etc.
    };

    WorkerStatus readWorkerStatus (const juce::File& libraryRoot, double staleAfterSeconds = 10.0);

    /** Start a detached worker for this library (POSIX: sh+nohup, Windows: cmd start /B). It survives the host.
        worker.lock inside the library guarantees a second launch is harmless: it exits immediately. */
    juce::Result launchWorker (const Settings&, const juce::File& libraryRoot);

    /** The shell command launchWorker() would run (for display and tests). */
    juce::String workerCommandLine (const Settings&, const juce::File& libraryRoot);
}
