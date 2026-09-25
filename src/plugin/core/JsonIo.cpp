#include "JsonIo.h"
#include <juce_cryptography/juce_cryptography.h>
#include <cmath>

namespace gnumbat::json
{
    juce::String utcNow()
    {
        // Manual civil-from-days (Howard Hinnant): portable UTC without gmtime_r/gmtime_s.
        const juce::int64 ms = juce::Time::currentTimeMillis();
        juce::int64 days = ms / 86400000, rem = ms % 86400000;
        if (rem < 0) { rem += 86400000; --days; }
        days += 719468;
        const juce::int64 era = (days >= 0 ? days : days - 146096) / 146097;
        const juce::int64 doe = days - era * 146097;
        const juce::int64 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        const juce::int64 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        const juce::int64 mp = (5 * doy + 2) / 153;
        const int d = (int) (doy - (153 * mp + 2) / 5 + 1);
        const int m = (int) (mp < 10 ? mp + 3 : mp - 9);
        const int y = (int) (yoe + era * 400 + (m <= 2 ? 1 : 0));
        return juce::String::formatted ("%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", y, m, d,
                                        (int) (rem / 3600000), (int) (rem / 60000 % 60), (int) (rem / 1000 % 60), (int) (rem % 1000));
    }

    juce::int64 parseUtc (const juce::String& iso)
    {
        // Inverse of the civil-from-days algorithm above (Howard Hinnant, days-from-civil form).
        if (iso.length() < 24) return 0;
        const int y = iso.substring (0, 4).getIntValue();
        const int mo = iso.substring (5, 7).getIntValue();
        const int d = iso.substring (8, 10).getIntValue();
        const int h = iso.substring (11, 13).getIntValue();
        const int mi = iso.substring (14, 16).getIntValue();
        const int se = iso.substring (17, 19).getIntValue();
        const int ms = iso.substring (20, 23).getIntValue();
        if (y == 0 || mo < 1 || mo > 12 || d < 1) return 0;
        const int yy = y - (mo <= 2 ? 1 : 0);
        const juce::int64 era = (yy >= 0 ? yy : yy - 399) / 400;
        const juce::int64 yoe = yy - era * 400;
        const juce::int64 doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        const juce::int64 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        const juce::int64 days = era * 146097 + doe - 719468;
        return days * 86400000 + (juce::int64) h * 3600000 + (juce::int64) mi * 60000 + (juce::int64) se * 1000 + ms;
    }

    juce::var readFile (const juce::File& f, bool* ok)
    {
        juce::var result;
        bool good = false;
        if (f.existsAsFile())
        {
            const auto text = f.loadFileAsString();
            good = juce::JSON::parse (text, result).wasOk();
            if (! good) result = juce::var();
        }
        if (ok != nullptr) *ok = good;
        return result;
    }

    juce::String toText (const juce::var& v, bool pretty)
    {
        return juce::JSON::toString (v, ! pretty, 15) + (pretty ? "\n" : "");
    }

    bool atomicWriteBytes (const juce::File& target, const void* data, size_t size)
    {
        target.getParentDirectory().createDirectory();
        const auto tmp = target.getSiblingFile (target.getFileName() + "." + juce::String::toHexString (juce::Random::getSystemRandom().nextInt()) + ".tmp");
        {
            juce::FileOutputStream out (tmp);
            if (out.failedToOpen()) return false;
            out.setPosition (0);
            out.truncate();
            if (size > 0 && ! out.write (data, size)) { out.flush(); tmp.deleteFile(); return false; }
            out.flush();                                   // fsync
        }
        if (! tmp.replaceFileIn (target)) { tmp.deleteFile(); return false; }
        return true;
    }

    bool atomicWrite (const juce::File& target, const juce::String& text)
    {
        const auto utf8 = text.toRawUTF8();
        return atomicWriteBytes (target, utf8, std::strlen (utf8));
    }

    bool atomicWriteJson (const juce::File& target, const juce::var& v) { return atomicWrite (target, toText (v, true)); }

    bool appendLine (const juce::File& f, const juce::var& v)
    {
        f.getParentDirectory().createDirectory();
        juce::FileOutputStream out (f);
        if (out.failedToOpen()) return false;
        out.setPosition (f.getSize());
        out << juce::JSON::toString (v, true, 15) << "\n";
        out.flush();
        return true;
    }

    juce::String sha256OfFile (const juce::File& f)
    {
        juce::FileInputStream in (f);
        if (in.failedToOpen()) return {};
        return juce::SHA256 (in).toHexString();
    }

    juce::var object (std::initializer_list<std::pair<const char*, juce::var>> props)
    {
        auto* o = new juce::DynamicObject();
        for (auto& p : props) o->setProperty (p.first, p.second);
        return juce::var (o);
    }

    juce::var array (const juce::StringArray& items)
    {
        juce::Array<juce::var> a;
        for (auto& s : items) a.add (s);
        return juce::var (a);
    }

    juce::var emptyObject() { return juce::var (new juce::DynamicObject()); }

    juce::var get (const juce::var& obj, const juce::String& path)
    {
        juce::var cur = obj;
        for (auto& seg : juce::StringArray::fromTokens (path, "/", ""))
        {
            auto* o = cur.getDynamicObject();
            if (o == nullptr || ! o->hasProperty (seg)) return {};
            cur = o->getProperty (seg);
        }
        return cur;
    }

    bool has (const juce::var& obj, const juce::String& path)
    {
        juce::var cur = obj;
        for (auto& seg : juce::StringArray::fromTokens (path, "/", ""))
        {
            auto* o = cur.getDynamicObject();
            if (o == nullptr || ! o->hasProperty (seg)) return false;
            cur = o->getProperty (seg);
        }
        return true;
    }

    bool isNumber (const juce::var& v) { return v.isInt() || v.isInt64() || v.isDouble(); }

    juce::String getString (const juce::var& obj, const juce::String& path, const juce::String& fallback)
    {
        auto v = get (obj, path);
        return v.isString() ? v.toString() : fallback;
    }

    double getNumber (const juce::var& obj, const juce::String& path, double fallback)
    {
        auto v = get (obj, path);
        return isNumber (v) ? (double) v : fallback;
    }

    bool getBool (const juce::var& obj, const juce::String& path, bool fallback)
    {
        auto v = get (obj, path);
        return v.isBool() ? (bool) v : fallback;
    }

    juce::StringArray getStrings (const juce::var& obj, const juce::String& path)
    {
        juce::StringArray out;
        auto v = get (obj, path);
        if (auto* a = v.getArray())
            for (auto& e : *a) if (e.isString()) out.add (e.toString());
        return out;
    }
}
