#include "NotationProfile.h"
#pragma GCC diagnostic ignored "-Wfloat-equal"   // integral-value test
#include "JsonIo.h"
#include <regex>
#include <cmath>
#include <cstdlib>

namespace gnumbat::notation
{
    namespace
    {
        const char* kFreeform = R"({"schema":"gnumbat.notation_profile/0.1","profile_id":"np_freeform","name":"freeform","version":1,
            "description":"Whole notation is one phrase-tag. Nothing is extracted.","split":null,"rules":[],"fallback":{"kind":"tag"}})";

        const char* kMusicalDash = R"({"schema":"gnumbat.notation_profile/0.1","profile_id":"np_musical_dash","name":"musical-dash","version":1,
            "description":"Example only: dash-separated 'tag-key-bpm-bars-tag' notation. Off unless a user selects it.",
            "split":{"delimiter":"-","trim":true,"drop_empty":true},
            "rules":[
              {"id":"tempo","match":"^\\s*(\\d+(?:\\.\\d+)?)\\s*bpm\\s*$","flags":"i","emit":[{"kind":"field","name":"tempo","type":"number","group":1}]},
              {"id":"bars","match":"^\\s*(\\d+)\\s*bars?\\s*$","flags":"i","emit":[{"kind":"field","name":"duration_bars","type":"integer","group":1}]},
              {"id":"key","match":"^\\s*([A-Ga-g][#b]?)\\s+(major|minor|maj|min)\\s*$","flags":"i","emit":[
                 {"kind":"field","name":"key","type":"string","template":"{1} {2}"},{"kind":"tag","template":"{1} {2}"}]}],
            "fallback":{"kind":"tag"}})";

        juce::var parseJson (const char* text) { juce::var v; juce::JSON::parse (juce::String (text), v); return v; }

        juce::StringArray splitRaw (const juce::String& raw, const juce::var& split)
        {
            juce::StringArray parts;
            auto* o = split.getDynamicObject();
            if (o == nullptr)
            {
                if (raw.trim().isNotEmpty()) parts.add (raw.trim());
                return parts;
            }
            const auto delim = split.getProperty ("delimiter", "").toString();
            const bool trim = ! split.hasProperty ("trim") || (bool) split.getProperty ("trim", true);
            const bool dropEmpty = ! split.hasProperty ("drop_empty") || (bool) split.getProperty ("drop_empty", true);
            if (delim.isEmpty()) { parts.add (raw); }
            else
            {
                int start = 0;
                for (;;)
                {
                    const int at = raw.indexOf (start, delim);
                    if (at < 0) { parts.add (raw.substring (start)); break; }
                    parts.add (raw.substring (start, at));
                    start = at + delim.length();
                }
            }
            for (auto& p : parts) if (trim) p = p.trim();
            if (dropEmpty) parts.removeEmptyStrings (false);
            return parts;
        }

        juce::String render (const juce::var& emit, const juce::StringArray& groups)
        {
            if (emit.hasProperty ("template"))
            {
                auto out = emit.getProperty ("template", "").toString();
                for (int i = groups.size() - 1; i >= 0; --i)      // replace {10} before {1}
                    out = out.replace ("{" + juce::String (i) + "}", groups[i]);
                return out;
            }
            const int g = (int) emit.getProperty ("group", 0);
            return g >= 0 && g < groups.size() ? groups[g] : juce::String();
        }

        // Python float(): tolerant of surrounding whitespace; we additionally reject non-finite values
        // (they are not representable in JSON) — the Python side does the same.
        bool parseFinite (const juce::String& text, double& out)
        {
            const auto t = text.trim().toStdString();
            if (t.empty()) return false;
            char* end = nullptr;
            const double v = std::strtod (t.c_str(), &end);
            if (end == nullptr || *end != '\0' || ! std::isfinite (v)) return false;
            // strtod accepts hex floats ("0x1p3") which Python's float() does not
            if (t.find_first_of ("xX") != std::string::npos) return false;
            out = v;
            return true;
        }

        void apply (const juce::var& emit, const juce::StringArray& groups, Parsed& out)
        {
            const auto kind = emit.getProperty ("kind", "").toString();
            if (kind == "ignore") return;
            const auto text = render (emit, groups);
            if (kind == "tag")
            {
                if (text.trim().isNotEmpty()) out.tags.add (text.trim());
            }
            else if (kind == "field")
            {
                const auto name = emit.getProperty ("name", "").toString();
                const auto type = emit.getProperty ("type", "string").toString();
                juce::var value;
                if (type == "number" || type == "integer")
                {
                    double v;
                    if (! parseFinite (text, v)) return;                    // not a number => no field
                    if (type == "integer")            value = (juce::int64) std::trunc (v);
                    else if (v == std::floor (v) && std::abs (v) < 9e15) value = (juce::int64) v;
                    else                              value = v;
                }
                else
                    value = text;
                if (! out.fields.hasProperty (name)) out.fieldOrder.add (name);
                out.fields.getDynamicObject()->setProperty (name, value);
            }
        }

        std::regex compile (const juce::var& rule)
        {
            auto flags = std::regex::ECMAScript;
            if (rule.getProperty ("flags", "").toString().containsChar ('i')) flags |= std::regex::icase;
            return std::regex (rule.getProperty ("match", "").toString().toStdString(), flags);
        }
    }

    juce::var freeformProfile() { return parseJson (kFreeform); }

    juce::var builtinProfile (const juce::String& id)
    {
        if (id == "np_freeform") return freeformProfile();
        if (id == "np_musical_dash") return parseJson (kMusicalDash);
        return {};
    }

    juce::Array<juce::var> builtinProfiles() { return { freeformProfile(), parseJson (kMusicalDash) }; }

    juce::String validateProfile (const juce::var& profile)
    {
        if (profile.getDynamicObject() == nullptr) return "profile is not an object";
        if (! json::getString (profile, "profile_id").startsWith ("np_")) return "profile_id must start with np_";
        if (auto* rules = profile.getProperty ("rules", {}).getArray())
            for (auto& r : *rules)
            {
                try { (void) compile (r); }
                catch (const std::regex_error& e)
                {
                    return "rule '" + r.getProperty ("id", "?").toString() + "': bad regex (" + juce::String (e.what()) + ")";
                }
            }
        return {};
    }

    Parsed parse (const juce::String& raw, const juce::var& profileIn)
    {
        const auto profile = profileIn.getDynamicObject() != nullptr ? profileIn : freeformProfile();
        Parsed out;
        out.fields = json::emptyObject();

        const auto rulesVar = profile.getProperty ("rules", {});
        const auto fallback = profile.hasProperty ("fallback") ? profile.getProperty ("fallback", {}) : json::object ({ { "kind", "tag" } });

        for (auto& seg : splitRaw (raw, profile.getProperty ("split", {})))
        {
            bool matched = false;
            if (auto* rules = rulesVar.getArray())
                for (auto& rule : *rules)
                {
                    try
                    {
                        const auto re = compile (rule);
                        std::smatch m;
                        const auto s = seg.toStdString();
                        if (! std::regex_search (s, m, re)) continue;

                        juce::StringArray groups;
                        for (size_t i = 0; i < m.size(); ++i)
                            groups.add (m[i].matched ? juce::String::fromUTF8 (m[i].str().c_str()) : juce::String());
                        matched = true;
                        if (auto* emits = rule.getProperty ("emit", {}).getArray())
                            for (auto& em : *emits) apply (em, groups, out);
                        break;
                    }
                    catch (const std::regex_error& e)
                    {
                        if (out.error.isEmpty())
                            out.error = "rule '" + rule.getProperty ("id", "?").toString() + "': bad regex (" + juce::String (e.what()) + ")";
                    }
                }
            if (! matched)
                apply (fallback, juce::StringArray (seg), out);
        }

        // case-insensitive de-duplication, first spelling wins
        juce::StringArray dedup;
        for (auto& t : out.tags)
        {
            bool seen = false;
            for (auto& d : dedup) if (d.equalsIgnoreCase (t)) { seen = true; break; }
            if (! seen) dedup.add (t);
        }
        out.tags = dedup;
        return out;
    }
}
