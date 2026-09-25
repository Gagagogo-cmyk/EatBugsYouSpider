#include "FilterQuery.h"
#pragma GCC diagnostic ignored "-Wfloat-equal"   // exact numeric equality IS the documented filter semantics
#include "JsonIo.h"
#include <map>
#include <functional>
#include <algorithm>
#include <cmath>

namespace gnumbat::filter
{
    namespace
    {
        using juce::var;
        using juce::String;

        bool isNum (const var& v) { return v.isInt() || v.isInt64() || v.isDouble(); }
        bool isStr (const var& v) { return v.isString(); }

        bool resolve (const var& view, const String& path, var& out)
        {
            var cur = view;
            for (auto& seg : juce::StringArray::fromTokens (path, "/", ""))
            {
                auto* o = cur.getDynamicObject();
                if (o == nullptr || ! o->hasProperty (seg)) return false;
                cur = o->getProperty (seg);
            }
            out = cur;
            return true;
        }

        bool eqScalar (const var& a, const var& b)
        {
            if (isNum (a) && isNum (b)) return (double) a == (double) b;
            if (isStr (a) && isStr (b)) return a.toString().toLowerCase() == b.toString().toLowerCase();
            if (a.isBool() && b.isBool()) return (bool) a == (bool) b;
            return false;
        }

        bool eq (const var& field, const var& value)
        {
            if (auto* arr = field.getArray())
            {
                for (auto& e : *arr) if (eqScalar (e, value)) return true;
                return false;
            }
            return eqScalar (field, value);
        }

        // -1/0/1, or 2 for "not comparable"
        int cmp (const var& a, const var& b)
        {
            if (isNum (a) && isNum (b)) { const double x = a, y = b; return (x > y) - (x < y); }
            if (isStr (a) && isStr (b)) { const int c = a.toString().compare (b.toString()); return (c > 0) - (c < 0); }
            return 2;
        }

        bool truthy (const var& v)
        {
            if (v.isVoid()) return false;
            if (v.isBool()) return (bool) v;
            if (isNum (v)) return (double) v != 0.0;
            if (v.isString()) return v.toString().isNotEmpty();
            if (auto* a = v.getArray()) return a->size() > 0;
            if (auto* o = v.getDynamicObject()) return o->getProperties().size() > 0;
            return true;
        }

        juce::Array<var> asItems (const var& field)
        {
            if (auto* arr = field.getArray()) return *arr;
            return { field };
        }

        bool leafMatches (const var& view, const var& node)
        {
            var field;
            const bool exists = resolve (view, node.getProperty ("field", "").toString(), field);
            const auto op = node.getProperty ("op", "").toString();
            const bool hasValue = node.hasProperty ("value") && ! node.getProperty ("value", {}).isVoid();
            const var value = node.getProperty ("value", {});

            if (op == "exists") return exists == (hasValue ? truthy (value) : true);
            if (! exists || field.isVoid()) return false;

            if (op == "eq" || op == "has") return eq (field, value);
            if (op == "ne") return ! eq (field, value);
            if (op == "lt" || op == "lte" || op == "gt" || op == "gte")
            {
                if (field.isArray()) return false;
                const int c = cmp (field, value);
                if (c == 2) return false;
                return op == "lt" ? c < 0 : op == "lte" ? c <= 0 : op == "gt" ? c > 0 : c >= 0;
            }
            if (op == "between")
            {
                auto* range = value.getArray();
                if (range == nullptr || range->size() != 2 || field.isArray()) return false;
                const int lo = cmp (field, (*range)[0]), hi = cmp (field, (*range)[1]);
                return lo != 2 && hi != 2 && lo >= 0 && hi <= 0;
            }
            if (op == "in")
            {
                auto* list = value.getArray();
                if (list == nullptr) return false;
                for (auto& e : asItems (field)) for (auto& v : *list) if (eqScalar (e, v)) return true;
                return false;
            }
            if (op == "contains" || op == "prefix")
            {
                if (! isStr (value)) return false;
                const auto needle = value.toString().toLowerCase();
                for (auto& e : asItems (field))
                {
                    if (! isStr (e)) continue;
                    const auto hay = e.toString().toLowerCase();
                    if (op == "contains" ? hay.contains (needle) : hay.startsWith (needle)) return true;
                }
                return false;
            }
            return false;    // unknown op: never matches (validate() reports it)
        }

        String haystack (const var& view)
        {
            juce::StringArray parts;
            parts.add (view.getProperty ("id", "").toString());
            parts.add (view.getProperty ("notation", "").toString());
            for (auto* key : { "tags", "groups", "spectral_tags", "morphology_tags" })
                if (auto* a = view.getProperty (key, {}).getArray())
                    for (auto& e : *a) parts.add (e.toString());

            auto add = [&] (const var& x)
            {
                if (isStr (x)) parts.add (x.toString());
                else if (isNum (x))
                {
                    const double d = x;
                    if (std::floor (d) == d && std::abs (d) < 9e15) parts.add (String ((juce::int64) d));   // only integral numbers: float formatting differs across languages
                }
            };
            if (auto* f = view.getProperty ("fields", {}).getDynamicObject())
                for (auto& nv : f->getProperties())
                {
                    if (auto* a = nv.value.getArray()) for (auto& e : *a) add (e);
                    else add (nv.value);
                }
            return parts.joinIntoString ("\n").toLowerCase();
        }

        bool isEmptyQuery (const var& q)
        {
            if (q.isVoid()) return true;
            auto* o = q.getDynamicObject();
            return o != nullptr && o->getProperties().size() == 0;
        }
    }

    bool matches (const var& view, const var& q)
    {
        if (isEmptyQuery (q)) return true;
        if (q.hasProperty ("and"))
        {
            if (auto* a = q.getProperty ("and", {}).getArray()) { for (auto& n : *a) if (! matches (view, n)) return false; return true; }
            return true;
        }
        if (q.hasProperty ("or"))
        {
            if (auto* a = q.getProperty ("or", {}).getArray()) { for (auto& n : *a) if (matches (view, n)) return true; }
            return false;
        }
        if (q.hasProperty ("not")) return ! matches (view, q.getProperty ("not", {}));
        if (q.hasProperty ("text"))
        {
            const auto hay = haystack (view);
            for (auto& tok : juce::StringArray::fromTokens (q.getProperty ("text", "").toString().toLowerCase(), " \t\r\n", ""))
                if (tok.isNotEmpty() && ! hay.contains (tok)) return false;
            return true;
        }
        return leafMatches (view, q);
    }

    String validate (const var& q)
    {
        if (isEmptyQuery (q)) return {};
        for (auto* k : { "and", "or" })
            if (q.hasProperty (k))
            {
                auto* a = q.getProperty (k, {}).getArray();
                if (a == nullptr) return String (k) + " needs a list";
                for (auto& n : *a) { auto e = validate (n); if (e.isNotEmpty()) return e; }
                return {};
            }
        if (q.hasProperty ("not")) return validate (q.getProperty ("not", {}));
        if (q.hasProperty ("text")) return {};
        if (! q.hasProperty ("field") || ! q.hasProperty ("op")) return "leaf needs field and op";
        static const juce::StringArray ops { "eq", "ne", "lt", "lte", "gt", "gte", "between", "in", "contains", "has", "prefix", "exists" };
        const auto op = q.getProperty ("op", "").toString();
        if (! ops.contains (op)) return "unknown op '" + op + "'";
        if (op == "between")
        {
            auto* r = q.getProperty ("value", {}).getArray();
            if (r == nullptr || r->size() != 2) return "between needs [lo, hi]";
        }
        if (op == "in" && q.getProperty ("value", {}).getArray() == nullptr) return "in needs a list";
        return {};
    }

    var leaf (const String& field, const String& op, const var& value)
    {
        return value.isVoid() ? json::object ({ { "field", field }, { "op", op } })
                              : json::object ({ { "field", field }, { "op", op }, { "value", value } });
    }

    var all (const juce::Array<var>& nodes)
    {
        if (nodes.isEmpty()) return json::emptyObject();
        if (nodes.size() == 1) return nodes[0];
        return json::object ({ { "and", var (nodes) } });
    }

    var text (const String& s) { return json::object ({ { "text", s } }); }

    String describe (const var& n)
    {
        if (isEmptyQuery (n)) return "(all)";
        if (n.hasProperty ("text")) return "\"" + n.getProperty ("text", "").toString() + "\"";
        if (n.hasProperty ("not")) return "not " + describe (n.getProperty ("not", {}));
        for (auto* k : { "and", "or" })
            if (n.hasProperty (k))
            {
                juce::StringArray parts;
                if (auto* a = n.getProperty (k, {}).getArray()) for (auto& c : *a) parts.add (describe (c));
                return "(" + parts.joinIntoString (String (" ") + k + " ") + ")";
            }
        const auto v = n.getProperty ("value", {});
        String vs = v.isVoid() ? String() : (v.isArray() ? juce::JSON::toString (v, true) : v.toString());
        return n.getProperty ("field", "").toString() + " " + n.getProperty ("op", "").toString() + (vs.isEmpty() ? "" : " " + vs);
    }

    juce::Array<FieldInfo> catalog (const juce::Array<var>& views, int maxDepth)
    {
        std::map<String, FieldInfo> cat;
        std::map<String, std::map<String, int>> values;

        std::function<void (const String&, const var&, int)> visit = [&] (const String& prefix, const var& node, int depth)
        {
            if (auto* o = node.getDynamicObject(); o != nullptr && depth < maxDepth)
            {
                for (auto& nv : o->getProperties())
                    visit (prefix.isEmpty() ? nv.name.toString() : prefix + "/" + nv.name.toString(), nv.value, depth + 1);
                return;
            }
            auto& e = cat[prefix];
            e.path = prefix;
            ++e.count;
            const bool isList = node.isArray();
            const String type = isList ? "list" : isNum (node) ? "number" : node.isBool() ? "bool" : node.isString() ? "string" : "other";
            if (! e.types.contains (type)) e.types.add (type);
            for (auto& it : isList ? *node.getArray() : juce::Array<var> { node })
            {
                if (isNum (it))
                {
                    const double d = it;
                    if (! e.hasRange) { e.hasRange = true; e.min = e.max = d; }
                    else { e.min = std::min (e.min, d); e.max = std::max (e.max, d); }
                }
                else if (isStr (it) && values[prefix].size() < 200)
                    ++values[prefix][it.toString()];
            }
        };
        for (auto& v : views) visit ({}, v, 0);

        juce::Array<FieldInfo> out;
        for (auto& [path, info] : cat)
        {
            std::vector<std::pair<String, int>> vs (values[path].begin(), values[path].end());
            std::sort (vs.begin(), vs.end(), [] (auto& a, auto& b) { return a.second != b.second ? a.second > b.second : a.first < b.first; });
            for (size_t i = 0; i < vs.size() && i < 8; ++i) info.topValues.add (vs[i].first);
            info.types.sort (false);
            out.add (info);
        }
        return out;
    }
}
