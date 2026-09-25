#include "Jobs.h"
#include "JsonIo.h"
#include "Ids.h"
#include "Library.h"

namespace gnumbat
{
    juce::String JobSubmitter::submit (const juce::String& type, const juce::var& params, int priority,
                                       const juce::String& app, const juce::String& instance) const
    {
        const auto jobId = ids::newId ("job");
        auto createdBy = json::object ({ { "app", app }, { "version", kCoreVersion } });
        if (instance.isNotEmpty()) createdBy.getDynamicObject()->setProperty ("instance", instance);

        auto doc = json::object ({ { "schema", "gnumbat.job/0.1" }, { "job_id", jobId }, { "type", type },
                                   { "created_at", json::utcNow() }, { "created_by", createdBy },
                                   { "priority", priority },
                                   { "params", params.getDynamicObject() != nullptr ? params : json::emptyObject() },
                                   { "attempt", 0 }, { "max_attempts", 2 } });
        return json::atomicWriteJson (root.getChildFile ("jobs/pending/" + jobId + ".json"), doc) ? jobId : juce::String();
    }

    JobSubmitter::Counts JobSubmitter::counts() const
    {
        auto n = [this] (const char* d) { return root.getChildFile ("jobs").getChildFile (d).getNumberOfChildFiles (juce::File::findFiles, "job_*.json"); };
        return { n ("pending"), n ("running"), n ("done"), n ("failed") };
    }

    juce::var JobSubmitter::result (const juce::String& jobId) const
    {
        for (auto* d : { "done", "failed" })
        {
            auto f = root.getChildFile ("jobs").getChildFile (d).getChildFile (jobId + ".json");
            if (f.existsAsFile()) return json::readFile (f);
        }
        return {};
    }

    void JobSubmitter::cancel (const juce::String& jobId) const
    {
        root.getChildFile ("jobs/cancel").getChildFile (jobId).create();
    }

    juce::String WorkerStatus::summary() const
    {
        if (! present) return "no worker";
        if (! alive)   return "worker stale (" + juce::String ((int) ageSeconds) + " s)";
        return "worker " + (decomposers.isEmpty() ? juce::String ("up") : decomposers.joinIntoString (",")) + " · "
               + (currentJobType.isEmpty() ? juce::String ("idle") : currentJobType);
    }

    WorkerStatus readWorkerStatus (const juce::File& libraryRoot, double staleAfterSeconds)
    {
        WorkerStatus w;
        bool ok = false;
        auto doc = json::readFile (libraryRoot.getChildFile ("worker.json"), &ok);
        if (! ok) return w;
        w.present = true;
        w.pid = (int) json::getNumber (doc, "pid");
        w.version = json::getString (doc, "version");
        const double hb = json::getNumber (doc, "heartbeat_unix", 0.0);
        w.ageSeconds = juce::Time::currentTimeMillis() / 1000.0 - hb;
        w.alive = w.ageSeconds >= -5.0 && w.ageSeconds < staleAfterSeconds;
        w.decomposers = json::getStrings (doc, "capabilities/decompose");
        w.analyzers = json::getStrings (doc, "capabilities/analyze");
        w.projectors = json::getStrings (doc, "capabilities/project");
        w.currentJobType = json::getString (doc, "current_job/type");
        w.currentJobId = json::getString (doc, "current_job/job_id");
        return w;
    }

        // POSIX single-quote escaping: ' becomes '\''  (also fine as the argument of a Windows cmd line we build below)
    static juce::String shellQuote (const juce::String& s) { return "'" + s.replace ("'", "'\\''") + "'"; }

    juce::String workerCommandLine (const Settings& s, const juce::File& libraryRoot)
    {
        juce::String env;
        if (s.corePath().isNotEmpty())
           #if JUCE_WINDOWS
            env = "set \"PYTHONPATH=" + s.corePath() + ";%PYTHONPATH%\" && ";
           #else
            env = "PYTHONPATH=" + shellQuote (s.corePath()) + "${PYTHONPATH:+:$PYTHONPATH} ";
           #endif
        return env + s.pythonCommand() + " -m gnumbat_core -l " + shellQuote (libraryRoot.getFullPathName()) + " worker";
    }

    juce::Result launchWorker (const Settings& s, const juce::File& libraryRoot)
    {
        if (readWorkerStatus (libraryRoot).alive) return juce::Result::ok();
        const auto log = libraryRoot.getChildFile ("worker.log");
       #if JUCE_WINDOWS
        const auto cmd = "cmd /c start \"\" /B cmd /c \"" + workerCommandLine (s, libraryRoot) + " >> \"" + log.getFullPathName() + "\" 2>&1\"";
        juce::ChildProcess p;
        if (! p.start (cmd)) return juce::Result::fail ("could not start worker");
       #else
        const auto inner = workerCommandLine (s, libraryRoot) + " >> " + shellQuote (log.getFullPathName()) + " 2>&1 < /dev/null";
        juce::StringArray args { "/bin/sh", "-c", "nohup sh -c " + shellQuote (inner) + " > /dev/null 2>&1 &" };
        juce::ChildProcess p;
        if (! p.start (args)) return juce::Result::fail ("could not start /bin/sh");
        p.waitForProcessToFinish (2000);          // the outer sh returns immediately; the worker is now orphaned on purpose
       #endif
        return juce::Result::ok();
    }
}
