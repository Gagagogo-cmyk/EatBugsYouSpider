# EDIT INTERFACE, the shared chat layer, and the network of patches

How the Gnumbat Network/branches/M-RLCF/EDIT INTERFACE request maps onto what
already exists in this repo, what's genuinely new, and what's built and
working right now. Written the same way `docs/platform/NETWORK.md` and
`docs/decentralize.md` are — a grounded proposal, not a rewrite — because
most of the systems this request describes already exist in some form.

---

## 0. The one naming fix this needs before anything else

The request's Network section calls the unit of community identity a
**branch** (`+ CREATE PATCH` in its own mockup, `patch_id` in its own data
model — it's actually inconsistent about this itself). This repo already
uses "branch" for something else entirely: `src/gui/panel.html`'s
`#modelBranchChip` ("^B New branch") and `#bakeBranchChip` are a *model/bake
lineage* concept — forking a taxonomy/generative-model tree, unrelated to
community instances. Introducing "branch" for community identity in the
same UI that already has a "New branch" button for models would be
genuinely confusing, not just a style nit.

**Recommendation: call the community-identity unit a Patch everywhere**
(`patch_id`, "+ CREATE PATCH", "install a skin on a patch") — which is what
the request's own field names and CTA already say most of the time. This
doc uses "Patch" throughout.

---

## 1. What's already there, mapped to the request's sections

### Chat / Cricket / Ollama (request §3) — already real, and already
### multi-context

`src/gui/gui_hub_bridge.js` is a hand-rolled (no `ws` npm dependency)
HTTP+WebSocket server that already runs Cricket against local Ollama
(`localhost:11434/api/chat`, model configurable via `--ollama-model`,
persona built from `docs/instrument/CRICKET.md`) for **three** distinct
chat contexts sharing one transport:

- **OGTM** — the instrument console. One shared `chatHistory`, broadcast to
  every connected panel ("one instrument, one operator").
- **OMSC** — a public social room + DMs. Cricket does *not* auto-reply to
  public messages (deliberately — see the hub's own "CRICKET (ambient +
  private DM)" section); she only speaks via a periodic ambient check
  (`checkCricketAmbient`, its own throwaway history, `NO_REPLY` suppressed
  before it ever reaches the browser) or an explicit `:msg cricket ...` DM
  (`private:true`, replied only to the requesting socket).
- Client side, `src/gui/gnumbat-link.js` is the transport abstraction the
  request's §3 describes almost exactly: the panel calls `Gnumbat.chat()` /
  `Gnumbat.chatCricketDM()` / `Gnumbat.on(type, fn)` and never learns whether
  it's WebSocket, a future JUCE plugin binding, or nothing (`detached`
  transport for opening the file with no server running at all).
  `Gnumbat.on('*', ...)` already exists as a wildcard. Adding a new message
  type needs **zero** changes to this file — `deliver()` does
  `emit(msg.t, msg)` generically.

This is the "chat is not a separate application, every page renders it
differently" idea, already implemented, three ways, before this request
was written. EDIT INTERFACE (built this session — §3 below) is a fourth
context on the same transport, for exactly this reason.

One more precedent worth naming: panel.html's OMSC tab already iframes a
*different* page (`src/backend/event-crawler/frontend/base.html`, the Go
event-crawler's own frontend) for its `#cityModal` "room switcher" /
`^N Network` chip, relaying clicks across the iframe boundary while the
footer chat/chip row stays put. That's the existing precedent for
"swap the main content area, keep chat/footer persistent" — reuse it for
the real Network (patches) page rather than inventing a second mechanism.

### The network / distributed-infra philosophy (§1, §15–17) — already
### designed, needs the vocabulary fix above, not a rewrite

`docs/platform/NETWORK.md` + `docs/decentralize.md` already describe:

- A **constellation, not a mesh or hierarchy** — "no instance can take
  another offline... the network is closer to a phone book than a grid."
  This is section 16's "ecosystem not hierarchy" diagram, already written.
- **Geography as metadata, not identity** — an instance's registry
  listing carries a city/scene field, but nothing in the design makes city
  a namespace. (It doesn't yet explicitly say "two Patches can share a
  city," but nothing blocks it either — this just needs to be said
  explicitly once "Patch" replaces "instance" as the term.)
- A **federated registry, not a live index** (`gnumbat-network`, a second git
  repo, human-reviewed PRs to list yourself — "the same trust model as an
  awesome-list") plus `.provenance.yml`/`network.yml` manifests for
  code-lineage tracking (§17's "useful knowledge propagates without
  centralizing control").
- A **real, working, decentralized data layer already shipping**:
  `src/network/carnet-daemon.js` — a Hypercore-based, append-only,
  per-region event log (stage 1 of 3: local-only now; hyperswarm
  replication and multi-contributor autobase merge are designed but not
  built). This is the actual P2P substrate the Network page's "shared
  knowledge, independent instances" philosophy needs, already half-built.

**What's genuinely new:** the Network *page* itself (a browsable directory
of Patches — nothing renders `docs/platform/NETWORK.md`'s registry today),
and the `patch_id`/`server_endpoint`/`visibility`/etc. identity record
(§2). Neither exists in code yet.

### M-RLCF (§4–5) — doesn't exist by that name; the pipeline it describes
### already exists as the generative/LoRA layer

`generate_agent.py`, `cricket_bridge.py`, `watch_lora.py`,
`watch_generated.py`, `train_and_score_lora.py` (per CLAUDE.md/XREF.md) are
exactly the request's "audio → Demucs → FluCoMa → Essentia → madmom →
slices → user interaction/ratings → bakes → PyTorch models" pipeline.
"Bakes" already carry the provenance idea in miniature — logged to
`training_log.jsonl` on `:bake`/`:scoreLyr`/`:scoreTrs`, converted via
`convert_bakes.py` → `finetune.sh`. **Recommendation: adopt "M-RLCF" as a
name/framing for this existing layer, not a parallel system** — and extend
the existing bake-log record with the `model_id`/`origin_patch`/`corpus`/
`visibility` fields §4 asks for, rather than building a second pipeline.

### Pd bridge / reload / persistent state (§18 checklist)

- **Pd bridge**: `src/pd/bridge/*.js`, dependency-free OSC/UDP
  (`osc.js`); `gui_hub_bridge.js` *is* the Node-side control hub for it
  (see that file's own header diagram).
- **Reload**: none today, and none needed beyond what already exists —
  `panel.html` is served fresh off disk on every HTTP request (no build
  step, no bundler cache), so "tell the browser to reload" *is* the
  live-reload mechanism. That's what EDIT INTERFACE's `reload_ui` tool
  does (§3 below).
- **Git/versioning**: the repo is a real git checkout (GitHub,
  `Gagagogo-cmyk/Gnumbat`, AGPL) — but **`src/gui/` (panel.html,
  gui_hub_bridge.js, gnumbat-live.js, gnumbat-link.js, everything the DJ-facing
  web control panel is made of) has never been `git add`-ed** (`git
  status` shows it as `??`, an untracked directory, not a modified one).
  Its *actual*, already-established versioning convention is the 50+
  `panel.html.bak-<timestamp>-<slug>` files already sitting next to it —
  a human doing exactly what `apply_patch`/`undo_change` now do
  programmatically (see `src/gui/edit1.py`, a literal anchor-replace
  patch script from a past session, which is what this session's
  `apply_patch` tool formalizes). **This is why EDIT INTERFACE's undo
  uses the `.bak` convention instead of git** — git-checkout-based undo
  would need the file tracked in the first place, and even once tracked,
  this repo's working tree is routinely left dirty for stretches (commit
  messages like "chirp" mark casual checkpoints, not every edit), so a
  git-based per-edit undo risks reverting real unrelated uncommitted work
  along with Cricket's change. **Recommendation, not done by this
  session**: `git add src/gui/` at a moment of your choosing, so
  `git diff`/`git log` start working for it going forward — the new
  `git_diff` tool already detects the untracked case and says so plainly
  instead of silently reporting "no changes."
- **Persistent state**: `data/` (gitignored) for runtime pipeline state;
  no browser `localStorage` currently in use for panel UI state.

---

## 2. What was built this session: EDIT INTERFACE, milestone 1

Per the request's own §19 ("don't build the whole ecosystem at once —
first milestone: chat → EDIT INTERFACE button → editing mode → Cricket/
Ollama → inspect repo → real UI modification → reload → iterate → undo"),
this is exactly that slice, wired into the real, already-working chat
layer described above rather than a new one.

### New file: `src/gui/edit_agent.js`

Cricket, in EDIT INTERFACE mode, as a local coding agent. Not Ollama
"tool calling" (unreliable across small local models) — the same pattern
this codebase already uses for Cricket's engine commands
(`isCricketCommand`/`splitCricketReply`/the `COMMANDS` whitelist): Cricket
emits one fenced <code>&#96;&#96;&#96;tool</code> JSON block per turn to act, or plain prose
with no fenced block when done. The hub runs the named tool, feeds the
result back, loops (capped at 8 steps), same "explicit whitelist, unknown
name is a named error" philosophy as `COMMANDS`.

Tools: `list_files`, `search_files`, `read_file` (paged — panel.html is
~15,000 lines, so nothing hands a small local model the whole file),
`apply_patch` (exact-match anchor replace, must occur exactly once —
same technique as `edit1.py`; auto-backs-up via the existing `.bak-`
convention first), `git_diff` (now untracked-aware, see above),
`undo_change` (restores the newest matching `.bak-*`, and itself
backs up first so an undo can always be undone), `reload_ui` (broadcasts
`{t:"reloadUI"}`), `run_check` (`node --check` for `.js`; a light
open/close-tag balance check for `.html` — not a real linter, just enough
to catch "this doesn't even parse" before telling the user it's done).

Every filesystem tool goes through one `resolveSafe()` gate: refuses
anything outside the repo root, `.git`, `node_modules`, `data/`, the
various Python venvs, `archive/`, or a `.bak-*` file touched directly
(only `undo_change` touches those). Per the request's own §13, this is the
*local, trusted* Cricket — broad repo access is the intended trust model
here; shared/downloaded skins are explicitly a separate, later trust
boundary this file does not address.

### Wiring (small, surgical diffs — nothing rewritten)

- `gui_hub_bridge.js`: one new `--repo-root` flag (defaults to the repo
  root), requires `edit_agent.js`, one new `else if (msg.t === "editChat")`
  dispatch branch next to the existing `chat`/`ping` branches.
- `gnumbat-link.js`: one new `chatEdit(text)` method
  (`{t:"editChat", text}`) — no dispatch changes needed, since
  `Gnumbat.on(msg.t, ...)` already re-emits by type generically.
- `gnumbat-live.js`: the Enter-key handler now checks a shared `editMode`
  flag and calls `Gnumbat.chatEdit()` instead of `Gnumbat.chat()` when it's on;
  five new `Gnumbat.on('editThinking'/'editStep'/'editReply'/'editError'/
  'reloadUI', ...)` listeners logged into the same console pane the
  existing Cricket chat already uses.
- `panel.html`: one new footer chip (`^E Edit Interface`, right next to
  the existing `^C Chat` chip), one `editMode` flag, `setEditMode()`
  (same shape as the existing `setChatOpen()`), one new `^E` keyboard
  shortcut.

### What this actually proves, and what it doesn't yet

Verified for real, against the deployed files on your machine, this
session:

1. All four edited files plus the new one pass `node --check`.
2. `require("./gui_hub_bridge.js")` (without running it) loads cleanly —
   the new `createEditAgent(...)` call at module scope doesn't throw.
3. **A full live run**: the real `gui_hub_bridge.js` was started (pointed
   at a scratch fixture repo/panel-dir/data-dir and a stand-in HTTP
   server on Ollama's API shape, so nothing about your real panel/data
   was touched), a real WebSocket client sent
   `{"t":"editChat","text":"Move the chat to the left and make it 40% wide."}`,
   and the hub genuinely ran `search_files` → `read_file` → `apply_patch`
   → `reload_ui` → a final prose reply, patching the fixture's
   `panel.html` on disk, writing a real `.bak-` backup, and broadcasting
   `reloadUI` — then a separate run proved `undo_change` restores it.
   Full tool-level unit tests (path-escape refusal, non-unique-match
   refusal, `.bak`-file-direct-touch refusal, undo-of-undo) all pass too.

**What's not yet verified: an actual local Ollama model driving this.**
Ollama isn't reachable from this session's sandbox (it runs on your Mac
directly, outside the sandboxed shell this session's file tools execute
in) — everything above exercises the real code path with a scripted
stand-in standing in for Ollama's HTTP response. The prompt protocol
(the <code>&#96;&#96;&#96;tool</code> fenced-JSON convention) is designed to be easy for a
small local model to follow, but only running it against `llama3.1` (or
whatever model you have loaded) will show how reliably it actually
follows that format — some models will occasionally add stray prose
around the fenced block, or drift from valid JSON, which is exactly what
the `parseErr` recovery path (feed the error back, let it retry, capped
at 8 turns) exists for, but its real-world hit rate is untested.

### To try it yourself

```
./run.sh      # or however you currently start the Pd/hub stack
```

Open the panel, click **Edit Interface** (or press `^E`), and type
something like *"move the chat to the left and make it 40% wide"* into
the console. Watch the log for `search_files` / `read_file` / `apply_patch`
/ `reload_ui` steps, then the page should reload with the change applied.
Type *"undo that"* to reverse it. If Cricket's replies come back garbled
(stray text around the tool block, invalid JSON), that's the real signal
for whether `llama3.1:latest` specifically needs a different model, a
lower temperature, or a more forceful system-prompt rewrite — worth
reporting back once you've tried it.

---

## 3. Suggested next milestones (not built yet, per the request's own
## "don't build the whole ecosystem at once")

1. **Fix the naming collision** (§0) across any UI copy before a Network
   page ships, so "branch" (models) and "Patch" (communities) never
   collide on screen.
2. **`git add src/gui/`** at a natural checkpoint, so `git_diff` starts
   being useful for this directory and EDIT INTERFACE's own diffs are
   visible the normal way.
3. **Element inspection** (§8): click-to-select while EDIT INTERFACE is
   on, capturing the clicked element's id/class/outerHTML head into the
   next message as context — meaningfully reduces how much Cricket has to
   search for on simple requests. Not built this session; the chat-only
   loop above is deliberately the smaller first slice.
4. **Patch identity record** (§2): a `patch_id`/`display_name`/
   `location`/`visibility`/etc. JSON, stored the same way other
   local-first state in this repo lives (`data/`, gitignored) — this is
   what the eventual Network page lists and what a skin/model's
   provenance metadata (§4, §14) points back to.
5. **Skins as saved diffs** (§12): once EDIT INTERFACE has been used
   enough to trust it, "save this as a skin" is a `git diff` (once
   tracked) or a bundle of the `.bak`-adjacent current files, packaged
   with the same kind of manifest `docs/platform/NETWORK.md` already
   designed for code provenance (`.provenance.yml`) — reuse that schema
   rather than inventing a second one for skins specifically.
6. **Network page**: reuse the existing "swap the main content area,
   keep the footer/chat" iframe pattern already proven by `#cityModal`/
   `#omscFrame`, rendering `docs/platform/NETWORK.md`'s registry design
   with "Patch" vocabulary throughout.
