#include "MapData.h"
#include "JsonIo.h"

namespace gnumbat
{
    MapDoc readMap (const juce::File& root, const juce::String& fsId)
    {
        MapDoc m;
        const auto f = root.getChildFile ("derived/maps").getChildFile (fsId + ".json");
        bool ok = false;
        const auto doc = json::readFile (f, &ok);
        if (! ok || ! json::getString (doc, "schema").startsWith ("gnumbat.map/")) return m;

        m.valid = true;
        m.fileStamp = f.getLastModificationTime().toMilliseconds() ^ (f.getSize() << 20);
        m.mapId = json::getString (doc, "map_id");
        m.featureSetId = json::getString (doc, "space/feature_set_id", fsId);
        m.label = json::getString (doc, "space/label", fsId);
        m.method = json::getString (doc, "method/name");
        m.requestedMethod = json::getString (doc, "method/requested", m.method);
        m.note = json::getString (doc, "method/note");
        m.disclaimer = json::getString (doc, "disclaimer");
        m.createdAt = json::getString (doc, "created_at");
        const auto tw = json::get (doc, "quality/trustworthiness");
        if (json::isNumber (tw)) { m.hasTrust = true; m.trustworthiness = (double) tw; }

        if (auto* pts = doc.getProperty ("points", {}).getArray())
        {
            m.points.reserve ((size_t) pts->size());
            for (auto& p : *pts)
                m.points.push_back ({ json::getString (p, "bake_id"), (float) json::getNumber (p, "x"), (float) json::getNumber (p, "y") });
        }
        if (auto* ex = doc.getProperty ("excluded", {}).getArray())
            for (auto& e : *ex) m.excluded.emplace_back (json::getString (e, "bake_id"), json::getString (e, "reason"));
        return m;
    }

    juce::StringArray listMapFeatureSets (const juce::File& root)
    {
        juce::StringArray out;
        for (auto& e : juce::RangedDirectoryIterator (root.getChildFile ("derived/maps"), false, "*.json", juce::File::findFiles))
            out.add (e.getFile().getFileNameWithoutExtension());
        out.sort (true);
        return out;
    }
}
