import io

path = "gui_hub_bridge.js"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

anchor = '''function handleChat(text, replyTo) {
  if (cricketThinking) {
    replyTo({ t: "chatError", msg: "still thinking about the last one — one at a time" });
    return;
  }
  cricketThinking = true;
  broadcast({ t: "chatThinking" });
  callCricket(text)
    .then((reply) => {
      cricketThinking = false;
      broadcast(Object.assign({ t: "chatReply" }, splitCricketReply(reply)));
    })
    .catch((e) => {
      cricketThinking = false;
      broadcast({ t: "chatError", msg: e.message });
    });
}
'''

assert src.count(anchor) == 1, "anchor not found or not unique: %d" % src.count(anchor)

insertion = anchor + '''
// ── CRICKET (ambient + private DM) ────────────────────────────────────────
// handleChat()/callCricket()/chatHistory above are untouched -- they still
// serve the OGTM instrument console exactly as before (bare {t:"chat"},
// synchronous Ollama call, reply broadcast to every connected panel, one
// shared chatHistory -- "one instrument, one operator", per that block's
// own comment). Everything below is new and serves a different surface:
// OMSC's public social room. Three browser-originated shapes now share
// the WebSocket dispatch's "chat" branch (see the dispatch itself, further
// down this file) --
//   {t:"chat", text}                                -- OGTM console (unchanged)
//   {t:"chat", text, room:"public", who}             -- OMSC public room message,
//                                                        observe-only: stored for
//                                                        the periodic ambient check
//                                                        below, never itself
//                                                        triggers Ollama
//   {t:"chat", text, private:true, target:"cricket"} -- OMSC ":msg cricket ..." /
//                                                        an open Cricket DM,
//                                                        synchronous like the
//                                                        console, but replied to
//                                                        ONLY the sending socket
// This is the fix for "every public message invokes Ollama": a plain OMSC
// room message no longer reaches callCricket() at all. Cricket only speaks
// in the public room when checkCricketAmbient() below, on its own timer,
// decides she has something to say.

// AMBIENT_RECENT -- a short rolling window of recent OMSC public-room lines
// (NOT chatHistory -- see the note on spec item 5 in the task this was
// built against: ambient observation must not pollute the real, private
// Cricket conversation chatHistory/callCricket() already maintain). Capped
// hard rather than grown -- dumping the whole room history into every
// ambient prompt would balloon both the request and what Cricket is
// implicitly asked to react to.
const AMBIENT_CONTEXT_MAX = 12;
let ambientRecent = []; // [{who, text}]
let ambientActivitySinceCheck = false;

function observePublicChat(who, text) {
  ambientRecent.push({ who: who || "anon", text });
  if (ambientRecent.length > AMBIENT_CONTEXT_MAX) ambientRecent.shift();
  ambientActivitySinceCheck = true;
}

// handleCricketDM -- same shape as handleChat() above (same cricketThinking
// gate, same callCricket()/chatHistory -- a Cricket DM is still "the user
// explicitly talking to Cricket", so it uses the real conversation engine
// normally, per spec item 5), but replies ONLY to the requesting socket
// instead of broadcast(). private:true on every reply frame is what tells
// the browser side (see gnumbat-live.js's chatThinking/chatReply/chatError
// listeners, and panel.html's new private-flagged ones) that this is a DM
// reply and not the OGTM console's.
function handleCricketDM(text, replyTo) {
  if (cricketThinking) {
    replyTo({ t: "chatError", private: true, msg: "still thinking about the last one — one at a time" });
    return;
  }
  cricketThinking = true;
  replyTo({ t: "chatThinking", private: true });
  callCricket(text)
    .then((reply) => {
      cricketThinking = false;
      replyTo(Object.assign({ t: "chatReply", private: true }, splitCricketReply(reply)));
    })
    .catch((e) => {
      cricketThinking = false;
      replyTo({ t: "chatError", private: true, msg: e.message });
    });
}

// AMBIENT_SYSTEM -- additive to CRICKET_SYSTEM (not a replacement for it --
// CRICKET_SYSTEM itself stays exactly as declared above), same persona/
// voice/rules/knowledge base, plus instructions specific to unprompted
// observation of a room instead of answering a direct message. Spec item 6
// asked specifically for an occasional-fun-fact-about-computer-viruses-plus-
// a-friendly-cybersecurity-reminder flavor of contribution (fitting, for a
// project called "Gnumbat") -- named here as one thing Cricket
// might reach for, not the only thing, and NO_REPLY stays the overwhelming
// default so she doesn't talk over an active human conversation.
const AMBIENT_SYSTEM = `${CRICKET_SYSTEM}

--- AMBIENT MODE ---
You are passively observing the Gnumbat public chat room -- a room of people talking to each other, not to you. You'll be shown a short window of the most recent public messages.
Most check-ins should end with you saying nothing at all. If you don't have anything genuinely pertinent to add right now, respond with EXACTLY:
NO_REPLY
and nothing else -- no punctuation, no quotes, no extra words on that line or any other.
Only break silence when something in the recent messages genuinely calls for a reply, or -- occasionally, not every time -- to share a short, true, fun fact about computer viruses or malware history, paired with a friendly, non-preachy cybersecurity reminder. Don't force this every check-in; silence (NO_REPLY) should still be the common outcome.
When you do speak, write ONE short public chat message in your normal voice, as yourself -- no name prefix, the room already shows who's speaking. Never repeat a fact or line you or someone else already said recently in the window you were shown.
Keep personal or sensitive information off Gnumbat -- don't post anything you wouldn't want made public, and don't invent or repeat anyone's private details.
This is a social room, not the instrument console -- never emit engine commands here, even if a command name would otherwise apply.`;

// callCricketAmbient -- deliberately NOT callCricket(): callCricket() reads
// and appends to the module-level chatHistory, which is exactly the
// pollution spec item 5 warns against for ambient/public observation. This
// is a plain one-off Ollama call with its own throwaway messages array,
// nothing persisted after the response comes back. Small, intentional
// duplication of callCricket()'s HTTP-call plumbing rather than reshaping
// callCricket() itself to take an optional history -- the task this was
// built against was explicit: do not rewrite callCricket().
function callCricketAmbient(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: ollamaModel, messages, stream: false });
    const req = http.request({
      hostname: ollamaHost,
      port: ollamaPort,
      path: "/api/chat",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 60000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const reply = json.message && json.message.content;
          if (!reply) { reject(new Error("no response — check --ollama-model (" + ollamaModel + ")")); return; }
          resolve(reply);
        } catch (e) {
          reject(new Error("parse error: " + e.message));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("ollama timed out — model may be overloaded")); });
    req.on("error", () => { reject(new Error("ollama unreachable — is it running? (" + ollamaHost + ":" + ollamaPort + ")")); });
    req.write(body);
    req.end();
  });
}

// checkCricketAmbient -- the periodic mechanism itself (spec: "separate
// from the normal public-message path", "if there's already a suitable
// timer/heartbeat, reuse it, otherwise implement a simple periodic check" --
// nothing pre-existing in this hub fires on a plain interval independent of
// OSC/telemetry traffic, so this is a new, simple setInterval, started from
// start() below). Skips out quietly (no broadcast, no error to anyone) when:
// there's an Ollama call already in flight (shares cricketThinking with
// handleChat()/handleCricketDM() -- this is still one local model, one
// request at a time), or nothing new has been said in the room since the
// last check (an empty/idle room shouldn't get commented into).
const AMBIENT_CHECK_INTERVAL_MS = 90000;
function checkCricketAmbient() {
  if (cricketThinking) return;
  if (!ambientActivitySinceCheck || ambientRecent.length === 0) return;
  ambientActivitySinceCheck = false;

  const transcript = ambientRecent.map((m) => m.who + ": " + m.text).join("\\n");
  const messages = [
    { role: "system", content: AMBIENT_SYSTEM },
    { role: "user", content: "Recent public chat in the room:\\n" + transcript },
  ];
  cricketThinking = true;
  callCricketAmbient(messages)
    .then((reply) => {
      cricketThinking = false;
      const text = (reply || "").trim();
      // Suppressed completely -- spec: "the hub must suppress NO_REPLY
      // completely -- it must NOT appear in public chat." No frame sent
      // at all, same as "nothing pertinent" being genuinely silent.
      if (!text || text === "NO_REPLY") return;
      broadcast({ t: "cricketAmbient", text });
    })
    .catch((e) => {
      cricketThinking = false;
      post("ambient cricket check failed: " + e.message);
    });
}
'''

src = src.replace(anchor, insertion, 1)
with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: inserted ambient/DM block")
