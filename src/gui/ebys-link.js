/* gnumbat-link.js — the panel's only connection to the instrument.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE PANEL
 * ----------------------------------------------
 * The panel is currently pointed at two futures at once and it is not yet
 * decided which one wins (see VST_PLUGIN_ROADMAP.md):
 *
 *   A. a browser window driving the live Pd instrument, over WebSocket to
 *      gui_hub_bridge.js — what runs today;
 *   B. the same HTML loaded inside a JUCE WebBrowserComponent as the plugin's
 *      own UI, where there is no socket and the C++ side injects native
 *      functions into the page instead.
 *
 * Everything that differs between A and B is in this file and nowhere else.
 * The panel calls Gnumbat.send(...) and Gnumbat.on(...) and never learns which
 * transport it got. Choosing B later means writing one more branch in
 * pickTransport() — not touching a single control handler.
 *
 * That is the whole design constraint. It is why the panel does not open a
 * WebSocket itself even though that would be three lines shorter today.
 *
 * MESSAGE SHAPES — the contract with gui_hub_bridge.js
 *   out: {t:'cmd', target:'slicer'|'analyze'|'patch', sel:'next', args:[...]}
 *   out: {t:'chat', text:'...'}   — Cricket; see gui_hub_bridge.js's CRICKET section
 *   in:  {t:'meter'|'spectrum'|'lufs'|'wave'|'status'|'hello'|'error'|'pong', ...}
 *   in:  {t:'chatThinking'} | {t:'chatReply', prose, commands} | {t:'chatError', msg}
 *   in:  {t:'pipeline', type:'pipelineStage', stage:'demucs'|'genre'|'madmom',
 *          status:'start'|'progress'|'done'|'error', track, percent?, msg?}
 *      | {t:'pipeline', type:'stemsReady', track}
 *      | {t:'pipeline', type:'fileDetected', filename}
 *        — relayed verbatim from watch_demucs.py's post_progress() via
 *          gui_hub_bridge.js's POST /progress handler. 'genre' is the
 *          Essentia (Discogs-EffNet) classifier, 'madmom' is the beat/
 *          downbeat tagger — see gui_hub_bridge.js's own comment on that
 *          route for why this frame didn't exist until now.
 */
(function (global) {
  "use strict";

  var listeners = Object.create(null);
  var queue = [];          // commands issued before the transport is up
  var transport = null;
  var state = "connecting";
  var commands = null;     // filled from the hub's `hello` frame

  function emit(type, payload) {
    var ls = listeners[type];
    if (!ls) return;
    // Copy first: a handler that calls Gnumbat.off() mid-emit must not reindex
    // the array we are walking.
    for (var i = 0, a = ls.slice(); i < a.length; i++) {
      try {
        a[i](payload);
      } catch (e) {
        // One broken display must not take down the telemetry loop — at 20Hz
        // a throwing handler would otherwise stop every other meter too.
        console.error("Gnumbat: handler for '" + type + "' threw", e);
      }
    }
  }

  function setState(s, detail) {
    if (state === s) return;
    state = s;
    emit("_state", { state: s, detail: detail });
  }

  function deliver(text) {
    var msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      console.error("Gnumbat: bad frame", text);
      return;
    }
    if (msg.t === "hello") {
      commands = msg.commands;
      setState("open");
    }
    if (msg.t === "error") {
      // Surfaced rather than swallowed: a rejected command means the panel and
      // the hub disagree about what exists, which is worth seeing immediately.
      console.warn("Gnumbat: hub rejected", msg.of, "—", msg.msg);
    }
    emit(msg.t, msg);
    emit("*", msg);
  }

  /* ── TRANSPORT A: WebSocket to gui_hub_bridge.js ───────────────────────
     Reconnecting, because the hub is a separate process the user will
     restart independently of the browser tab. Backoff caps at 2s: this is
     localhost, and a control surface that takes 30s to notice the engine
     came back is useless in a rehearsal. */
  function wsTransport() {
    var ws = null, backoff = 250, closed = false;

    function open() {
      var url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
      ws = new WebSocket(url);

      ws.onopen = function () {
        backoff = 250;
        // `hello` from the hub is what actually flips state to "open"; until
        // then we only know the socket is up, not that the hub agreed.
        flush();
      };
      ws.onmessage = function (e) { deliver(e.data); };
      ws.onclose = function () {
        if (closed) return;
        setState("reconnecting");
        setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 2000);
      };
      ws.onerror = function () { /* onclose always follows; handled there */ };
    }

    function flush() {
      if (!ws || ws.readyState !== 1) return;
      while (queue.length) ws.send(JSON.stringify(queue.shift()));
    }

    open();
    return {
      name: "websocket",
      send: function (obj) {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
        else queue.push(obj);   // replayed on the next open
      },
      close: function () { closed = true; if (ws) ws.close(); },
    };
  }

  /* ── TRANSPORT B: JUCE WebBrowserComponent native binding ──────────────
     JUCE 8 injects window.__JUCE__ into the page and exposes native functions
     registered on the C++ side. The plugin would register one function
     ("gnumbatCmd") taking the same JSON object the hub takes, and push telemetry
     back by calling a global the page defines (window.__gnumbatRecv).

     Not exercised — there is no JUCE build yet. It is written now because
     writing it later would mean re-auditing every call site to find what
     assumed a socket, which is exactly the cost this file exists to avoid. */
  function juceTransport() {
    global.__gnumbatRecv = function (json) { deliver(json); };
    var backend = global.__JUCE__ && global.__JUCE__.backend;
    // Mirrors the hub's `hello`: without it the panel would sit in
    // "connecting" forever inside the plugin.
    setTimeout(function () { setState("open"); }, 0);
    return {
      name: "juce",
      send: function (obj) {
        if (backend && typeof backend.emitEvent === "function") {
          backend.emitEvent("gnumbatCmd", obj);
        } else {
          console.warn("Gnumbat: JUCE backend missing; dropped", obj);
        }
      },
      close: function () {},
    };
  }

  /* ── TRANSPORT C: detached ─────────────────────────────────────────────
     The panel opened as a plain file:// with nothing behind it. Commands are
     logged, telemetry never arrives, and the mockup's seeded values stay on
     screen. This is what keeps gnumbat-plugin-panel.html openable as a design
     reference with no server running — deliberately not an error state. */
  function nullTransport() {
    setTimeout(function () { setState("detached"); }, 0);
    return {
      name: "detached",
      send: function (obj) { console.log("Gnumbat (detached):", obj); },
      close: function () {},
    };
  }

  function pickTransport() {
    if (global.__JUCE__) return juceTransport();
    if (global.WebSocket && location.protocol.indexOf("http") === 0) return wsTransport();
    return nullTransport();
  }

  var Gnumbat = {
    /* send('slicer', 'next', 'drums')  ->  {t:'cmd',target,sel,args} */
    send: function (target, sel) {
      var rest = Array.prototype.slice.call(arguments, 2);
      var msg = { t: "cmd", target: target, sel: sel, args: rest };
      transport.send(msg);
      return msg;
    },
    /* Convenience wrappers — the three targets, so call sites read as prose
       and a typo in a target name is a missing function rather than a string
       the hub rejects at runtime. */
    slicer: function (sel) {
      return Gnumbat.send.apply(null, ["slicer"].concat(Array.prototype.slice.call(arguments)));
    },
    analyze: function (sel) {
      return Gnumbat.send.apply(null, ["analyze"].concat(Array.prototype.slice.call(arguments)));
    },
    patch: function (sel) {
      return Gnumbat.send.apply(null, ["patch"].concat(Array.prototype.slice.call(arguments)));
    },

    /* chat(text) -> {t:'chat', text}. Not a target/sel/args command — Cricket
       lives in the hub now (see gui_hub_bridge.js's CRICKET section), so this
       is its own top-level message shape. Replies come back as 'chatThinking'
       / 'chatReply' / 'chatError' through the normal Gnumbat.on(...) path below. */
    chat: function (text) {
      var msg = { t: "chat", text: String(text) };
      transport.send(msg);
      return msg;
    },

    /* chatPublicObserve(text, who) -> {t:'chat', text, room:'public'[, who]}.
       OMSC's public room, observe-only -- gui_hub_bridge.js stores it for
       the periodic ambient check (its CRICKET (ambient + private DM)
       section) and does NOT call Ollama or reply for it. Kept as its own
       method rather than an options bag on chat() above so a call site
       reads as what it does, same reasoning as slicer()/analyze()/patch()
       being thin wrappers over send() instead of one generic call. */
    chatPublicObserve: function (text, who) {
      var msg = { t: "chat", text: String(text), room: "public" };
      if (who) msg.who = String(who);
      transport.send(msg);
      return msg;
    },
    /* chatCricketDM(text) -> {t:'chat', text, private:true, target:'cricket'}.
       An explicit Cricket DM (":msg cricket ..." or a message typed while
       ACTIVE_DM === 'cricket' -- see panel.html's handleOmscInput()). Same
       callCricket()/chatHistory engine as chat() above, but the hub replies
       ONLY to the sending socket (private:true on the reply frames) instead
       of broadcasting -- see gnumbat-live.js's and panel.html's chatThinking/
       chatReply/chatError listeners, which branch on that flag. */
    chatCricketDM: function (text) {
      var msg = { t: "chat", text: String(text), private: true, target: "cricket" };
      transport.send(msg);
      return msg;
    },

    /* chatEdit(text) -> {t:'editChat', text}. EDIT INTERFACE mode -- Cricket
       as a local coding agent against this repo (see src/gui/edit_agent.js
       and gui_hub_bridge.js's own editChat dispatch branch). A distinct
       top-level frame type from chat()/chatCricketDM() above, same reason
       chat() itself got its own shape instead of being a `cmd` variant:
       this is a structurally different exchange (multi-step tool use, not
       one Ollama round trip), even though it is still "the user typing at
       Cricket". Replies come back as 'editThinking' / 'editStep' /
       'editReply' / 'editError' / 'reloadUI' through the normal
       Gnumbat.on(...) path below -- nothing here needs to know that shape,
       same as every other message type this transport just re-emits by
       its own `t`. */
    chatEdit: function (text) {
      var msg = { t: "editChat", text: String(text) };
      transport.send(msg);
      return msg;
    },

    /* editBegin() -> {t:'editBegin'}. The panel entered edit mode (or
       reloaded while in it): the hub makes sure the seed snapshot exists and
       answers with an 'editState' frame {dirty, changed, head, headName}.
       editCommit(name) -> {t:'editCommit', name}. ^R in edit mode: snapshot
       the current frontend files as a NEW named branch; answers with
       'editCommitResult' {ok, branch|error}, and every panel receives the
       updated 'branches' frame. branchesList() asks for that frame on
       demand. See edit_agent.js's "EDIT-MODE COMMITS" comment. */
    editBegin: function () {
      var msg = { t: "editBegin" };
      transport.send(msg);
      return msg;
    },
    editCommit: function (name) {
      var msg = { t: "editCommit", name: String(name) };
      transport.send(msg);
      return msg;
    },
    /* branchEnter(id) -> {t:'branchEnter', id}. Network page Enter: the hub
       restores that branch's snapshot and answers 'branchEnterResult'
       {ok, branch|error}; on success every panel gets 'reloadUI'. */
    branchEnter: function (id) {
      var msg = { t: "branchEnter", id: String(id) };
      transport.send(msg);
      return msg;
    },
    branchesList: function () {
      var msg = { t: "branchesList" };
      transport.send(msg);
      return msg;
    },

    /* roomJoin(roomId) -> {t:'roomJoin', room}. This panel is now in that room
       (a model id); null leaves. The hub answers every panel with
       'roomPresence' {counts:{roomId:n}} whenever any count changes, and
       forgets the room itself when the socket closes -- so a fresh
       connection has to say it again (panel.html does, on '_state' open). */
    roomJoin: function (room) {
      var msg = { t: "roomJoin", room: room ? String(room) : null };
      transport.send(msg);
      return msg;
    },

    on: function (type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
      return fn;
    },
    off: function (type, fn) {
      var ls = listeners[type];
      if (!ls) return;
      var i = ls.indexOf(fn);
      if (i >= 0) ls.splice(i, 1);
    },

    get state() { return state; },
    get transport() { return transport ? transport.name : null; },
    /* What the hub said it accepts. null until `hello` arrives (and always
       null on the JUCE/detached transports) — callers must treat null as
       "unknown", not as "nothing allowed". */
    get commands() { return commands; },
    supports: function (target, sel) {
      if (!commands) return null;
      return !!(commands[target] && commands[target].indexOf(sel) >= 0);
    },
  };

  transport = pickTransport();
  global.Gnumbat = Gnumbat;
})(window);

