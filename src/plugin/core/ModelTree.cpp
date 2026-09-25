#include "ModelTree.h"
#include "JsonIo.h"
#include "Settings.h"
#include "Ids.h"
#include <algorithm>
#include <functional>

namespace gnumbat
{
    namespace
    {
        constexpr const char* kModelSchema = "gnumbat.model/0.1";
    }

    std::vector<ModelInfo> listModels (const juce::File& libraryRoot)
    {
        std::vector<ModelInfo> out;
        for (auto& e : juce::RangedDirectoryIterator (libraryRoot.getChildFile ("models"), true, "model.json", juce::File::findFiles))
        {
            bool ok = false;
            const auto doc = json::readFile (e.getFile(), &ok);
            if (! ok || ! json::getString (doc, "schema").startsWith ("gnumbat.model/")) continue;
            ModelInfo m;
            m.id = json::getString (doc, "model_id");
            m.name = json::getString (doc, "name");
            m.description = json::getString (doc, "description");
            m.creator = json::getString (doc, "creator");
            m.parentId = json::getString (doc, "parent_model_id");   // Gnumbat's own extension -- see ModelTree.h
            m.createdAtMs = json::parseUtc (json::getString (doc, "created_at"));
            m.modifiedAtMs = json::parseUtc (json::getString (doc, "modified_at"));
            if (m.modifiedAtMs <= 0) m.modifiedAtMs = m.createdAtMs;
            m.votesUp = json::getStrings (doc, "votes_up");
            m.votesDown = json::getStrings (doc, "votes_down");
            if (m.id.isNotEmpty()) out.push_back (m);
        }
        std::sort (out.begin(), out.end(), [] (const ModelInfo& a, const ModelInfo& b) { return a.createdAtMs < b.createdAtMs; });
        return out;
    }

    juce::Result createModel (const juce::File& libraryRoot, const juce::String& name, const juce::String& parentId, juce::String& idOut)
    {
        if (name.trim().isEmpty()) return juce::Result::fail ("a Model needs a name");
        const auto id = ids::newId ("md");
        const auto dir = libraryRoot.getChildFile ("models").getChildFile (id);
        if (! dir.createDirectory()) return juce::Result::fail ("cannot create " + dir.getFullPathName());
        const auto now = json::utcNow();
        auto doc = json::object ({
            { "schema", kModelSchema }, { "model_id", id }, { "name", name.trim() },
            { "creator", Settings::localIdentity() }, { "description", juce::String() },
            { "created_at", now }, { "modified_at", now }, { "latest_version_id", juce::var() },
            { "parent_model_id", parentId.isEmpty() ? juce::var() : juce::var (parentId) } });
        if (! json::atomicWriteJson (dir.getChildFile ("model.json"), doc))
            return juce::Result::fail ("cannot write " + dir.getChildFile ("model.json").getFullPathName());
        idOut = id;
        return juce::Result::ok();
    }

    juce::Result setModelVotes (const juce::File& libraryRoot, const juce::String& id, const juce::StringArray& up, const juce::StringArray& down)
    {
        const auto f = libraryRoot.getChildFile ("models").getChildFile (id).getChildFile ("model.json");
        bool ok = false;
        auto doc = json::readFile (f, &ok);
        if (! ok || doc.getDynamicObject() == nullptr) return juce::Result::fail ("cannot read " + f.getFullPathName());
        doc.getDynamicObject()->setProperty ("votes_up", json::array (up));
        doc.getDynamicObject()->setProperty ("votes_down", json::array (down));
        if (! json::atomicWriteJson (f, doc)) return juce::Result::fail ("cannot write " + f.getFullPathName());
        return juce::Result::ok();
    }

    int replaceIdentity (const juce::File& root, const juce::String& from, const juce::String& to)
    {
        if (from.isEmpty() || to.isEmpty() || from == to) return 0;
        int changed = 0;
        auto swapList = [&] (juce::var& obj, const juce::String& key)
        {
            auto* arr = obj.getProperty (key, {}).getArray();
            if (arr == nullptr) return false;
            bool any = false;
            juce::StringArray out;
            for (auto& v : *arr)
            {
                auto sv = v.toString();
                if (sv == from) { sv = to; any = true; }
                out.addIfNotAlreadyThere (sv);
            }
            if (any) obj.getDynamicObject()->setProperty (key, json::array (out));
            return any;
        };
        auto rewrite = [&] (const juce::File& f, std::function<bool (juce::var&)> edit)
        {
            bool ok = false;
            auto doc = json::readFile (f, &ok);
            if (! ok || doc.getDynamicObject() == nullptr) return;
            if (edit (doc) && json::atomicWriteJson (f, doc)) ++changed;
        };
        for (auto& e : juce::RangedDirectoryIterator (root.getChildFile ("models"), true, "model.json", juce::File::findFiles))
            rewrite (e.getFile(), [&] (juce::var& d)
            {
                bool any = false;
                if (d.getProperty ("creator", "").toString() == from) { d.getDynamicObject()->setProperty ("creator", to); any = true; }
                any = swapList (d, "votes_up") || any;
                any = swapList (d, "votes_down") || any;
                return any;
            });
        for (auto& e : juce::RangedDirectoryIterator (root.getChildFile ("bakes"), false, "*", juce::File::findDirectories))
        {
            const auto dir = e.getFile();
            rewrite (dir.getChildFile ("bake.json"), [&] (juce::var& d)
            {
                if (d.getProperty ("created_by", "").toString() != from) return false;
                d.getDynamicObject()->setProperty ("created_by", to);
                return true;
            });
            rewrite (dir.getChildFile ("semantic.json"), [&] (juce::var& d)
            {
                auto fields = d.getProperty ("fields", {});
                if (fields.getDynamicObject() == nullptr) return false;
                bool any = swapList (fields, "votes_up");
                any = swapList (fields, "votes_down") || any;
                return any;
            });
        }
        return changed;
    }
}
