#include "ModelHub.h"
#include "../../core/JsonIo.h"
#include <map>
#include <set>

namespace gnumbat::ui
{
    using juce::String;
    using juce::var;

    static juce::int64 isoMs (const String& iso)
    {
        if (iso.isEmpty()) return 0;
        return juce::Time::fromISO8601 (iso).toMilliseconds();
    }

    static String newOpId() { return "op-" + juce::Uuid().toString(); }

    std::shared_ptr<ModelHub> ModelHub::forLibrary (const juce::File& libraryRoot, const String& hubUrl)
    {
        JUCE_ASSERT_MESSAGE_THREAD
        static std::map<String, std::weak_ptr<ModelHub>> hubs;
        const auto key = libraryRoot.getFullPathName() + "|" + hubUrl;
        if (auto h = hubs[key].lock()) return h;
        auto h = std::make_shared<ModelHub> (libraryRoot, hubUrl);
        hubs[key] = h;
        return h;
    }

    ModelHub::ModelHub (const juce::File& libraryRoot, const String& hubUrl) : root (libraryRoot), url (hubUrl)
    {
        load();
        rebuild();
        startTimer (10000);
        syncNow();
    }

    ModelHub::~ModelHub()
    {
        alive->store (false);
        stopTimer();
    }

    String ModelHub::hubUrl() const
    {
        auto u = url.trim();
        if (u.isEmpty()) u = juce::SystemStats::getEnvironmentVariable ("GNUMBAT_HUB_URL", {});
        if (u.isEmpty()) u = "http://localhost:8080";
        return u.trimCharactersAtEnd ("/");
    }

    String ModelHub::statusText() const
    {
        if (isConnected) return pending.isEmpty() ? String ("hub on") : "hub on (syncing " + String (pending.size()) + ")";
        return pending.isEmpty() ? String ("hub off") : "hub off (" + String (pending.size()) + " queued)";
    }

    // ------------------------------------------------------------------------------------------ files
    void ModelHub::load()
    {
        pending.clear();
        idMap.clear();
        cachedCards = var();
        haveList = false;
        const auto cache = json::readFile (hubDir().getChildFile ("models_cache.json"));
        const auto cards = json::get (cache, "models");
        if (cards.isArray()) { cachedCards = cards; haveList = true; }
        const auto queue = json::readFile (hubDir().getChildFile ("pending.json"));   // kept alive while iterating
        if (auto* p = queue.getArray())
            for (auto& op : *p) pending.add (op);
        const auto m = json::readFile (hubDir().getChildFile ("idmap.json"));
        if (auto* o = m.getDynamicObject())
            for (auto& kv : o->getProperties()) idMap.set (kv.name, kv.value);
    }

    void ModelHub::savePending()
    {
        hubDir().createDirectory();
        json::atomicWriteJson (hubDir().getChildFile ("pending.json"), var (pending));
        auto* o = new juce::DynamicObject();
        for (auto& kv : idMap) o->setProperty (kv.name, kv.value);
        json::atomicWriteJson (hubDir().getChildFile ("idmap.json"), var (o));
    }

    void ModelHub::saveCache()
    {
        hubDir().createDirectory();
        json::atomicWriteJson (hubDir().getChildFile ("models_cache.json"),
                               json::object ({ { "saved_at", juce::Time::getCurrentTime().toISO8601 (true) }, { "hub", hubUrl() }, { "models", cachedCards } }));
    }

    // ------------------------------------------------------------------------------------------ list
    const ModelHub::Model* ModelHub::find (const String& id) const
    {
        const auto real = resolve (id);
        for (auto& m : list) if (m.id == id || m.id == real) return &m;
        return nullptr;
    }

    String ModelHub::resolve (const String& id) const
    {
        const auto* v = idMap.getVarPointer (juce::Identifier (id.isEmpty() ? String ("_") : id));
        return v != nullptr ? v->toString() : id;
    }

    void ModelHub::rebuild()
    {
        list.clear();
        const auto me = Settings::localIdentity();
        if (auto* cards = cachedCards.getArray())
        {
            for (auto& c : *cards)
            {
                Model m;
                m.id = json::getString (c, "hash");
                if (m.id.isEmpty()) continue;
                m.name = json::getString (c, "name");
                if (m.name.isEmpty()) m.name = "(untitled)";
                m.parentId = json::getString (c, "parentId");
                m.parentId2 = json::getString (c, "parentId2");
                m.createdMs = isoMs (json::getString (c, "manifest/created_at"));
                juce::int64 edited = 0;
                if (auto* eds = json::get (c, "editors").getArray())
                    for (auto& e : *eds) edited = juce::jmax (edited, isoMs (json::getString (e, "lastEditAt")));
                m.editedMs = edited > 0 ? edited : isoMs (json::getString (c, "historical/registeredAt"));
                std::set<String> contrib;
                if (auto* cr = json::get (c, "creators").getArray())
                    for (auto& e : *cr) if (auto n = json::getString (e, "name"); n.isNotEmpty()) { m.creators.addIfNotAlreadyThere (n); contrib.insert (n); }
                if (auto* o = json::get (c, "contributions").getDynamicObject())
                    for (auto& kv : o->getProperties()) contrib.insert (kv.name.toString());
                m.contributors = (int) contrib.size();
                m.up = (int) json::getNumber (c, "votes/up");
                m.down = (int) json::getNumber (c, "votes/down");
                m.myVote = (int) json::getNumber (c, "myVote");
                if (auto* bk = json::get (c, "bakes").getArray())
                    for (auto& b : *bk) if (auto id = json::getString (b, "id"); id.isNotEmpty()) m.bakeIds.add (id);
                // STATE: the same words panel.html's modelStateText() uses; the bake count is added
                // by the MODEL page (it also knows this Library's own Bakes).
                const auto training = json::getString (c, "trainingState");
                const bool usable = json::getBool (c, "usability/usable", true);
                const auto lineage = json::getString (c, "lineageStatus");
                if (json::getString (c, "pickleScan/status") == "flagged") m.state = "flagged";
                else if (training == "training") m.state = "training";
                else if (json::has (c, "usability") && ! usable) m.state = (lineage == "previous-seed" || lineage == "ancestor") ? "archived" : "unavailable";
                else if (training == "ready") m.state = "ready";
                list.push_back (m);
            }
        }
        // changes still on their way to the hub, shown as if already made
        for (auto& op : pending)
        {
            const auto sel = json::getString (op, "sel");
            auto* args = json::get (op, "args").getArray();
            if (args == nullptr) continue;
            if (sel == "newSeed" || sel == "branch")
            {
                Model m;
                m.id = json::getString (op, "tempId");
                m.name = sel == "newSeed" ? (*args)[0].toString() : (*args)[1].toString();
                m.parentId = sel == "branch" ? resolve ((*args)[0].toString()) : String();
                m.creators.add (me);
                m.createdMs = m.editedMs = (juce::int64) json::getNumber (op, "at");
                m.pending = true;
                list.push_back (m);
            }
            else if (sel == "vote" || sel == "addBake")
            {
                const auto target = resolve ((*args)[0].toString());
                for (auto& m : list)
                {
                    if (m.id != target) continue;
                    if (sel == "addBake") { m.bakeIds.addIfNotAlreadyThere (json::getString ((*args)[1], "id")); break; }
                    const auto dir = (*args)[1].toString();
                    const int v = dir == "up" ? 1 : dir == "down" ? -1 : 0;
                    if (m.myVote > 0) --m.up; else if (m.myVote < 0) --m.down;
                    if (v > 0) ++m.up; else if (v < 0) ++m.down;
                    m.up = juce::jmax (0, m.up); m.down = juce::jmax (0, m.down);
                    m.myVote = v;
                    break;
                }
            }
        }
        std::sort (list.begin(), list.end(), [] (const Model& a, const Model& b) { return a.createdMs < b.createdMs; });
    }

    // ------------------------------------------------------------------------------------------ changes
    void ModelHub::enqueue (const String& sel, const juce::Array<var>& args, const String& tempId)
    {
        auto op = json::object ({ { "opId", newOpId() }, { "sel", sel }, { "args", var (args) },
                                  { "at", (juce::int64) juce::Time::currentTimeMillis() } });
        if (tempId.isNotEmpty()) op.getDynamicObject()->setProperty ("tempId", tempId);
        pending.add (op);
        savePending();
        rebuild();
        sendChangeMessage();
        syncNow();
    }

    String ModelHub::createModel (const String& name, const String& parentId)
    {
        const auto tempId = "pending-" + juce::Uuid().toString().substring (0, 12);
        const auto me = Settings::localIdentity();
        if (parentId.isEmpty()) enqueue ("newSeed", { name, me }, tempId);
        else                    enqueue ("branch", { resolve (parentId), name, me }, tempId);
        return tempId;
    }

    void ModelHub::vote (const String& id, int value)
    {
        enqueue ("vote", { resolve (id), value > 0 ? "up" : value < 0 ? "down" : "0", Settings::localIdentity(), "plugin" });
    }

    void ModelHub::addBake (const String& modelId, const String& bakeId, const String& notation, double bars)
    {
        if (modelId.isEmpty() || bakeId.isEmpty()) return;
        enqueue ("addBake", { resolve (modelId),
                              json::object ({ { "id", bakeId }, { "n", notation.isNotEmpty() ? notation : bakeId }, { "bars", bars },
                                              { "createdAt", juce::Time::getCurrentTime().toISO8601 (true) } }),
                              Settings::localIdentity() });
    }

    // ------------------------------------------------------------------------------------------ sync
    void ModelHub::setFastPolling (bool f)
    {
        if (f == fast) return;
        fast = f;
        startTimer (fast ? 2000 : 10000);
        if (fast) syncNow();
    }

    void ModelHub::timerCallback() { syncNow(); }

    static int httpJson (const String& url, const String& postBody, const String& ifNoneMatch, String& text, String& etagOut, int timeoutMs)
    {
        int status = 0;
        juce::URL u (url);
        String headers = "Accept: application/json\r\n";
        if (postBody.isNotEmpty()) { headers << "Content-Type: application/json\r\n"; u = u.withPOSTData (postBody); }
        if (ifNoneMatch.isNotEmpty()) headers << "If-None-Match: " << ifNoneMatch << "\r\n";
        juce::StringPairArray responseHeaders;
        auto opts = juce::URL::InputStreamOptions (postBody.isNotEmpty() ? juce::URL::ParameterHandling::inPostData
                                                                         : juce::URL::ParameterHandling::inAddress)
                        .withExtraHeaders (headers)
                        .withConnectionTimeoutMs (timeoutMs)
                        .withResponseHeaders (&responseHeaders)
                        .withStatusCode (&status);
        if (auto in = u.createInputStream (opts))
        {
            text = in->readEntireStreamAsString();
            for (auto& k : responseHeaders.getAllKeys())
                if (k.equalsIgnoreCase ("etag")) etagOut = responseHeaders[k].trim();
        }
        else if (status == 0) return 0;
        return status;
    }

    void ModelHub::syncNow()
    {
        if (syncing.exchange (true)) return;
        const auto base = hubUrl();
        const auto ops = pending;                   // snapshot: sent in order
        std::map<String, String> known;             // temp -> real, incl. ones learned in this batch
        for (auto& kv : idMap) known[kv.name.toString()] = kv.value.toString();
        const auto voter = Settings::localIdentity();
        const auto lastEtag = etag;
        auto weak = alive;
        juce::Thread::launch ([this, weak, base, ops, known, voter, lastEtag]() mutable
        {
            SyncResult res;
            auto mapId = [&] (const var& v) { auto s = v.toString(); auto it = known.find (s); return it != known.end() ? var (it->second) : v; };
            bool reachable = true;
            for (auto& op : ops)
            {
                auto sel = json::getString (op, "sel");
                juce::Array<var> args;
                if (auto* a = json::get (op, "args").getArray()) args = *a;
                if (sel == "branch" || sel == "vote" || sel == "addBake") if (! args.isEmpty()) args.set (0, mapId (args[0]));
                const auto body = juce::JSON::toString (json::object ({ { "sel", sel }, { "args", var (args) }, { "opId", json::getString (op, "opId") } }), true);
                String text, et;
                const int status = httpJson (base + "/api/models", body, {}, text, et, 4000);
                if (status == 0) { reachable = false; break; }
                res.reached = true;
                const auto reply = juce::JSON::parse (text);
                if (status == 200 && json::getBool (reply, "ok"))
                {
                    const auto temp = json::getString (op, "tempId");
                    const auto real = json::getString (reply, "data/hash");
                    if (temp.isNotEmpty() && real.isNotEmpty()) { known[temp] = real; res.remaps.push_back ({ temp, real }); }
                    res.doneOps.add (json::getString (op, "opId"));
                }
                else if (status >= 400 && status < 500 && status != 404 && status != 408)
                {
                    res.errors.add (sel + ": " + json::getString (reply, "error", "HTTP " + String (status)));
                    res.doneOps.add (json::getString (op, "opId"));      // won't ever succeed -- drop it
                }
                else if (status == 200)
                {
                    // the hub understood but refused (unknown model, bad args ...): drop with a message
                    res.errors.add (sel + ": " + json::getString (reply, "error", "refused"));
                    res.doneOps.add (json::getString (op, "opId"));
                }
                else { reachable = false; break; }                     // 404 = an old hub without /api/models, 5xx: retry later
            }
            if (reachable)
            {
                String text, et;
                const int status = httpJson (base + "/api/models?voter=" + juce::URL::addEscapeChars (voter, true), {}, lastEtag, text, et, 4000);
                if (status == 200)
                {
                    const auto reply = juce::JSON::parse (text);
                    if (json::get (reply, "models").isArray()) { res.reached = true; res.listChanged = true; res.cards = json::get (reply, "models"); res.etag = et; }
                }
                else if (status == 304) res.reached = true;
                else res.reached = false;
            }
            else res.reached = false;
            juce::MessageManager::callAsync ([this, weak, res]() mutable
            {
                if (! weak->load()) return;
                applySync (std::move (res));
                syncing.store (false);
            });
        });
    }

    void ModelHub::applySync (SyncResult res)
    {
        const bool wasConnected = isConnected;
        isConnected = res.reached;
        bool changed = wasConnected != isConnected;
        if (! res.doneOps.isEmpty())
        {
            for (int i = pending.size(); --i >= 0;)
                if (res.doneOps.contains (json::getString (pending[i], "opId"))) pending.remove (i);
            changed = true;
        }
        for (auto& [from, to] : res.remaps)
        {
            idMap.set (from, to);
            remapLibrary (from, to);
        }
        if (! res.doneOps.isEmpty() || ! res.remaps.empty()) savePending();
        if (res.listChanged)
        {
            cachedCards = res.cards;
            etag = res.etag;
            haveList = true;
            saveCache();
            changed = true;
        }
        for (auto& e : res.errors) { DBG ("ModelHub: " + e); juce::ignoreUnused (e); }
        if (changed)
        {
            rebuild();
            sendChangeMessage();
        }
        // anything still queued goes out on the next tick
    }

    void ModelHub::remapLibrary (const String& from, const String& to)
    {
        // Bakes made while a pending model was current recorded its temporary id.
        for (auto& f : root.getChildFile ("bakes").findChildFiles (juce::File::findDirectories, false, "bk_*"))
        {
            const auto bf = f.getChildFile ("bake.json");
            auto v = json::readFile (bf);
            if (json::getString (v, "model_id") != from) continue;
            if (auto* o = v.getDynamicObject()) { o->setProperty ("model_id", to); json::atomicWriteJson (bf, v); }
        }
    }
}
