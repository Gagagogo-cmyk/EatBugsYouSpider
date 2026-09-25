#include "Settings.h"
#include "JsonIo.h"

namespace gnumbat
{
    juce::File Settings::appDataDir()
    {
        if (auto env = juce::SystemStats::getEnvironmentVariable ("GNUMBAT_HOME", {}); env.isNotEmpty())
            return juce::File (env);
       #if JUCE_MAC
        return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("Gnumbat");
       #elif JUCE_WINDOWS
        return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("Gnumbat");
       #else
        if (auto xdg = juce::SystemStats::getEnvironmentVariable ("XDG_CONFIG_HOME", {}); xdg.isNotEmpty())
            return juce::File (xdg).getChildFile ("gnumbat");
        return juce::File::getSpecialLocation (juce::File::userHomeDirectory).getChildFile (".config/gnumbat");
       #endif
    }

    juce::File Settings::settingsFile()
    {
        if (auto env = juce::SystemStats::getEnvironmentVariable ("GNUMBAT_SETTINGS", {}); env.isNotEmpty())
            return juce::File (env);
        return appDataDir().getChildFile ("settings.json");
    }

    juce::File Settings::defaultLibraryRoot()
    {
        return juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile ("Gnumbat/library");
    }

    Settings Settings::load()
    {
        Settings s;
        bool ok = false;
        auto v = json::readFile (settingsFile(), &ok);
        if (ok && v.getDynamicObject() != nullptr) s.doc = v;
        if (! s.doc.hasProperty ("schema")) s.doc.getDynamicObject()->setProperty ("schema", "gnumbat.settings/0.1");
        return s;
    }

    bool Settings::save() const { return json::atomicWriteJson (settingsFile(), doc); }

    juce::String Settings::localIdentity()
    {
        static juce::CriticalSection lock;
        static juce::String cached;
        const juce::ScopedLock sl (lock);
        if (cached.isNotEmpty()) return cached;
        auto st = load();
        auto id = st.get ("local_identity", "").toString();
        if (! id.startsWith ("local-"))
        {
            static const char* alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
            juce::Random rng;   // seeded from the system clock / entropy
            id = "local-";
            for (int i = 0; i < 8; ++i) id << juce::String::charToString ((juce::juce_wchar) alphabet[rng.nextInt (36)]);
            st.set ("local_identity", id);
            st.save();
        }
        cached = id;
        return cached;
    }

    void Settings::set (const juce::String& key, const juce::var& value) { doc.getDynamicObject()->setProperty (key, value); }
    juce::var Settings::get (const juce::String& key, const juce::var& fallback) const
    {
        return doc.hasProperty (key) ? doc.getProperty (key, fallback) : fallback;
    }

    juce::File Settings::libraryRoot() const
    {
        if (auto env = juce::SystemStats::getEnvironmentVariable ("GNUMBAT_LIBRARY", {}); env.isNotEmpty())
            return juce::File (env);
        auto p = json::getString (doc, "library_root");
        return p.isNotEmpty() ? juce::File (p) : defaultLibraryRoot();
    }

    void Settings::setLibraryRoot (const juce::File& f) { set ("library_root", f.getFullPathName()); }

    juce::String Settings::pythonCommand() const
    {
        auto p = json::getString (doc, "python");
        if (p.isNotEmpty()) return p;
       #if JUCE_WINDOWS
        return "python";
       #else
        return "python3";
       #endif
    }

    juce::String Settings::corePath() const
    {
        auto p = json::getString (doc, "core_path");
        if (p.isNotEmpty()) return p;
        return juce::SystemStats::getEnvironmentVariable ("GNUMBAT_CORE_PATH", {});
    }

    bool Settings::autostartWorker() const
    {
        if (juce::SystemStats::getEnvironmentVariable ("GNUMBAT_AUTOSTART", {}) == "0") return false;     // tests / locked-down setups
        return json::getBool (doc, "autostart_worker", true);
    }
    double Settings::ringSeconds() const { return juce::jlimit (10.0, 900.0, json::getNumber (doc, "ring_seconds", 120.0)); }
    juce::File Settings::ebysRoot() const
    {
        auto p = json::getString (doc, "ebys_root");
        if (p.isEmpty()) p = juce::SystemStats::getEnvironmentVariable ("GNUMBAT_EBYS_ROOT", {});
       #ifdef GNUMBAT_BUILTIN_EBYS_ROOT
        // Gnumbat is supposed to live inside EBYS: its own source is at <EBYS>/src/plugin, and
        // plugin.cmake bakes that repo's absolute path in at build time -- so a build made from
        // inside an EBYS checkout is linked to it by default, with no folder to choose.
        if (p.isEmpty()) p = GNUMBAT_BUILTIN_EBYS_ROOT;
       #endif
        return p.isEmpty() ? juce::File() : juce::File (p);
    }
    void Settings::setEbysRoot (const juce::File& f) { set ("ebys_root", f == juce::File() ? juce::String() : f.getFullPathName()); }
    bool Settings::handoffEnabled() const { return json::getBool (doc, "handoff_raw_uploads", true); }

    juce::String Settings::decomposer() const { return json::getString (doc, "decompose_default", "auto"); }
}
