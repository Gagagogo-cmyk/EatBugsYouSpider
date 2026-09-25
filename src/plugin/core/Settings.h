#pragma once
// Machine-level settings. Deliberately NOT inside the library: a library is portable between machines,
// but "where is Python / Pd / Demucs" are facts about *this* machine. Same file the Python worker reads
// (gnumbat_core/settings.py): env GNUMBAT_SETTINGS, else <app data>/settings.json. Unknown keys are preserved.
#include <juce_core/juce_core.h>

namespace gnumbat
{
    class Settings
    {
    public:
        static juce::File appDataDir();                    // env GNUMBAT_HOME, else per-OS default
        static juce::File settingsFile();
        static juce::File defaultLibraryRoot();            // ~/Documents/Gnumbat/library

        static Settings load();

        /** This machine's anonymous identity, e.g. "local-aq9mox4s": what the plugin writes as a Model's
            creator, a Bake's created_by, and a vote -- never the OS login name. Generated once (random) and
            kept in settings.json ("local_identity"). */
        static juce::String localIdentity();
        bool save() const;

        juce::File libraryRoot() const;                    // settings.library_root or the default
        void setLibraryRoot (const juce::File&);
        juce::String pythonCommand() const;                // settings.python, else "python3" ("python" on Windows)
        juce::String corePath() const;                     // folder containing the gnumbat_core package (PYTHONPATH)
        bool autostartWorker() const;                      // default true
        double ringSeconds() const;                        // capture ring length, default 120
        juce::File ebysRoot() const;                       // settings.ebys_root, else env GNUMBAT_EBYS_ROOT, else the EBYS
                                                             // repo this plugin was built from (compiled in -- Gnumbat's
                                                             // own source lives at <EBYS>/src/plugin), else File()
        void setEbysRoot (const juce::File&);
        bool handoffEnabled() const;                       // settings.handoff_raw_uploads, default true (only acts when ebysRoot is set)
        juce::String decomposer() const;                   // key "decompose_default", default "auto" (the worker-side "decomposer" key is an OBJECT, see settings schema)

        void set (const juce::String& key, const juce::var& value);
        juce::var get (const juce::String& key, const juce::var& fallback = {}) const;
        const juce::var& document() const { return doc; }
        /** Independent copy (the JSON document is reference-counted): use before handing settings to another thread. */
        Settings deepCopy() const { Settings s; s.doc = doc.clone(); return s; }

    private:
        juce::var doc = juce::var (new juce::DynamicObject());
    };
}
