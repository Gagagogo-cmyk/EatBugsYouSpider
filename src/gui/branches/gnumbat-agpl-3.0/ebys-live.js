/* gnumbat-live.js — binds the panel's DOM to the instrument.
 *
 * Loaded AFTER the panel's own inline script, which is what makes this work:
 * classic scripts share one global lexical scope, so the top-level `const`
 * declarations in there (STEMS, drawWave, DB_FLOOR, CLIP_PCT, fit, LOG,
 * renderLog) are all readable from here. Nothing in the panel's markup or
 * rendering code had to change to accommodate this file.
 *
 * DIVISION OF LABOUR
 *   gnumbat-link.js  — how bytes get to the instrument (WebSocket today, a JUCE
 *                   native binding later). Knows nothing about the panel.
 *   gnumbat-live.js  — this file. Knows the panel's DOM and the message shapes,
 *                   and nothing about transports.
 *
 * That split is the whole reason the JUCE decision can stay open: moving into
 * a WebBrowserComponent changes gnumbat-link.js and not one line of this file.
 *
 * ON PAINTING OVER THE MOCKUP
 * The panel renders once from seeded constants and this file overwrites those
 * pixels as real values arrive. Nothing is cleared on connect. That is
 * deliberate — a panel that blanks itself the moment you attach it tells you
 * less than one that shows plausible values and then visibly corrects them,
 * and it keeps panel.html openable as a design reference with no hub running.
 */
(function () {
  "use strict";

  /* ── COMMAND LOG ───────────────────────────────────────────────────────
     Moved up alongside the command-line/chat block below (both used to sit
     after the stem-band metering code — see that block's own comment for
     why). Strict-mode function declarations are block-scoped to whatever
     {} they're written in, not hoisted to the whole IIFE the way they'd be
     in sloppy mode — leaving this one inside the try{} added below would
     have made it invisible to the command-line code that now runs BEFORE
     that try block (confirmed the hard way: "log is not defined" the first
     time this reorder ran, thrown from the Enter-key handler below). */
  function log(kind, text) {
    LOG.push([kind, text]);
    /* renderActiveChat(), not renderLog() directly -- panel.html's own
       #clog now shows OMSC's real chat while that tab is active (see
       renderActiveChat()'s own comment there), and this engine/telemetry
       line is instrument-console content, OGTM-only. renderActiveChat()
       still keeps LOG itself up to date either way (the push above already
       did that) -- it only skips the DOM re-render while OMSC is on
       screen, so switching back to OGTM shows this line already waiting
       rather than lost. */
    renderActiveChat();
    /* fit() call REMOVED — panel.html no longer defines a global fit();
       the old transform:scale() mechanism it drove is gone (user: "dont
       scale it smaller when resizing"). renderLog() mutating #clog is
       already covered by panel.html's own MutationObserver (see its
       PANEL HEIGHT RATCHET block), the same way every other content
       change in this file is, so no explicit call is needed here either. */
  }

  /* ── COMMAND LINE + CHAT ───────────────────────────────────────────────
     MOVED to the very top of this IIFE (was previously after the stem-band
     metering/telemetry setup below). Reason: this file is one long classic
     script — an uncaught throw ANYWHERE earlier in it halts every top-level
     statement after it (see the "CHAT (^C) command reference" comment a bit
     further down for the last time this exact failure mode bit: it silently
     killed buildCommandRef() and was fixed by moving that builder out to
     panel.html entirely). The command line/chat wiring never got the same
     protection — a throw anywhere in the stem-band code that used to run
     BEFORE it (bands/meters/waveforms/entropy knobs, ~430 lines of DOM
     wiring against markup that keeps changing) would leave #cin's real
     listeners never attached, so only the ORIGINAL mockup's Enter-only
     handler (still sitting on the pre-clone node) would still respond —
     which reads exactly like "chat is broken, no autocomplete, no history"
     even though the command-line code itself was never at fault. Leading
     with this block instead means chat/autocomplete/history are wired up
     unconditionally, before anything riskier gets a chance to run; the
     stem-band setup that follows is now also wrapped in its own try/catch
     for the same reason, so a failure there can't take out the footer
     keyboard shortcuts after it either. See that try/catch below.

     The mockup's handler pushed a canned reply for every entry. Those replies
     would now be lies sitting next to real ones, so the input is cloned to
     drop the old listeners outright rather than layered on top of.

     Same split app.js used at its own prompt: a ':'-prefixed line is a raw
     command onto the existing message vocabulary; anything else is free text
     to Cricket. (app.js also had an '@' prefix for language switching — not
     ported, there is nothing on this side yet for it to switch.) */
  var oldCin = document.getElementById("cin");
  var cin = oldCin.cloneNode(true);
  oldCin.parentNode.replaceChild(cin, oldCin);
  /* panel.html's own inline script may have already called .focus() on
     oldCin (the now-detached original) before this swap ran — that focus
     is lost the instant replaceChild happens. Restore it here on the new,
     live node so the input starts out focused/typeable on initial load,
     the same way it will after every later chip-click re-focus.
     {preventScroll:true} — this runs at load time, not from a click; see
     panel.html's own matching comment on its load-time cin.focus() call
     for why an auto-scroll here would be wrong now that the panel isn't
     scaled to guarantee it fits the viewport. */
  cin.focus({preventScroll:true});
  var mirrorEl = document.getElementById("mirror");

  /* A bare word is sent to the slicer, which owns nearly every verb. The
     others are reachable by prefixing the target, e.g. "patch bpm 120" or
     "reader readVocals". Deliberately thin: this is a command line onto the
     existing message vocabulary, not a new language on top of it. Pulled out
     to its own function so Cricket's own command lines (below) go through
     the exact same path a hand-typed ':command' does — one place that knows
     how to turn text into an Gnumbat.send call. */
  var TARGETS = { slicer: 1, analyze: 1, reader: 1, patch: 1 };
  /* resetAll deletes real files with no undo — the analysis library,
     genres, downbeats, gnumbat.db, the whole slicer index, every demucs stem,
     every raw upload (see gui_hub_bridge.js's performResetAll() for the
     exact list). The reference table has always advertised this as
     "(Y/N)", copied from app.js's own confirm gate, but nothing on this
     side ever actually implemented it — untyped, it would have fired on
     the first Enter. This flag arms a genuine second step: typing
     ":resetAll" only prints the warning and sets this true; the VERY NEXT
     line typed into the console — checked in the Enter handler below,
     BEFORE the ":" vs. chat split, so a bare "y" with no colon is caught
     too — is read as the confirm/cancel answer instead of being routed
     normally. Declared here (not inside sendRawCommand) so both that
     function and the Enter handler can see it. */
  var pendingResetAllConfirm = false;
  function sendRawCommand(v) {
    var parts = v.trim().split(/\s+/);
    if (!parts[0]) return;
    var target = TARGETS[parts[0]] ? parts.shift() : "slicer";
    var sel = parts.shift();
    if (target === "slicer" && sel === "resetAll") {
      pendingResetAllConfirm = true;
      log("res", "resetAll wipes analysis_library.json, genres.json, downbeats.json, "
        + "gnumbat.db, the slicer index, every demucs stem, and every raw upload for "
        + "this session — there is no undo. Type \"y\" and press Enter to confirm, "
        + "anything else to cancel.");
      return;
    }
    /* Numeric-looking arguments go as numbers: the hub encodes a JS number as
       an OSC float and anything else as a string, and Pd's [route]/DISPATCH
       both care which they get. */
    var rest = parts.map(function (p) {
      var n = Number(p);
      return p !== "" && isFinite(n) ? n : p;
    });
    Gnumbat.send.apply(null, [target, sel].concat(rest));
  }

  /* Two of Cricket's command names never reach Pd at all — app.js intercepted
     them in the TUI process itself (see its callCricket() callback) rather
     than forwarding them to ws_server.js, and that split carries over here
     unchanged: this panel is the "client" now, same role app.js had. */
  function handleCricketCommand(cmd) {
    var verb = cmd.trim().split(/\s+/)[0];
    if (verb === "showState") {
      log("res", "showState — no state readout wired in this panel yet");
      return;
    }
    if (verb === "showCommands") {
      log("res", "showCommands — see the command line above; whitelisted verbs "
        + "are whatever the hub's 'hello' frame listed (check Gnumbat.commands)");
      return;
    }
    /* "language" is real now too — panel.html's ^A chip/keyboard shortcut
       (setLangHintOpen(), setChatOpen(), chatOpen — all shared top-level
       `let`s in the SAME classic-script scope this file runs in, same
       pattern LOG/MAXLOG/cin already use) opens an actual language picker
       built from src/tui/app.js's own LANGUAGES_BASE list. Previously this
       verb fell all the way through to sendRawCommand() like any other
       Cricket command name and bounced off the hub as unrouted (gui_hub_
       bridge.js's own comment on COMMANDS_ALL vs. its narrower OSC
       COMMANDS whitelist: "language" was never given a Pd target,
       intentionally — see that file). TUI parity: app.js special-cased
       verb === 'language' the exact same way, client-side, rather than
       forwarding it — this just extends that same split to a verb this
       panel previously missed.
       Does NOT reproduce applyLanguage()'s Ollama-side effects (chatHistory
       LANGUAGE LOCK injection, per-language CONFIG.ollama_model swap via
       LANG_MODELS) — those live entirely in the TUI process itself, with
       no equivalent hook exposed by this hub for a client to drive. Picking
       a language here is real, working UI (the panel, the list, the
       click-to-select) but is local display state only; it does not change
       what Cricket actually answers in. */
    if (verb === "language") {
      log("res", "language — pick one from the list.");
      if (typeof setChatOpen === "function" && typeof chatOpen !== "undefined" && !chatOpen) {
        setChatOpen(true);
      }
      if (typeof setLangHintOpen === "function") setLangHintOpen(true);
      return;
    }
    log("cmd", cmd);
    sendRawCommand(cmd);
  }

  /* private:true guards on all three -- gui_hub_bridge.js's handleCricketDM()
     (its CRICKET (ambient + private DM) section) sets that flag on every
     reply to an OMSC Cricket DM (":msg cricket ..."), replying only to the
     sending socket instead of broadcast()ing like the console's own
     handleChat() does. Without this guard, a DM reply arriving at this same
     browser tab (the requester's own tab) would get misfiled into OGTM's
     LOG here as if it were a console reply. panel.html registers its own,
     separate Gnumbat.on("chatThinking"/"chatReply"/"chatError", ...) listeners
     for the private:true case, routing into DMS['cricket'] instead -- see
     its own comment, next to handleOmscInput(). */
  Gnumbat.on("chatThinking", function (m) { if (m && m.private) return; log("res", "cricket — thinking…"); });
  Gnumbat.on("chatReply", function (m) {
    if (m && m.private) return;
    if (m.prose) log("res", m.prose);
    (m.commands || []).forEach(handleCricketCommand);
  });
  Gnumbat.on("chatError", function (m) { if (m && m.private) return; log("res", "cricket — " + m.msg); });

  /* EDIT INTERFACE -- Cricket as a local coding agent (edit_agent.js),
     driven from this same OGTM console/log, same convention as the three
     handlers just above. No `private` concept here (one shared edit
     conversation, same "one instrument, one operator" simplicity the
     console chat above already uses) -- these always render. 'reloadUI'
     is edit_agent.js's reload_ui tool telling every open panel a change
     is ready to look at; panel.html is served fresh off disk on every
     request (see gui_hub_bridge.js's static file handler), so a plain
     reload IS the live-reload mechanism here -- no build step to re-run. */
  // #editStatus (panel.html, near setEditMode()) is the tab-independent
  // toast -- log() alone is invisible while the OMSC tab is active (see
  // that element's own CSS comment for the full story: log()/LOG/
  // renderActiveChat() only paint into #clog when the OGTM tab is
  // showing). Guarded with typeof checks the same way every other
  // cross-file global here is, in case an older cached panel.html is
  // ever served without it.
  Gnumbat.on("editThinking", function () {
    log("res", "cricket (edit) — thinking…");
    if (typeof editStatusShow === "function") editStatusShow("thinking", "Cricket is thinking…");
  });
  Gnumbat.on("editStep", function (m) {
    var t = (m && m.summary) || (m && m.tool) || "…";
    log("res", "cricket (edit) — " + t);
    if (typeof editStatusShow === "function") editStatusShow("thinking", "Cricket — " + t);
  });
  Gnumbat.on("editReply", function (m) {
    if (!(m && m.text)) return;
    log("res", "cricket (edit): " + m.text);
    if (typeof editRequestPending !== "undefined") editRequestPending = false;
    if (typeof editStatusShow === "function") editStatusShow("ok", m.text);
  });
  Gnumbat.on("editError", function (m) {
    var t = (m && m.msg) || "something went wrong";
    log("res", "cricket (edit) — " + t);
    if (typeof editRequestPending !== "undefined") editRequestPending = false;
    if (typeof editStatusShow === "function") editStatusShow("err", t);
  });
  Gnumbat.on("reloadUI", function () {
    log("res", "cricket (edit) — reloading to show the change…");
    /* Stay in edit mode across the reload -- otherwise every change Cricket
       makes would drop the user out of edit mode and the ^R commit chip
       (and the uncommitted-edits state it stands for) would vanish before
       there was ever a chance to commit. panel.html reads this flag once at
       load (see "resume edit mode" next to setEditMode()) and clears it. */
    try { if (typeof editMode !== "undefined" && editMode) sessionStorage.setItem("gnumbat.resumeEditMode", "1"); } catch (e) { /* storage blocked: falls back to the old behaviour */ }
    setTimeout(function () { location.reload(); }, 600);
  });

  /* ── FAKE CURSOR, REAL POSITION ───────────────────────────────────────
     The real <input> is opacity:0 and sits on top of the whole line (see
     .cline input in the CSS) purely to own focus/keystrokes/native caret
     movement — .mirror + .cur underneath are what's actually visible. The
     mockup only ever wrote the full value into .mirror and left .cur as a
     fixed sibling after it, so the block always drew at the END of the
     text — correct for a cursor that only ever appends, wrong the moment
     you click mid-line or use arrow/home/end to move the real (invisible)
     caret elsewhere. It would look right and lie about where typing was
     about to land.
     Fix: split the visible text at the real caret (cin.selectionStart) and
     put .cur textually BETWEEN the two halves instead of computing a pixel
     offset — no font-metrics math, no assumptions about char width, and it
     is exactly what a real inline-flow cursor is: a glyph-width block
     sitting between two runs of text. The "after" half needs a second span,
     which does not exist in the markup — created once here, not in
     panel.html, same convention as this file's other dynamically-built
     bits (the meter/spectrum bar children above). */
  var curEl = document.querySelector("#cline .cur");
  var afterEl = document.createElement("span");
  afterEl.className = "mirror"; // same visual styling as the "before" half
  curEl.parentNode.insertBefore(afterEl, curEl.nextSibling);

  /* Ghost-completion preview — dim text after the cursor, only ever visible
     when afterEl above is empty (cursor at the true end of the line), so the
     two never overlap. Plain inline styles rather than a shared class: it
     needs --g3 grey specifically (not .mirror's white), and nothing else on
     the page currently needs that combination. */
  var ghostEl = document.createElement("span");
  ghostEl.style.color = "var(--g3)";
  ghostEl.style.whiteSpace = "pre";
  afterEl.parentNode.insertBefore(ghostEl, afterEl.nextSibling);

  function syncCursor() {
    var v = cin.value;
    var pos = cin.selectionStart;
    if (pos == null || pos > v.length) pos = v.length; // e.g. right after cin.value is reset
    mirrorEl.textContent = v.slice(0, pos);
    afterEl.textContent = v.slice(pos);
  }

  /* ── GHOST COMPLETION + RIGHT-ARROW ACCEPT/CYCLE ────────────────────────
     Ported from src/tui/app.js's updateSuggestion()/ALL_CMD_VERBS/the Right
     Arrow branch of inputBox._listener — same trigger conditions (cursor at
     the true end, line empty or ':'-prefixed, still on the verb itself, no
     space typed yet), same shortest-match-first ghost preview, same
     press-Right-again cycles through every match / press-anything-else
     drops out of cycling behavior.
     One adaptation: app.js completed against ALL_CMD_VERBS (COMMANDS ∪
     every verb :showCommands lists — Cricket's whole vocabulary, dead
     commands included). This panel completes against Gnumbat.commands
     instead — the hub's own whitelist, exactly what a ':command' here can
     actually do — so Right Arrow never fills in something that's just
     going to bounce off the hub as "not whitelisted". Empty/null until the
     hub's 'hello' frame arrives (see gnumbat-link.js's Gnumbat.commands getter),
     which just means no suggestions until connected — reasonable, there is
     nothing real to suggest before then anyway. */
  function allVerbs() {
    var c = Gnumbat.commands;
    if (!c) return [];
    var set = {};
    Object.keys(c).forEach(function (t) { c[t].forEach(function (v) { set[v] = 1; }); });
    return Object.keys(set);
  }
  function matchingVerbs(typedVerb) {
    return allVerbs()
      .filter(function (v) { return v.length > typedVerb.length && v.indexOf(typedVerb) === 0; })
      .sort(function (a, b) { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0); });
  }
  function bestGhost(typedVerb) {
    var m = matchingVerbs(typedVerb);
    return m.length ? m[0].slice(typedVerb.length) : "";
  }

  var suggestCycle = null; // null, or {lead, candidates, index}

  function updateSuggestion() {
    var v = cin.value, pos = cin.selectionStart;
    var body = (v[0] === ":") ? v.slice(1) : (v === "" ? "" : null);
    var suggestion = (body !== null && pos === v.length && !/\s/.test(body) && body)
      ? bestGhost(body) : "";
    ghostEl.textContent = suggestion;
  }

  cin.addEventListener("input", function () { syncCursor(); updateSuggestion(); });
  cin.addEventListener("keydown", function () {
    // selectionStart isn't updated yet at keydown time for arrow/home/end/
    // click-drag — defer one tick so it reads the post-move value.
    setTimeout(function () { syncCursor(); updateSuggestion(); }, 0);
  });
  cin.addEventListener("click", function () { syncCursor(); updateSuggestion(); });
  // Catches everything else that can move or extend the caret without
  // firing input/keydown/click on cin itself (e.g. Cmd-A select-all,
  // drag-selecting with the mouse released outside the element).
  document.addEventListener("selectionchange", function () {
    if (document.activeElement === cin) { syncCursor(); updateSuggestion(); }
  });

  cin.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && suggestCycle) suggestCycle = null;
    if (e.key !== "ArrowRight") return;

    var v = cin.value, pos = cin.selectionStart;
    if (suggestCycle) {
      e.preventDefault();
      suggestCycle.index = (suggestCycle.index + 1) % suggestCycle.candidates.length;
      cin.value = suggestCycle.lead + suggestCycle.candidates[suggestCycle.index];
      cin.setSelectionRange(cin.value.length, cin.value.length);
      syncCursor(); updateSuggestion();
      return;
    }
    if (pos === v.length && (v === "" || v[0] === ":")) {
      var lead = v === "" ? ":" : ":";
      var body = v === "" ? "" : v.slice(1);
      var candidates = /\s/.test(body) ? [] : matchingVerbs(body);
      if (candidates.length) {
        e.preventDefault();
        suggestCycle = { lead: lead, candidates: candidates, index: 0 };
        cin.value = lead + candidates[0];
        cin.setSelectionRange(cin.value.length, cin.value.length);
        syncCursor(); updateSuggestion();
      }
      // else: no match — fall through, let the browser move the (already
      // end-of-line) caret right as normal, i.e. nothing visibly happens.
    }
    // else: mid-line — let the browser move the caret right as normal.
  });

  /* ── COMMAND HISTORY (up/down arrow) ─────────────────────────────────────
     Ported from src/tui/app.js's cmdHistory/historyIdx + its 'up'/'down' key
     bindings on inputBox, unchanged: most-recent-first array, historyIdx=-1
     means "not browsing, line is whatever was typed", Up walks back through
     older entries (clamped at the oldest), Down walks forward and clears
     back to an empty line once you step past the newest. app.js reserved
     up/down for history everywhere, including its Learn/review tab, after
     finding that letting them double as something else there (session
     browsing) made the same keys do different things depending on which tab
     you were on with no visual cue — so this panel does the same: up/down
     are always history, full stop. setInputValue() there also resets the
     caret to the end of the recalled line and refreshes the ghost preview;
     same here via cin.setSelectionRange + syncCursor/updateSuggestion. */
  var cmdHistory = [];
  var historyIdx = -1;

  function setInputValue(v) {
    cin.value = v;
    cin.setSelectionRange(v.length, v.length);
    syncCursor(); updateSuggestion();
  }

  cin.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (e.key === "ArrowUp") {
      if (cmdHistory.length === 0) return;
      historyIdx = Math.min(historyIdx + 1, cmdHistory.length - 1);
      setInputValue(cmdHistory[historyIdx]);
    } else {
      if (historyIdx <= 0) { historyIdx = -1; setInputValue(""); return; }
      historyIdx--;
      setInputValue(cmdHistory[historyIdx]);
    }
  });

  cin.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var v = cin.value.trim();
    if (!v) return;
    /* EDIT-MODE COMMIT PROMPT -- checked before everything else (including
       the editMode branch below): after ^R the next line typed is the NAME
       of the branch being committed, not a request for Cricket. panel.html
       owns editCommitPrompt/handleEditCommitInput (see requestEditCommit()
       there); Esc cancels it (panel.html's own keydown). */
    if (typeof editCommitPrompt !== "undefined" && editCommitPrompt && typeof handleEditCommitInput === "function") {
      log("cmd", v);
      handleEditCommitInput(v);
      cin.value = "";
      suggestCycle = null;
      syncCursor(); updateSuggestion();
      return;
    }
    cmdHistory.unshift(v);
    historyIdx = -1;
    /* OMSC tab: hand off to panel.html's handleOmscInput() instead of the
       OGTM engine-console path below. panel.html's own #cin listener (the
       one that used to own this -- see its own big comment, near
       renderOmscChat/DMS/ACTIVE_DM) never actually fires: this file clones
       and replaces #cin (above, "the input is cloned to drop the old
       listeners outright") before attaching this listener, which drops
       that earlier listener along with it. handleOmscInput() is the live
       version of that same logic (OMSC_CHAT/DMS/ACTIVE_DM/:msg/:r all
       still live in panel.html's scope, shared with this classic script --
       see this file's own header on why that sharing works), plus the new
       Cricket bits (no auto-Ollama-call for a plain public line; a DM whose
       target is exactly 'cricket' does still call Ollama, privately -- see
       gui_hub_bridge.js's CRICKET (ambient + private DM) section). OGTM
       (the engine console below -- resetAll confirm, ":"-command dispatch,
       bare-text-to-Cricket) is untouched either way. */
    // EDIT INTERFACE -- checked before the OMSC-tab handoff (and before
    // pendingResetAllConfirm) on purpose: editMode must intercept typed
    // input regardless of which tab (OGTM or OMSC/[CRKT]) is currently
    // showing. Previously this check lived further down, after the
    // onOmscTab early-return below, which meant any request typed while
    // OMSC was the active tab (the default tab) never reached this branch
    // at all -- it fell into handleOmscInput() instead, which for a bare
    // line only appends locally and calls chatPublicObserve(), which by
    // design never calls Ollama. That is why EDIT INTERFACE requests
    // appeared to silently do nothing.
    if (typeof editMode !== "undefined" && editMode) {
      log("cmd", v);
      // See editRequestPending's own comment (panel.html, above editMode's
      // declaration) -- marks the request as in-flight the instant it's
      // sent, so switching to chat mode before it finishes doesn't hide
      // its progress toast and look like it was cancelled.
      if (typeof editRequestPending !== "undefined") editRequestPending = true;
      Gnumbat.chatEdit(v);
      cin.value = "";
      suggestCycle = null;
      syncCursor(); updateSuggestion();
      return;
    }
    var onOmscTab = typeof omscView !== "undefined" && omscView && !omscView.classList.contains("hide");
    if (onOmscTab && typeof handleOmscInput === "function") {
      handleOmscInput(v);
      cin.value = "";
      suggestCycle = null;
      syncCursor(); updateSuggestion();
      return;
    }
    if (pendingResetAllConfirm) {
      /* Checked BEFORE the ":" vs. chat split below, on purpose — "y" typed
         bare (no colon) is a chat line as far as that split is concerned,
         and would otherwise go straight to Cricket instead of confirming
         anything. This is why resetAll appeared to "do nothing" before:
         the only way to actually confirm it was retyping the whole command
         with "yes" appended, and a bare "y" reply — the natural response to
         the warning — silently became a Cricket chat message instead. */
      pendingResetAllConfirm = false;
      log("cmd", v);
      if (v.toLowerCase() === "y" || v.toLowerCase() === "yes") {
        log("res", "resetAll confirmed — wiping session...");
        Gnumbat.send("slicer", "resetAll", "confirmed");
      } else {
        log("res", "resetAll cancelled.");
      }
      cin.value = "";
      suggestCycle = null;
      syncCursor(); updateSuggestion();
      return;
    }
    if (v[0] === ":") {
      var raw = v.slice(1).trim();
      if (raw) { sendRawCommand(raw); log("cmd", raw); }
    } else {
      // editMode is handled earlier now (see the EDIT INTERFACE
      // short-circuit above, before the OMSC-tab handoff) -- by the time
      // we get here editMode is always off, so bare text always means a
      // normal Cricket-as-instrument-operator chat line.
      log("cmd", v);
      Gnumbat.chat(v);
    }
    cin.value = "";
    suggestCycle = null;
    syncCursor(); updateSuggestion();
  });
  /* ── CHAT (^C) command reference — MOVED to panel.html ────────────────
     Used to live here (COMMAND_HELP / REF_SECTIONS / buildCommandRef /
     chatRefEl population), but this file is one long classic script: an
     uncaught throw anywhere earlier in it halts every top-level statement
     after it, including whatever built and populated chatRef, while
     panel.html's own inline script — the one that actually opens/closes
     chat via setChatOpen() — is a separate <script> element and keeps
     running regardless. A report of chat opening (title rule + log, both
     panel.html's doing) with the reference area truly blank (not even
     buildCommandRef()'s own "not connected yet" placeholder) pointed
     straight at that split, so the whole builder now lives in panel.html
     next to setChatOpen(), where it doesn't depend on the rest of this
     file surviving intact. See panel.html's own "COMMAND REFERENCE"
     comment for the full writeup. Nothing below this file references
     COMMAND_HELP/REF_SECTIONS/buildCommandRef/chatRefEl anymore. */
  // setChatOpen()/chatChip's onclick, and the whole command-reference
  // builder, are panel.html's own now (see its "COMMAND REFERENCE" and
  // "CHAT (^C)" sections) — this file doesn't touch chat at all anymore.
  document.getElementById("cline").onclick = function () { cin.focus(); };
  cin.focus({preventScroll:true}); // load-time call — see the earlier cin.focus() comment in this file
  syncCursor(); updateSuggestion();

  try {
  /* Panel row order is fixed by the STEMS array in the inline script:
     VOCALS, MELODY, BASS, DRUMS. The engine's names differ for exactly one of
     them — "melo", not "melody" — which is the sort of thing that silently
     drops a quarter of the telemetry, so it gets a table rather than a
     .toLowerCase(). */
  var STEM_KEY = ["vocals", "melo", "bass", "drums"];
  var rowOf = {};
  STEM_KEY.forEach(function (k, i) { rowOf[k] = i; });
  /* Tolerated aliases: slicer.js says "melody" in some of its own outlet
     tags even though the patch says "melo". Accepting both here costs
     nothing and avoids a whole class of silent no-op. */
  rowOf.melody = 1;

  var bands = [].slice.call(document.querySelectorAll("#bands .band"));
  if (bands.length !== 4) {
    console.warn("Gnumbat live: expected 4 stem bands, found " + bands.length +
                 " — the panel's markup changed and these bindings need a look");
  }

  /* Query once. At 20Hz x 4 stems x (2 meters + 64 bars) a per-frame
     querySelectorAll is the difference between a panel that idles and one
     that pins a core. */
  var ui = bands.map(function (b) {
    return {
      el: b,
      meters: [].slice.call(b.querySelectorAll(".bc4 .mpair .vmtr")),
      barsFld: b.querySelector(".col-spx .fld"),
      bars: [].slice.call(b.querySelectorAll(".col-spx .fld .bar")),
      db: b.querySelector(".bc4 .hdr.meth .mv"),
      wave: b.querySelector(".prog .wv"),
      slices: b.querySelector(".bc-map .val.hi"),
    };
  });

  /* ── TELEMETRY ─────────────────────────────────────────────────────── */

  function pct(v) {
    return (v <= 0 ? 0 : v >= 1 ? 100 : v * 100).toFixed(1) + "%";
  }

  /* Linear magnitude -> the panel's own 0..-50dB plot scale. The conversion
     lives here rather than in Pd because Pd vanilla has no [log~], and here
     rather than in the hub because it is a property of THIS plot's height —
     a different display would want a different floor. */
  function toPlot(mag) {
    if (!(mag > 0)) return 0;
    var db = 20 * Math.log10(mag);
    if (db < DB_FLOOR) return 0;
    if (db > 0) db = 0;
    return (db - DB_FLOOR) / (0 - DB_FLOOR);
  }

  /* Peak hold: the little tick above the bar. The engine sends instantaneous
     peak; the hold and its fall-back are a display convention, so they belong
     to the panel, not to the patch. */
  var HOLD_MS = 900, FALL_PER_S = 0.55;
  var holds = [[0, 0], [0, 0], [0, 0], [0, 0]];
  var holdAt = [[0, 0], [0, 0], [0, 0], [0, 0]];

  Gnumbat.on("meter", function (m) {
    var r = rowOf[m.stem];
    if (r === undefined || !ui[r]) return;
    var u = ui[r], now = performance.now();

    for (var ch = 0; ch < 2 && ch < u.meters.length; ch++) {
      var v = m.peak[ch] || 0;
      var bar = u.meters[ch].querySelector("i");
      var tick = u.meters[ch].querySelector("b");
      /* A silent stem renders as an empty .vmtr in the mockup, so the child
         elements may not exist until the first real signal arrives. */
      if (!bar) {
        u.meters[ch].innerHTML = "<i></i><b></b>";
        bar = u.meters[ch].querySelector("i");
        tick = u.meters[ch].querySelector("b");
      }
      bar.style.height = pct(v);

      if (v >= holds[r][ch]) {
        holds[r][ch] = v;
        holdAt[r][ch] = now;
      } else if (now - holdAt[r][ch] > HOLD_MS) {
        holds[r][ch] = Math.max(v, holds[r][ch] - FALL_PER_S * 0.05);
      }
      if (tick) tick.style.bottom = pct(holds[r][ch]);
    }
  });

  Gnumbat.on("spectrum", function (m) {
    var r = rowOf[m.stem];
    if (r === undefined || !ui[r]) return;
    var u = ui[r];
    /* The mockup draws an empty field for a silent stem; build the 64 bars on
       first real spectrum rather than assuming they are there. */
    if (u.bars.length !== 64 && u.barsFld) {
      u.barsFld.innerHTML = Array.from({ length: 64 },
        function () { return '<div class="bar"></div>'; }).join("");
      u.bars = [].slice.call(u.barsFld.querySelectorAll(".bar"));
    }
    for (var i = 0; i < 64 && i < u.bars.length; i++) {
      var v = toPlot(m.bands[i]);
      var b = u.bars[i];
      b.style.height = (v * 100).toFixed(1) + "%";
      /* Same threshold the mockup used, so a clipping band still lights
         --plotink rather than --plotdata. */
      b.classList.toggle("clip", v >= CLIP_PCT);
    }
  });

  Gnumbat.on("rmsdb", function (m) {
    var r = rowOf[m.stem];
    if (r === undefined || !ui[r] || !ui[r].db) return;
    /* Shown as-is, with no "LUFS" anywhere near it — see stem_telemetry~.pd's
       own note on why that distinction is kept all the way to the glass. */
    ui[r].db.textContent = m.db <= DB_FLOOR ? "-inf" : m.db.toFixed(1);
  });

  /* ── SEGMENT + PLAYHEAD ────────────────────────────────────────────────
     The waveform is not a live scope: it is the stem's whole file, drawn once
     from analysis, with an armed-segment bracket and a playhead over it. So
     it moves with segment SELECTION, not with the signal — which is why this
     is driven by bridge_slicer's outlet 0 and not by any meter.

     UPDATED 2026-08-20: stem_timestretch~.pd now has a real position feed (a
     [line] ramp restarted at 0 the instant "play" actually fires in Pd, run
     over the segment's real duration — see that file's own "POSITION FEED"
     comment, and gui_hub_bridge.js's "position" TELEMETRY entry). The old
     excuse for pure interpolation — "the engine emits a segment once and
     does not stream position" — no longer holds, and the position handler
     below now drives the playhead directly whenever real updates are
     arriving. The interpolation stays as a fallback for the gap between
     "play" firing and the first real sample landing (network/scheduling
     jitter, not something worth blocking the redraw for), and for the rare
     case an update is dropped outright — see REAL_POS_TIMEOUT below. */
  var playing = [null, null, null, null];
  // Wall-clock time (performance.now()) each stem's playhead last moved from
  // a REAL "position" telemetry frame, not the local interpolation. 0 means
  // "no real update yet this segment" — the tick loop below falls back to
  // interpolating from `playing[r]` until one arrives.
  var lastRealPos = [0, 0, 0, 0];
  // If real position updates stop arriving for this long mid-segment (a
  // dropped UDP packet, Pd/Node hiccup, ...), resume interpolating from
  // wherever the last real sample left off rather than freezing the
  // playhead — Pd's own [line] grain is ~20ms, so anything past a few
  // frames means something upstream actually stopped, not just jitter.
  var REAL_POS_TIMEOUT = 250;
  // Last segment each stem actually played, kept around across a "stop"
  // (which nulls `playing[r]` but not this) so a later "resume" — bare, no
  // segment data of its own, see that status handler below — knows what to
  // restart. Never populated for a stem that hasn't played yet this session.
  var lastSeg = [null, null, null, null];

  Gnumbat.on("position", function (m) {
    var r = rowOf[m.stem];
    if (r === undefined || !ui[r]) return;
    var p = playing[r];
    if (!p) return; // no armed segment to place this fraction within — ignore
    var frac = Math.max(0, Math.min(1, +m.frac));
    if (!isFinite(frac)) return;
    STEMS[r].ph = p.from + p.span * frac;
    lastRealPos[r] = performance.now();
    redraw(r);
  });

  Gnumbat.on("status", function (m) {
    if (m.key === "play") {
      var a = m.args, r = rowOf[a[0]];
      if (r === undefined || !ui[r]) return;
      var startFrac = +a[2], endFrac = +a[3], ratio = +a[4] || 1, durMs = +a[5];
      if (!isFinite(startFrac) || !isFinite(endFrac)) return;
      STEMS[r].sel = [startFrac, endFrac];
      STEMS[r].ph = startFrac;
      STEMS[r].live = true;
      playing[r] = {
        t0: performance.now(),
        span: endFrac - startFrac,
        ms: (isFinite(durMs) && durMs > 0) ? durMs * ratio : 0,
        from: startFrac,
      };
      // Fresh segment — any real position updates belong to the PREVIOUS
      // one. Reset so the tick loop interpolates from t0 until the first
      // real sample for THIS segment arrives, instead of briefly reusing a
      // stale timestamp from before and skipping frames it has no data for.
      lastRealPos[r] = 0;
      lastSeg[r] = playing[r]; // see "resume" handler below — this is what it replays
      redraw(r);
      return;
    }
    if (m.key === "stop") {
      playing = [null, null, null, null];
      lastRealPos = [0, 0, 0, 0];
      return;
    }
    if (m.key === "resume") {
      // slicer_bridge.js's start(), on anything after the very first play,
      // takes this path instead of re-emitting a fresh "play" trigger —
      // deliberately: stem_timestretch~ has no true pause state, so "stop"
      // just freezes it in place and "resume" means "replay this exact
      // segment from its own top again" (see slot_router_stem.pd's own
      // "RESUME = COMMIT" comment for the Pd-side reasoning). Real audio
      // and the real "position" telemetry both restart correctly on this —
      // the bug was purely here: nothing ever re-armed `playing[r]`, so the
      // position handler above discarded every update with its own
      // `if (!p) return`, and the playhead just sat wherever "stop" froze
      // it. bridge_slicer sends this as a single bare broadcast with no
      // stem name (resume restarts ALL FOUR stems' current segments at
      // once, same as stop halts all four) — so this re-arms every stem
      // that has a remembered segment, not just one.
      var now0 = performance.now();
      for (var rr = 0; rr < STEMS.length; rr++) {
        if (!lastSeg[rr] || !ui[rr]) continue;
        playing[rr] = { t0: now0, span: lastSeg[rr].span, ms: lastSeg[rr].ms, from: lastSeg[rr].from };
        STEMS[rr].ph = lastSeg[rr].from;
        lastRealPos[rr] = 0;
        redraw(rr);
      }
      return;
    }
    if (m.key === "slices") {
      /* "slices <stem> <n>" — the count above each descriptor map. */
      var rr = rowOf[m.args[0]];
      if (rr !== undefined && ui[rr] && ui[rr].slices)
        ui[rr].slices.textContent = m.args[1];
      return;
    }
    if (m.key === "ready") {
      /* buildIndex finished — args[0] is the REAL total slice count
         (slicer_bridge.js: outlet(1, "ready", idx.length), fired both on a
         fresh :buildIndex and on the "already built" fast path). This key
         reached the browser correctly all along; it was dropped right here
         because nothing checked for it. Now it's the visible answer to
         "did buildIndex actually run." */
      log("res", "index ready — " + m.args[0] + " total slices");
      refreshNowPlaying(); // real slice counts/key/genre/beats just changed
      refreshWaveforms(); // stream slots may have changed which file backs each stem
      return;
    }
    if (m.key === "resetAllResult") {
      /* gui_hub_bridge.js's performResetAll() — args = [sessionId, okCount,
         failCount, ...("<label>:<error>" for each failed step)]. Spelled
         out here instead of left to the catch-all below because a partial
         failure (e.g. permission denied on one file) is exactly the kind
         of thing that must not read as "done" at a glance. */
      var okN = +m.args[1] || 0, failN = +m.args[2] || 0;
      if (failN === 0) {
        log("res", "resetAll — session '" + m.args[0] + "' wiped clean (" + okN + "/" + okN + " steps ok)");
      } else {
        log("res", "resetAll — " + failN + " of " + (okN + failN) + " step(s) FAILED: "
          + m.args.slice(3).join(", "));
      }
      refreshNowPlaying(); // library/genres/downbeats were just wiped (or partially wiped) — reflect it
      refreshWaveforms(); // resetAll clears stream.txt too — clear/refresh the waveform panes with it
      return;
    }
    /* Catch-all for every other status key, not just the three names below.
       sysMsg/analysisDone/streamUpdated used to be the only ones anyone
       remembered to list — bridge_slicer.pd's other outlet-1 tags (desc,
       seg, triggerReady, ...) fell through to nothing and vanished exactly
       like "ready" did. Logging the raw key+args means a future tag shows
       up here by default instead of silently dropping again. */
    log("res", m.key + (m.args.length ? " " + m.args.join(" ") : ""));
  });

  /* Pipeline-stage telemetry from watch_demucs.py (demucs / genre=Essentia /
     madmom), relayed by gui_hub_bridge.js's POST /progress -> broadcast
     {t:'pipeline', ...} (see that route's own comment, and gnumbat-link.js's
     message-shape doc, for why this frame didn't exist before). Logged to
     the same console pane as everything else here — there is no dedicated
     progress readout in the panel yet, and this is the honest state: real
     stage-by-stage progress, visible for the first time, not fabricated. */
  /* ── PIPELINE STATUS READOUT ──────────────────────────────────────────
     user: "when loading a file into raw upload, i want to see the demucs,
     essentia,madmom,flucoma analysis progression... just like in the TUI."
     #pipelineStatus (panel.html, right above #clog) is the persistent
     single-line "what's happening right now" readout, same role the TUI's
     sepBox spinner played; every transition ALSO still gets its own line in
     #clog below via log(), which is the scrollable history.
     Worth being honest about one thing this is NOT a straight port of: the
     TUI's own FluCoMa bar (app.js's startFlucomaProgress()) was a FAKE
     linear timer — 0→95% over ~3 minutes on a setInterval, with no relation
     to actual analysis progress, completed only by a separate boolean
     "analysisDone" signal. analyze_reader_bridge.js now POSTs its REAL
     per-stem progress (see that file's postProgress() calls) as the same
     {type:'pipelineStage', stage:'flucoma', ...} shape watch_demucs.py's
     demucs/genre/madmom stages already use — so the flucoma percentage
     here is genuine stems-completed/stems-total, not a fake clock. */
  var pipelineStatusEl = document.getElementById("pipelineStatus");
  var pipelineHideTimer = null;
  function pipelineBar(pct) {
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    var filled = Math.round(p / 10);
    return "█".repeat(filled) + "░".repeat(10 - filled) + " " + p + "%";
  }
  function setPipelineStatus(text) {
    if (!pipelineStatusEl) return;
    clearTimeout(pipelineHideTimer);
    pipelineStatusEl.textContent = text;
    pipelineStatusEl.classList.remove("hide");
  }
  function hidePipelineStatusSoon(delayMs) {
    clearTimeout(pipelineHideTimer);
    pipelineHideTimer = setTimeout(function () {
      if (pipelineStatusEl) pipelineStatusEl.classList.add("hide");
    }, delayMs);
  }

  Gnumbat.on("pipeline", function (m) {
    if (m.type === "pipelineStage") {
      var label = m.stage === "madmom" ? "madmom (beat/downbeat)"
        : m.stage === "genre" ? "genre (essentia)"
        : m.stage === "demucs" ? "demucs (stem separation)"
        : m.stage === "flucoma" ? "flucoma (descriptor analysis)"
        : m.stage;
      var trackTxt = (m.track && m.track !== "*") ? " — " + m.track : "";
      var msgTxt = m.msg ? " (" + m.msg + ")" : "";

      var line = label + " " + m.status + trackTxt;
      if (m.percent !== undefined && m.percent !== null) line += " " + m.percent + "%";
      if (m.msg) line += msgTxt;
      log("res", line);

      if (m.status === "start" || m.status === "progress") {
        var barTxt = (m.percent !== undefined && m.percent !== null) ? " " + pipelineBar(m.percent) : "";
        setPipelineStatus(label + barTxt + trackTxt + msgTxt);
      } else if (m.status === "done" && m.stage === "flucoma") {
        // FluCoMa is the last stage before buildIndex -- treat its "done"
        // as "the whole pipeline finished," not just one more stage.
        setPipelineStatus("✓ analysis complete" + trackTxt);
        hidePipelineStatusSoon(6000);
        refreshNowPlaying(); // FluCoMa just finished — key/slcs may have changed even before buildIndex runs
        refreshWaveforms(); // and the analyzed file's actual waveform is now readable too
      } else if (m.status === "done") {
        setPipelineStatus("✓ " + label + " done" + trackTxt);
      } else if (m.status === "error") {
        setPipelineStatus("✗ " + label + " FAILED" + msgTxt);
        hidePipelineStatusSoon(10000);
      }
      return;
    }
    if (m.type === "stemsReady") { log("res", "stems ready — " + m.track); return; }
    if (m.type === "fileDetected") {
      log("res", "file detected — " + m.filename);
      setPipelineStatus("queued — " + m.filename);
      return;
    }
    log("res", "pipeline " + JSON.stringify(m));
  });

  /* ── NOW PLAYING — real per-stem file/key/genre/beats/slice-count ────────
     FIXED 2026-08-19. Every value in the .infolines block (file:/key:/
     genre:/beats:) plus slcs: was a one-time paint off the hardcoded STEMS
     mock array in panel.html's inline script, never touched again after
     load. User, with a screenshot showing buildIndex's real, varying slice
     counts (0/66/0/182) sitting right next to a key/genre/beats readout
     that stayed frozen at "Bb minor"/"Experimental 16%"/"4/4 120bpm 99%"
     regardless: "the infos of the gui panel arent connected. they are
     still placeholders." Confirmed against panel.html's own source —
     `${s.live?'Bb minor':'--'}` etc are literal template strings with no
     data binding at all.
     gui_hub_bridge.js's new GET /api/nowPlaying (buildNowPlaying()) reads
     stream.txt + analysis_library.json + genres.json + downbeats.json
     fresh on every request and returns this exact shape per stem. There is
     no push channel for this (unlike meter/spectrum/wave, which are real
     telemetry frames), so it is pulled — once on load, and again whenever
     something that could plausibly have changed it just happened: buildIndex
     finishing ("ready", below), a resetAll, or FluCoMa's own "done" (the
     pipeline handler above already treats that as "whole pipeline finished").
     quant:/bars:/lcksrc: are NOT wired here — those are per-stem controls
     the user sets (quantize grid, bar length, lock source), not measured
     data, and there is no backend concept of their current value yet; a
     separate, later piece of work. */
  var NOWPLAYING_STEM_KEYS = ["vocals", "melody", "bass", "drums"];
  function applyNowPlaying(data) {
    if (!data || !data.stems) return;
    for (var i = 0; i < NOWPLAYING_STEM_KEYS.length; i++) {
      var u = ui[i];
      if (!u || !u.el) continue;
      var s = data.stems[NOWPLAYING_STEM_KEYS[i]] || {};

      var fileEl = u.el.querySelector('[data-f="file"]');
      if (fileEl) fileEl.textContent = "[" + (s.track || "--") + "]";

      var keyEl = u.el.querySelector('[data-f="key"]');
      if (keyEl) keyEl.textContent = "[" + (s.key || "--") + "]";

      var slcsEl = u.el.querySelector('[data-f="slcs"]');
      if (slcsEl) slcsEl.textContent = String(s.slices || 0);

      var genreEl = u.el.querySelector('[data-f="genre"]');
      if (genreEl) genreEl.textContent = "[" + (s.genre || "--") + "]";
      var genrePctEl = u.el.querySelector('[data-f="genrepct"]');
      if (genrePctEl) {
        genrePctEl.textContent = " [" + (s.genrePct !== null && s.genrePct !== undefined ? s.genrePct + " %" : "--") + "]";
      }

      var beatsEl = u.el.querySelector('[data-f="beats"]');
      if (beatsEl) {
        var beatsTxt = (s.meter && s.bpm) ? (s.meter + "/4 " + Math.round(s.bpm) + "bpm") : "--";
        beatsEl.textContent = "[" + beatsTxt + "]";
      }
      var beatsPctEl = u.el.querySelector('[data-f="beatspct"]');
      if (beatsPctEl) {
        beatsPctEl.textContent = " [" + (s.beatsPct !== null && s.beatsPct !== undefined ? s.beatsPct + " %" : "--") + "]";
      }
    }
  }
  function refreshNowPlaying() {
    fetch("/api/nowPlaying", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(applyNowPlaying)
      .catch(function (e) { console.warn("Gnumbat live: /api/nowPlaying fetch failed", e); });
  }
  refreshNowPlaying(); // initial paint — replaces the mock STEMS values with whatever's real right now

  /* ── REAL WAVEFORMS (2026-08-20) ──────────────────────────────────────
     user: "the waveforms are not possible since there is very few
     information in vocals and bass files." Confirmed: drawWave() drew pure
     signal()-synthesized noise off a hardcoded per-row seed, with zero
     relationship to the actual stem content — see that function's own
     updated comment in panel.html. realWave[r] holds the real per-column
     {min,max,rms} fetched from gui_hub_bridge.js's new GET /api/waveform
     (buildWaveform() there decodes the actual WAV file stream.txt says is
     loaded); redraw() below passes it through to drawWave(), which prefers
     it over the synthesized fallback whenever it's present and sized for
     the current column count. Same pull-on-demand pattern as
     refreshNowPlaying() just above — there's no push channel for "the
     loaded file changed," so this fires alongside every refreshNowPlaying()
     call rather than trying to invent a separate trigger for what is, in
     practice, always the same moment. */
  var realWave = [null, null, null, null];
  function applyWaveform(r, data) {
    var u = ui[r], s = STEMS[r];
    if (!u || !s) return;
    if (data && data.ok) {
      realWave[r] = { min: data.min, max: data.max, rms: data.rms };
      s.live = true;
    } else {
      // Nothing real loaded in this slot right now (or the file couldn't be
      // read) — fall back to the flat centre-line "not live" rendering
      // rather than a fabricated shape. An empty vocals/bass slot SHOULD
      // look empty; that was the whole complaint.
      realWave[r] = null;
      s.live = false;
    }
    redraw(r);
  }
  function refreshWaveforms() {
    for (var i = 0; i < NOWPLAYING_STEM_KEYS.length; i++) {
      (function (r, key) {
        var g = waveGeom(ui[r]);
        fetch("/api/waveform?stem=" + key + "&cols=" + g.cols, { cache: "no-store" })
          .then(function (resp) { return resp.json(); })
          .then(function (data) { applyWaveform(r, data); })
          .catch(function (e) { console.warn("Gnumbat live: /api/waveform fetch failed for " + key, e); });
      })(i, NOWPLAYING_STEM_KEYS[i]);
    }
  }
  refreshWaveforms(); // initial real paint — replaces the mock seed/live values same as refreshNowPlaying() above

  /* drawWave's column count is passed at the call site in the panel, not
     taken from its own default — so hardcoding a number here would silently
     redraw at a different resolution than the first paint the moment either
     file is edited. Reading it back off the SVG the panel already rendered
     means the two can never disagree. */
  function waveGeom(u) {
    var svg = u.wave && u.wave.querySelector("svg");
    var vb = svg && svg.getAttribute("viewBox");
    var p = vb ? vb.trim().split(/\s+/).map(Number) : null;
    return (p && p.length === 4 && p[2] > 0) ? { cols: p[2], h: p[3] }
                                             : { cols: 900, h: 26 };
  }

  function redraw(r) {
    var s = STEMS[r], u = ui[r];
    if (!u.wave) return;
    var g = waveGeom(u);
    u.wave.innerHTML = drawWave(s.seed, s.sel, s.ph, g.cols, g.h, s.live, realWave[r]);
  }

  /* One rAF loop for all four playheads. Redrawing the whole SVG per frame is
     wasteful but measured at panel size it is nothing, and it reuses the
     mockup's own renderer rather than forking a second drawing path that
     could disagree with it. Capped to ~20fps for the same reason. */
  var lastFrame = 0;
  (function tick(now) {
    requestAnimationFrame(tick);
    if (now - lastFrame < 50) return;
    lastFrame = now;
    for (var r = 0; r < 4; r++) {
      var p = playing[r];
      if (!p || !p.ms) continue;
      // Real "position" telemetry is currently flowing for this stem (see
      // the Gnumbat.on("position", ...) handler above) — it already moved the
      // playhead more accurately than this guess can, and redrew. Don't
      // fight it every frame; only take over once real updates go quiet.
      if (now - lastRealPos[r] < REAL_POS_TIMEOUT) continue;
      var frac = (now - p.t0) / p.ms;
      if (frac >= 1) { playing[r] = null; frac = 1; }
      STEMS[r].ph = p.from + p.span * frac;
      redraw(r);
    }
  })(0);

  Gnumbat.on("_state", function (s) {
    document.body.setAttribute("data-gnumbat", s.state);
    log("res", s.state === "open" ? "connected to the instrument"
      : s.state === "reconnecting" ? "lost the hub — retrying"
      : s.state === "detached" ? "detached: no hub, showing seeded values"
      : s.state);
  });

  Gnumbat.on("error", function (m) {
    log("res", "rejected: " + m.msg);
  });

  /* ── CONTROLS ──────────────────────────────────────────────────────── */

  /* The mockup wired these with element.onclick = fn, so reassigning replaces
     its handler. Each of the visual toggles below is reimplemented rather than
     wrapped, because the visual state now has to follow the ENGINE, not the
     click — pressing Start when the hub is down must not leave the button
     reading "Stop". */
  var running = false;
  var startChip = document.getElementById("startChip");
  startChip.onclick = function () {
    running = !running;
    Gnumbat.slicer(running ? "start" : "stop");
    this.innerHTML = "<b>^S</b>" + (running ? "Stop" : "Start");
    this.classList.toggle("on", running);
    log("cmd", running ? "start" : "stop");
  };

  /* capToggle ([REC]) REMOVED from panel.html — user: "remove [rec .] and
     last touched." This used to bind here and send record_cmd start/stop
     to the engine (Gnumbat.patch("record_cmd", ...)); with the button gone
     there's no click to wire up. If a record control comes back later,
     the sfrecord~ message-shape caveat that used to live in this comment
     still applies: "start"/"stop" is what GUI_PARAMETER_MAPPING.md
     documents, but it was never confirmed against the Max patch directly. */

  /* Clicking a stem in the library pins it as that slot's source. The mockup
     only toggled a CSS class; now it also tells the slicer. */
  [].forEach.call(document.querySelectorAll(".st"), function (el) {
    el.onclick = function () {
      el.classList.remove("prop");
      var pinned = el.classList.toggle("pin");
      var stem = { vcl: "vocals", mel: "melo", bas: "bass", drm: "drums" }[el.dataset.s];
      if (pinned) {
        Gnumbat.slicer("setStemSource", stem, el.dataset.f);
        log("cmd", "setStemSource " + stem + " " + el.dataset.f);
      } else {
        /* Un-pinning returns the slot to the engine's own choice. */
        Gnumbat.slicer("setStemSource", stem, "auto");
        log("cmd", "setStemSource " + stem + " auto");
      }
    };
  });

  /* ── PER-BAND SLICER CONTROLS ──────────────────────────────────────────
     Everything below reads from the same `ui` rows the telemetry binds to,
     matched to real slicer_bridge.js function signatures (checked against
     the source, not guessed from the panel's labels) so a value typed here
     is exactly what a message box in the Pd patch would have sent.

     UI PATTERN: a native prompt() per field. Blunt, but honest — this panel
     has no numeric input widgets yet (everything is a text span), and
     faking a slicker interaction now would just be something to unwind
     later. Swap the prompt() calls for real widgets whenever that's worth
     doing; the Gnumbat.slicer(...) call at the end of each handler is the part
     that matters and does not need to change.

     Nothing here waits for a round trip: the DOM updates optimistically the
     moment a command is sent, same convention startChip already uses above.
     There is currently no confirmed path for slicer_bridge.js's
     own outlet(1,"param"/"stayProb"/"matchProb"/"dirWeight"/"lockSource"/
     "agentMode_"+t, ...) reports to arrive back here distinctly from the
     generic `status` telemetry — see gui_hub_bridge.js's TELEMETRY table,
     which only names meter/spectrum/rmsdb/status. Worth confirming once a
     hub is actually running; until then, trust what was sent, not an echo. */
  function promptNum(label, cur, lo, hi) {
    var raw = prompt(label + (lo !== undefined ? " (" + lo + "–" + hi + ")" : "") + ":", cur);
    if (raw === null) return null;
    var v = parseFloat(raw);
    if (!isFinite(v)) return null;
    if (lo !== undefined) v = Math.min(hi, Math.max(lo, v));
    return v;
  }

  /* FIX — user: panel.html's custom stylized cursor (the hollow green
     square, var(--cursor-cross)) was "glitching back to default." panel.html
     itself was fine — every selector there already uses var(--cursor-cross)
     after the earlier native->custom conversion pass. The leftover bug was
     here: several elements below got el.style.cursor = "pointer" set
     directly (an inline style, which beats every stylesheet rule no matter
     its specificity), so hovering the mode toggle, stay/match values,
     lockSource, dirWgt, the weight/dir cells, or the entropy knob showed the
     plain native arrow/hand instead of the stylized square. All of those now
     set var(--cursor-cross) instead, so they match the rest of the panel. */
  ui.forEach(function (u, r) {
    var track = STEM_KEY[r];               // real wire name: vocals/melo/bass/drums
    var band = u.el;

    /* RMX|GEN — setAgentMode(stem, mode). Real accepted values are 'remix',
       'generate', or 'blend' (checked against slicer_bridge.js); this toggle
       only has two visual states, so it cycles remix/generate and leaves
       'blend' reachable only from the command line for now. */
    var modeEl = band.querySelector(".bc1 .mode");
    if (modeEl) {
      var modeSpans = modeEl.querySelectorAll("span:not(.sep2)");
      var agentMode = "remix"; // matches the mockup's seeded [RMX| state
      modeEl.style.cursor = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMSIgaGVpZ2h0PSIxMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMGEwZDBhIiBzdHJva2Utd2lkdGg9IjIiLz48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSJub25lIiBzdHJva2U9IiM1YmZmNmEiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==') 5 5, default";
      modeEl.onclick = function () {
        agentMode = agentMode === "remix" ? "generate" : "remix";
        modeSpans[0].classList.toggle("on", agentMode === "remix");
        modeSpans[1].classList.toggle("on", agentMode === "generate");
        Gnumbat.slicer("setAgentMode", track, agentMode);
        log("cmd", "setAgentMode " + track + " " + agentMode);
      };
    }

    var wdhM = band.querySelector(".wdh-m");
    if (wdhM && wdhM.children.length === 3) {
      /* stay / match — setStayProb / setMatchProb, both 0..1 (clamped
         slicer_bridge-side too, so an out-of-range value here is harmless). */
      var stayVal = wdhM.children[0].querySelectorAll(".val")[0];
      var matchVal = wdhM.children[0].querySelectorAll(".val")[1];
      if (stayVal) stayVal.style.cursor = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMSIgaGVpZ2h0PSIxMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMGEwZDBhIiBzdHJva2Utd2lkdGg9IjIiLz48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSJub25lIiBzdHJva2U9IiM1YmZmNmEiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==') 5 5, default";
      if (stayVal) stayVal.onclick = function () {
        var v = promptNum("stay[" + track + "]", stayVal.textContent.replace(/[\[\]]/g, ""), 0, 1);
        if (v === null) return;
        stayVal.textContent = "[" + v.toFixed(1) + "]";
        Gnumbat.slicer("setStayProb", track, v);
        log("cmd", "setStayProb " + track + " " + v);
      };
      if (matchVal) matchVal.style.cursor = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMSIgaGVpZ2h0PSIxMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMGEwZDBhIiBzdHJva2Utd2lkdGg9IjIiLz48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSJub25lIiBzdHJva2U9IiM1YmZmNmEiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==') 5 5, default";
      if (matchVal) matchVal.onclick = function () {
        var v = promptNum("match[" + track + "]", matchVal.textContent.replace(/[\[\]]/g, ""), 0, 1);
        if (v === null) return;
        matchVal.textContent = "[" + v.toFixed(1) + "]";
        Gnumbat.slicer("setMatchProb", track, v);
        log("cmd", "setMatchProb " + track + " " + v);
      };

      /* lockSource — click-to-cycle through the OTHER three stems, then
         "unlocked". lockSource(leader, follower) makes THIS row follow
         leader; unlockSource(follower) releases it. Cycle guards against
         locking a stem to itself, which slicer_bridge.js rejects anyway. */
      var lockVal = wdhM.children[1].querySelector(".val");
      if (lockVal) {
        var leaders = STEM_KEY.filter(function (k) { return k !== track; });
        var lockOptions = leaders.concat([null]); // null = unlocked
        var lockIdx = lockOptions.length - 1; // start unlocked, matches "--"/none seed state
        lockVal.style.cursor = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMSIgaGVpZ2h0PSIxMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMGEwZDBhIiBzdHJva2Utd2lkdGg9IjIiLz48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSJub25lIiBzdHJva2U9IiM1YmZmNmEiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==') 5 5, default";
        lockVal.onclick = function () {
          lockIdx = (lockIdx + 1) % lockOptions.length;
          var leader = lockOptions[lockIdx];
          if (leader) {
            lockVal.textContent = "[" + leader + " ⚿]";
            Gnumbat.slicer("lockSource", leader, track);
            log("cmd", "lockSource " + leader + " " + track);
          } else {
            lockVal.textContent = "[--]";
            Gnumbat.slicer("unlockSource", track);
            log("cmd", "unlockSource " + track);
          }
        };
      }

      /* dirWgt — setDirWeight(stem, val), 0..5 (slicer_bridge.js's clamp). */
      var dirWgtVal = wdhM.children[2].querySelector(".val");
      if (dirWgtVal) {
        dirWgtVal.style.cursor = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMSIgaGVpZ2h0PSIxMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMGEwZDBhIiBzdHJva2Utd2lkdGg9IjIiLz48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSJub25lIiBzdHJva2U9IiM1YmZmNmEiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==') 5 5, default";
        dirWgtVal.onclick = function () {
          var v = promptNum("dirWgt[" + track + "]", dirWgtVal.textContent.replace(/^\+/, ""), 0, 5);
          if (v === null) return;
          dirWgtVal.textContent = (v >= 0 ? "+" : "") + v.toFixed(1);
          Gnumbat.slicer("setDirWeight", track, v);
          log("cmd", "setDirWeight " + track + " " + v);
        };
      }
    }

    /* weight / dir grid — 8 dims (DIMS = C,S,E,F,P,H,T,D), each cell showing
       "weight / dir" as one string. setWeight has no documented range in
       slicer_bridge.js (left unclamped there), setDirPref clamps -1..1. */
    var wdCells = band.querySelectorAll(".bc2 .wd .wv2");
    wdCells.forEach(function (cell, i) {
      var dim = DIMS[i];
      if (!dim) return;
      cell.style.cursor = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMSIgaGVpZ2h0PSIxMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMGEwZDBhIiBzdHJva2Utd2lkdGg9IjIiLz48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSJub25lIiBzdHJva2U9IiM1YmZmNmEiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==') 5 5, default";
      cell.onclick = function () {
        var parts = cell.textContent.split("/").map(function (s) { return s.trim(); });
        var raw = prompt("weight / dir for " + dim + "[" + track + "] (two numbers, e.g. \"2.0 -1.0\"):",
                          parts.join(" "));
        if (raw === null) return;
        var nums = raw.trim().split(/\s+/).map(Number);
        if (nums.length < 2 || !isFinite(nums[0]) || !isFinite(nums[1])) return;
        var w = nums[0], d = Math.min(1, Math.max(-1, nums[1]));
        cell.textContent = w.toFixed(1) + " / " + (d >= 0 ? "+" : "") + d.toFixed(1);
        Gnumbat.slicer("setWeight", track, dim, w);
        Gnumbat.slicer("setDirPref", track, dim, d);
        log("cmd", "setWeight " + track + " " + dim + " " + w);
        log("cmd", "setDirPref " + track + " " + dim + " " + d);
      };
    });

    /* entropy (the sun/moon fader) — setEntropy(val) is a SINGLE whole-
       instrument parameter in slicer_bridge.js, not per-stem, even though
       the panel draws one fader per band. Moving any of the four sends the
       same global command and is reflected on all four, so the panel never
       shows four faders disagreeing about one real value. */
    var entHdr = band.querySelector(".bc-ent .hdr.rt .mv");
    var entKnob = band.querySelector(".bc-ent .vfad.sm .kn");
    if (entHdr && entKnob) {
      entKnob.parentNode.style.cursor = "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMSIgaGVpZ2h0PSIxMSI+PHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjkiIGhlaWdodD0iOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMGEwZDBhIiBzdHJva2Utd2lkdGg9IjIiLz48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iOSIgaGVpZ2h0PSI5IiBmaWxsPSJub25lIiBzdHJva2U9IiM1YmZmNmEiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==') 5 5, default";
      entKnob.parentNode.onclick = function () {
        var v = promptNum("entropy (all stems)", entHdr.textContent, 0, 1);
        if (v === null) return;
        ui.forEach(function (u2) {
          var h = u2.el.querySelector(".bc-ent .hdr.rt .mv");
          var k = u2.el.querySelector(".bc-ent .vfad.sm .kn");
          if (h) h.textContent = v.toFixed(2);
          if (k) k.style.bottom = (v * 100).toFixed(0) + "%";
        });
        Gnumbat.slicer("setEntropy", v);
        log("cmd", "setEntropy " + v + "  (applies to all stems)");
      };
    }
  });

  console.log("Gnumbat live: bound " + ui.length + " stem rows, transport=" +
              Gnumbat.transport);
  } catch (err) {
    // Chat/command-line (above) already bound and is unaffected — this only
    // means stem meters/waveforms/graphs/knobs may not be live. Logged
    // loudly rather than swallowed so a real regression here doesn't read
    // as "everything's fine" just because chat still works.
    console.error("Gnumbat live: stem-band metering/telemetry setup failed — " +
                   "meters/waveforms may not update, but chat and the " +
                   "command line (bound earlier in this file) are unaffected. Error:", err);
  }


  /* ── FOOTER KEYBOARD SHORTCUTS ───────────────────────────────────────────
     panel.html's own inline script already wires ^C (focus chat) and ^T/^G
     (the Train/Gen panel toggle) at the document level — those work today
     and aren't touched here. ^S, ^B/^Y, and ^L were chips with no listener
     behind them; adding the rest here rather than in panel.html to keep the
     "markup + mockup logic doesn't need to change for this file to add
     behavior" convention the rest of gnumbat-live.js follows. */
  document.addEventListener("keydown", function (e) {
    if (!e.ctrlKey) return;
    var k = e.key.toLowerCase();

    // ^S — same click startChip's own handler already answers to.
    if (k === "s") { e.preventDefault(); document.getElementById("startChip").click(); return; }

    // ^B / ^Y — step the bake-history list's selection. app.js's own
    // stepBake() is tangled up with a "training review mode" that has no
    // counterpart in this panel (no reviewEntries, no nested learn/review
    // view) — ported as what it reduces to here: move the highlighted .brow
    // row up/down, same selection .brow's own onclick above already sets.
    // Scoped to #blist specifically (and .newbake excluded) now that
    // library also uses .brow rows for its own, unrelated list — a bare
    // ".brow" here would mix the two lists together and step through
    // whichever library track happens to render at the same index.
    if (k === "b" || k === "y") {
      e.preventDefault();
      var rows = [].slice.call(document.querySelectorAll("#blist .brow:not(.newbake)"));
      if (!rows.length) return;
      var cur = rows.findIndex(function (r) { return r.classList.contains("sel"); });
      var next = k === "b" ? Math.max(0, cur - 1) : Math.min(rows.length - 1, cur + 1);
      if (cur >= 0) rows[cur].classList.remove("sel");
      rows[next].classList.add("sel");
      return;
    }

    // ^L REMOVED from here — user: "add a keyboard shortcut ^L to log out
    // of the current model and return to the model-selection page."
    // panel.html's own inline script now owns ^L for real (see
    // logoutModel()/the addEventListener('keydown',...) right after it,
    // near selectModel()) — this stale placeholder used to fire on every
    // ^L press too (both listeners run; this one never called
    // stopPropagation) and log a "no login/session system" line that
    // directly contradicted the real logout that had just happened.
  });

})();

