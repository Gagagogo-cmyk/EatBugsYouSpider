#include "Handoff.h"
#include "JsonIo.h"
#include "Library.h"

namespace gnumbat::handoff
{
    using juce::String;

    juce::Result resolve (const juce::File& root, Target& out, bool createRawUploads)
    {
        if (root == juce::File() || ! root.isDirectory())
            return juce::Result::fail ("EBYS folder not found: " + root.getFullPathName());
        if (! root.getChildFile ("src/demucs/watch_demucs.py").existsAsFile())
            return juce::Result::fail (root.getFullPathName() + " does not look like the EBYS repo (src/demucs/watch_demucs.py is missing)");
        const auto data = root.getChildFile ("data");
        if (! data.isDirectory()) return juce::Result::fail ("no data/ folder in " + root.getFullPathName());

        auto sid = data.getChildFile ("current_session.txt").loadFileAsString().trim();
        if (sid.isEmpty()) sid = "default";
        if (sid.containsAnyOf ("/\\") || sid.contains ("..") || sid.startsWithChar ('.') || sid.length() > 120)
            return juce::Result::fail ("unusable session name in data/current_session.txt: " + sid);

        out.root = root;
        out.sessionId = sid;
        out.sessionDir = data.getChildFile ("sessions").getChildFile (sid);
        out.rawUploads = out.sessionDir.getChildFile ("raw_uploads");
        if (createRawUploads && ! out.rawUploads.createDirectory())
            return juce::Result::fail ("cannot create " + out.rawUploads.getFullPathName());
        return juce::Result::ok();
    }

    String trackName (const String& notation, const String& bakeId)
    {
        String slug;
        bool lastDash = true;
        for (auto c : notation.toLowerCase())
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) { slug << String::charToString (c); lastDash = false; }
            else if (! lastDash) { slug << "-"; lastDash = true; }
            if (slug.length() >= 40) break;
        }
        slug = slug.trimCharactersAtEnd ("-");
        if (slug.isEmpty()) slug = "bake";
        return slug + "__" + bakeId;
    }

    juce::Result write (const Target& t, const CapturedAudio& audio, const String& track, juce::File& written)
    {
        const auto dest = t.rawUploads.getChildFile (track + ".wav");
        if (dest.exists()) return juce::Result::fail (dest.getFullPathName() + " already exists");

        const auto tmpDir = t.sessionDir.getChildFile ("handoff_tmp");
        if (! tmpDir.createDirectory()) return juce::Result::fail ("cannot create " + tmpDir.getFullPathName());
        const auto part = tmpDir.getChildFile (track + ".wav.part");
        if (auto r = writeFloatWav (part, audio); r.failed()) { part.deleteFile(); return r; }
        if (! part.moveFileTo (dest))
        {
            part.deleteFile();
            return juce::Result::fail ("cannot move the render into " + t.rawUploads.getFullPathName());
        }
        written = dest;
        return juce::Result::ok();
    }

    juce::var writtenManifest (const Target& t, const String& track, const juce::File& written)
    {
        return json::object ({ { "status", "written" }, { "target", "ebys_raw_uploads" }, { "session", t.sessionId }, { "track", track },
                               { "file", written.getFullPathName() }, { "stems_dir", t.stemsDirFor (track).getFullPathName() },
                               { "written_at", json::utcNow() } });
    }

    juce::var failedManifest (const String& error)
    {
        return json::object ({ { "status", "failed" }, { "target", "ebys_raw_uploads" }, { "error", error } });
    }
}
