# External-network bridges for Gnumbat rooms — Discord first

> Exploration note, not a build plan — same convention as `decentralize.md`. Nothing described below is implemented. Written before any code changes, at the user's explicit request, to answer: where does a Discord (then Signal/Matrix/IRC) bridge fit into Gnumbat as it actually exists today?

> **UPDATE — user: "the rooms would be set by DJs."** Room creation/ownership belongs to a DJ opening a set, not a static admin config file. This changes §D (identity) and §F (privacy/bridge-enablement) below, and connects directly to the `sessions` table noted in §A — see each section's revision.

## 0. Reality check first — this is the most important finding

The request describes "extending the existing Gnumbat chat/network architecture." Worth saying plainly, because it changes the whole shape of the plan: **there is no existing multi-user chat/room system in Gnumbat today.** Grepping the whole repo for `room`, `chat`, `participant`, `discord` turns up three unrelated things, not one chat architecture:

1. **Cricket** — a single shared conversation with a *local LLM* (Ollama), not with other humans. Every text message a user sends currently goes to `callCricket()`, gets a system prompt built from `docs/instrument/CRICKET.md`, and comes back as `{t:"chatReply", ...}`, broadcast to whoever's connected. There is no human→human relay path anywhere in the codebase.
2. **`src/network/`** — `carnet-daemon.js` + `mirror.js`, a Hypercore/Hyperswarm pair that replicates the event-crawler's *venue/show listings* between instances (stage 1 of the plan in `docs/platform/NETWORK.md`). This is data-provenance federation, unrelated to messaging.
3. **UI placeholders that describe the *intent* for rooms, honestly labeled as fake.** `src/gui/panel.html` already has `#roomChip` (`[ROOM: OUT]` / `[CITY: MTL]`) and `#roomCountBox` (`1 in room`), and the inline HTML comments quote you directly: *"the software works in rooms. general room shows everything but the user can choose a specific venue, therefore entering this venue room, evenko room for example... [ROOM: OUT] is the general room"* and *"add [active user] in the room instead of CO2... like the number of people in the room."* Both are flagged in-code as static placeholders — *"there's no presence channel anywhere in this stack... this can't be a real live count yet, only a plausible-looking one."*

So the product concept ("Gnumbat rooms," general room vs. venue-scoped rooms, a presence count) is already decided by you and sitting in the panel's own comments. What's missing is everything behind it: no room object, no participant object, no per-room message routing, no presence channel. `docs/platform/NETWORK.md` says the same thing explicitly in its own "Parked for later" section: *"Ephemeral vs. persistent chat, and whether a forum belongs alongside it"* is listed as a real, undecided, unimplemented question. `GRANT.md`'s Sept 2026–Jan 2027 line item ("chat, amis et comptes") confirms it's roadmapped, not built.

None of this blocks the plan below — if anything it simplifies it, because there's no existing chat behavior to avoid breaking. But it does mean the honest framing is "design the first real Gnumbat room/participant layer, with Discord as the first external door into it" rather than "extend" something that exists.

---

## A. Current architecture (what's actually there)

**How messages travel between two people right now:** they don't, between humans. The closest thing is Cricket. The transport for that is `src/gui/gui_hub_bridge.js`, a hand-rolled HTTP + WebSocket server on `:8080` (no `ws` npm dependency — it implements the WebSocket handshake and frame parser itself, ~text frames + ping/pong/close only). Every browser tab that opens `panel.html` opens one WebSocket to this hub; the hub keeps them in a flat `Set` called `clients` (line 639). `broadcast(obj)` (line 740) writes a JSON frame to *every* socket in that set — there is no partitioning by room, channel, or anything else. Client → server messages are a tiny tagged union: `{t:"cmd", ...}` (instrument control), `{t:"chat", text}` (talk to Cricket), `{t:"ping"}`. Anything else logs `unknown frame type` and is dropped.

This same hub is the direct replacement for the older `ws_server.js` (the Max-era hub) — the file's own header comment says so: *"the TUI has had nothing to talk to. This is that hub, rebuilt as a standalone process... matching the port the old ws_server.js used, so anything that ever pointed at it (the TUI) still can."* So today, in the Pd-migrated setup, `gui_hub_bridge.js` is the one control-plane process both the browser panel (`panel.html` / `gnumbat-live.js`) and (by port convention) the terminal UI are meant to speak to. `src/max/ws_server.js` is the equivalent for the still-live Max path — two parallel hubs for two parallel engines, same as everywhere else in this repo (per `CLAUDE.md`'s "why two parallel engines exist" section).

**Where "rooms" are represented:** nowhere in code. `#roomChip` is a static string. There is no `Room` object, no room list, no room config.

One thing that *does* already exist and maps cleanly onto "rooms are set by DJs": `sessions` in `schema.sql` — `dj_id`, `venue`, `mode` (`'web'`/`'venue'`), `status` (`'active'`/`'closed'`), `started_at`/`closed_at`. A DJ starting a set is already, in the data model, the same event as "a DJ opens a room." That's a real head start — see the revised identity and privacy sections below for what it implies.

**Where users/identities are represented:** two *completely separate* systems that have never been connected:
- `src/backend/db/schema.sql`'s `users` table (Postgres) — DJs and artists, `is_dj`/`is_artist`, Stripe Connect account, password hash. Auth is JWT (`routes/auth.js`), used only by the Express tipping-protocol API (`/auth`, `/slices`, `/tips`, `/accounts`).
- The WebSocket hub has **no identity concept at all.** `panel.html`'s own comment on its login UI is explicit: *"there's no real authentication anywhere in this file yet (the username/password fields and ⏎ sign-in glyph were always inert markup)."* Connections are told apart only by `Origin`/`User-Agent` headers, for diagnostics, not auth.

These two systems addressing different concerns (who gets paid vs. who's in a chat) is actually healthy — see §D below on why they should stay separate.

**Where chat history lives:** Cricket's conversation (`chatHistory`, `gui_hub_bridge.js` line 1066) is a single in-memory array in the hub process — not per-room, not per-user, shared by every connected panel, capped at 41 turns, gone on restart. Nothing is written to disk. This matches the project's stated philosophy exactly — "the server moves things, the clients remember things" — except right now there's no client-side persistence of it either, because there's only one shared AI conversation, not per-user threads. A native Gnumbat room/chat layer should give each *client* its own local history (this is the browser panel's job, or the TUI's), and keep the server's in-memory state to routing + a short in-flight buffer, not a permanent log — consistent with what the prompt asked for and what `docs/platform/NETWORK.md` explicitly warns against ("It should NOT... become a centralized global chat database").

**The closest thing to an existing adapter/bridge abstraction:** `carnet-daemon.js`. It's not a chat bridge, but its *shape* is exactly the pattern to reuse: a small standalone Node process, zero changes required to the thing it watches (the Go event-crawler), joins a Hyperswarm discovery key, replicates over `corestore`. `src/network/README.md` stages it explicitly (stage 1 local-only, stage 2 replication, stage 3 multi-writer) — same staged-rollout instinct this Discord plan should use. The other close analogue is `src/tui/link_server.js` — UDP multicast peer discovery between two Gnumbat decks *in the same room*, with a simple `EBYS1 <unitId> SET/DUMP/PING` wire protocol and no central coordinator. `docs/decentralize.md` already names LINK as "the precursor" for any future peer-discovery layer.

**Minimum files that already resemble what's being asked for, ranked by relevance:** `gui_hub_bridge.js` (the hub) → `panel.html` + `gnumbat-live.js` (the UI shell, further along than the backend) → `carnet-daemon.js`/`mirror.js` (the only real federation code that exists) → `link_server.js` (peer-discovery precedent) → `schema.sql`/`auth.js` (identity precedent, deliberately *not* to be reused for chat identity).

---

## B. Proposed adapter architecture

```
                         Gnumbat ROOM (new concept)
                    in-memory registry inside gui_hub_bridge.js
                    { roomId, participants: Set, bridges: {...} }
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
           browser panel      terminal (TUI)      external bridge
         (panel.html, WS      (sdj-tui.js, WS      process(es) — ALSO
          client of the        client of the        a WS client of the
          hub, same as         hub, same port)       same hub, nothing new
          today)                                     invented at the
                                                       transport layer
                                                            │
                                              ┌─────────────┼─────────────┐
                                              │             │             │
                                        discord-bridge.js  (future)  (future)
                                         (discord.js       signal-      matrix-
                                          Gateway client)   bridge.js    bridge.js
                                              │
                                          Discord Gateway
                                              │
                                        Discord server/channel
```

The key design decision: **an external-network bridge is just another WebSocket client of `gui_hub_bridge.js`, using the same protocol the browser panel already uses**, not a new subsystem bolted onto the side. That's the "don't redesign Gnumbat around Discord" principle made concrete — Discord becomes a *port*, literally just one more thing that opens a socket to `:8080` and speaks the hub's existing tagged-union protocol, extended with a couple of new message types and one new field (`participant`/`origin`) that every client — including the browser panel and the TUI — can already ignore harmlessly if they don't understand it.

What Gnumbat core owns (per the "ports, not foundation" principle): the `Room` registry, the `Participant` abstraction, the routing/broadcast logic, and the bridge-enablement config. What Discord owns: translating Discord Gateway events into the hub's message shape and back — nothing about Discord's data model (guild IDs, channel IDs, embeds, message IDs) leaks past the adapter boundary into the room/participant model.

---

## C. Message flow

**Gnumbat → Discord** (an Gnumbat user in the browser panel types a message):

```
panel.html  --WS-->  gui_hub_bridge.js  --broadcast (room-scoped)-->  discord-bridge.js  --Gateway API-->  Discord channel
   {t:"room.msg",           tags msg with            {t:"room.msg",          bot posts the
    text, roomId}           participant + id          origin:"gnumbat", ...}    message as itself,
                                                                              prefixed "[Gnumbat] alex:"
```

**Discord → Gnumbat** (a Discord user types in the bridged channel):

```
Discord channel  --Gateway 'messageCreate' event-->  discord-bridge.js  --WS-->  gui_hub_bridge.js  --broadcast (room-scoped)-->  panel.html / TUI
                                                        wraps as                    fans out to every
                                                        {t:"room.msg",               participant in
                                                         origin:"discord",           that room except
                                                         participant:"discord:mika"} the Discord bridge
                                                                                     itself (see §E)
```

Both directions reuse the *existing* `attachWebSocket`/`broadcast()` machinery unchanged. The only new work inside `gui_hub_bridge.js` is: (1) a room registry so `broadcast()` can be scoped instead of global, (2) a `t:"room.msg"` handler distinct from the existing `t:"chat"` (which must keep meaning "talk to Cricket" — conflating the two would silently break the AI chat), (3) stamping `participant`/`origin`/`id` onto every message before it's relayed.

---

## D. Identity model

Three things that must stay separate, matching the prompt's own instruction:

- **Identity** — `network:local-id`, e.g. `gnumbat:xxxxxxxx` (opaque, only meaningful within one instance's runtime — not the Postgres `users.id`), `discord:194728...` (Discord's own snowflake user ID, stable and free — no reason to invent a new one).
- **Display name** — `alex`, `mika` — mutable, cosmetic, never used as a key.
- **Network** — `gnumbat` / `discord` / `signal` / `matrix` — which port the participant came through.

```yaml
participant:
  id: discord:194728301122
  network: discord
  display_name: mika
  room: /general
```

Deliberately **not** the Postgres `users` table. That table is the tipping-protocol identity — DJs, artists, Stripe accounts, money. Chat participants are a different, much lighter-weight concern: mostly anonymous-by-default (Discord/Signal users never need to "become" Gnumbat accounts, per the prompt's own requirement), ephemeral, scoped to a room's runtime. The right home for this is an in-memory registry inside `gui_hub_bridge.js` (a `Map<roomId, Map<participantId, {network, displayName, socket|bridgeRef}>>`), not a database table — this is presence, not a ledger, and matches "the server moves things, it doesn't archive them." A *native* Gnumbat user (someone who did register via `/auth`) can optionally attach their `users.id` to their `gnumbat:` chat identity later, as a bonus link between the two systems — but the chat layer must work fully without it, since most humans in a room (Discord users, unregistered listeners) never will.

This also directly answers your own flagged gap on `#roomCountBox`: once participants are tracked per room, "1 in room" becomes a real count for free, and `#roomChip`'s "[ROOM: OUT] / evenko room" distinction becomes a real room ID instead of a static string — closing two placeholders you already called out honestly in the code.

**Room ownership is the one deliberate exception to "chat identity stays separate from the `users` table."** Per your clarification — rooms are set by DJs — opening/naming a room is the same act as a DJ starting a set, which is already gated behind real auth (`routes/auth.js`, JWT, `users.is_dj`). So a room's *owner* identity is legitimately `gnumbat:<users.id>`, resolved through the existing login, because ownership is an accountability question (who can name this room, who can turn its bridges on, who can close it) — unlike a listener's or a `discord:*` participant's passing presence in it, which stays exactly as lightweight as described above. The general room (`[ROOM: OUT]`) is the one room nobody owns: the default lobby you're in when you haven't joined a DJ-owned one.

---

## E. Loop and duplication prevention

**Loop prevention** is a one-line rule once every message carries `origin`: **an adapter never re-sends a message whose `origin.network` equals its own network.** The Discord bridge subscribes to `room.msg` broadcasts from the hub; before posting to Discord, it checks `msg.origin.network !== "discord"`. Symmetric for any future adapter. This is exactly the check `carnet-daemon.js` doesn't need (it only ever writes forward, never reflects), but it's the standard fix for any bidirectional relay and it's cheap because the metadata is already required for identity display.

**Duplication across federation** doesn't have a real answer yet, because — as §A found — there's no cross-instance chat federation to design against; `docs/platform/NETWORK.md`'s federation model is scoped to content (events, genres), not live messages, and explicitly parks chat as a separate decision. The forward-compatible move is cheap now and expensive to retrofit later: give every message a stable ID at the point of origin — `sha256(origin_network + origin_participant_id + room + origin_local_seq)`, the same recipe `carnet-daemon.js`'s `eventId()` already uses for exactly this reason (a stable hash of identifying fields, not a random UUID, so the same logical event/message computed twice — by two instances relaying the same bridged message — hashes to the same ID and can be deduped on sight). No instance needs to ask another instance for permission to compute this; it falls out of fields the originating message already has.

---

## F. Privacy implications

Today this is simpler than usual, for an unglamorous reason: **Gnumbat has no private/DM concept at all yet** — everything in the current hub is one global, unscoped broadcast. So there's no existing "private conversation" that could accidentally leak to Discord; the risk is prospective, not a live bug. The principle to build in from day one, matching the prompt's instruction and `docs/platform/NETWORK.md`'s general stance against silent data export: **a room's bridges are off by default**, and turning one on is an explicit, visible, per-room action.

Given "rooms are set by DJs," that action *is* the DJ's own — not an admin editing a config file ahead of time. The natural shape: something like `:bridge discord on` from the TUI or panel, scoped to the DJ's own currently-open session/room, checked against the same JWT identity that already gates `routes/auth.js` — so only that room's owner (or, later, an Gnumbat operator) can flip it, and the check is "is this the DJ who owns this room," not "is this any DJ." Where that toggle persists is a genuinely open implementation choice, not a settled one: it could be a `bridges JSONB DEFAULT '{}'` column added to `sessions` (Postgres is already the source of truth for "which room exists and who owns it," so this keeps it in one place and the tipping-protocol backend already depends on that row existing), or it could stay file-based (`data/rooms/<session.id>.json`, written by the hub the instant the DJ toggles it, matching `stream.txt`/`genres.json`'s convention). Either way, the rule downstream doesn't change:

```json
{
  "roomId": "<session.id>",
  "ownerId": "gnumbat:<users.id>",
  "bridges": {
    "discord": { "enabled": true, "guildId": "...", "channelId": "..." },
    "signal":  { "enabled": false }
  }
}
```

`gui_hub_bridge.js` only forwards a room's `room.msg` traffic to a bridge process if that room's owner has said so. If Gnumbat ever grows a private/DM message type later, the same gate applies unchanged: bridges only ever see messages sent to a room they're explicitly attached to, never anything scoped narrower.

---

## G. Discord integration plan

**Webhook vs. bot/Gateway** — you asked to weigh this explicitly: an incoming webhook is enough for Gnumbat → Discord *notifications only* (e.g., "now playing," session-start pings) and needs no bridge process at all, just an HTTP POST from wherever those events already fire. It cannot receive anything back — Discord doesn't push messages to a webhook URL. Since the actual ask is bidirectional participation (a Discord user chatting *with* Gnumbat users), a webhook is not sufficient on its own; the real integration needs a bot application with the Gateway connection (discord.js is the standard client for this — persistent WebSocket to Discord, `MESSAGE_CONTENT` intent to read message text, `channelId.send()` to post). Worth still keeping the webhook path available as a cheap, low-risk *addition* for one-way announcements in rooms that don't want full bidirectional bridging.

**New process:** `discord-bridge.js` (proposed location: `src/network/` alongside the other bridge/daemon processes, or a new `src/bridges/` if you'd rather keep `src/network/` scoped to the carnet work it currently is — your call, both fit the existing per-concern-daemon convention). It does two things: (1) a discord.js client listening for `messageCreate` in configured channels, relaying into the hub as `{t:"room.msg", origin:{network:"discord", participant:"discord:<id>"}, ...}`; (2) a WebSocket client of `gui_hub_bridge.js` (identical connection shape to `panel.html`), listening for `room.msg` broadcasts from Gnumbat-side participants and posting them into Discord via the bot, prefixed with the origin tag (`**[Gnumbat] alex:** anyone going tonight?`) so Discord users see where messages come from without Gnumbat needing to impersonate them as separate Discord identities (no per-user Discord accounts, no webhook-per-user trick needed — keeps this simple).

**The DJ's own toggle decides which channel maps to which room** — a `discord.guildId`/`channelId` pair attached to that room's owner record from §F, set when the DJ enables the bridge for their own set, not pre-provisioned by an admin. Adding "evenko's Discord" later is one DJ's action, not a new deploy.

---

## H. Future Signal / Matrix / IRC plan

Signal specifically, per your instruction, is *not* first and shouldn't be treated as "just another Discord." The trust model is genuinely different and worth stating plainly rather than assumed away: Signal has no public bot/Gateway API by design (that's the point of Signal) — the only way to bridge it today is `signald`/`mautrix-signal`-style unofficial bridges that puppet a real Signal *account* (usually a dedicated phone number registered as "the bridge"), which means a Signal bridge for Gnumbat would require Gnumbat to hold and operate a real Signal identity with its own phone-number registration and message-storage/retention exposure, not a lightweight bot credential like Discord's. That's a materially bigger trust and ops commitment than Discord, and it should stay an explicit, later decision — not something the Discord work should quietly make easier by accident.

What *does* generalize cleanly, because of the `network`-tagged `Participant`/message model in §D: any future adapter — Signal, Matrix, IRC — is the same shape as `discord-bridge.js`: a standalone process, a WS client of the same hub, translating its own network's events into `{t:"room.msg", origin:{network:"<name>", ...}}` and back, checked against the same room-bridge config in §F and the same loop-prevention rule in §E. Matrix is the closest to Discord in trust model (an application-service bot, no personal-account puppeting required) and would likely be second, if any is; IRC is nearly as simple as Discord (bot with a nick, one TCP connection, no Gateway subtleties). None of this requires touching `gui_hub_bridge.js` again once the room/participant/`room.msg` plumbing from the Discord work exists — that's the actual payoff of doing the adapter boundary correctly the first time.

---

## I. Files that would eventually need to change

New (additive, no existing behavior touched):
- `src/network/discord-bridge.js` (or `src/bridges/discord-bridge.js`) — the bot/Gateway process.
- A small room/participant module required by the hub, e.g. `src/gui/rooms.js` — in-memory registry + `data/rooms/*.json` config loader.
- `data/rooms/general.json` (and one per venue room later) — bridge-enablement config, gitignored like the rest of `data/`.
- `docs/platform/CHAT_BRIDGES.md` (this document) or folded into `docs/platform/NETWORK.md`'s existing "Parked for later" section once a real design is wanted there.

Modified (small, surgical):
- `src/backend/db/schema.sql` — if the Postgres-side option from §F is taken, `sessions` gains a small `bridges JSONB DEFAULT '{}'` column (or an adjacent one-row-per-session table); no other schema change, and the tipping-protocol queries in `db/queries.js` are untouched.
- `src/gui/gui_hub_bridge.js` — tag each WS connection with a `roomId` (query param or a `hello` message on connect, defaulting to `/general`); add a `t:"room.msg"` handler (separate from the existing `t:"chat"`, which stays Cricket-only); scope `broadcast()` by room membership instead of the current unconditional fan-out to `clients`; stamp `participant`/`origin`/message `id` on every relayed message; verify the DJ's JWT (from `routes/auth.js`'s `JWT_SECRET`) on a room-owner's connection so a `:bridge ... on` toggle can be trusted — this is new work, since the hub currently has no auth concept at all (see §J).
- `src/gui/panel.html` + `src/gui/gnumbat-live.js` — render the `[Gnumbat] alex` / `[Discord] mika` origin prefix on incoming `room.msg` frames inside the existing `.conv`/chat box (no new UI surface, reuse what's there); wire `#roomChip` and `#roomCountBox` to the real room/participant registry instead of their current static strings.
- `src/tui/app.js` (optional, can follow later) — same origin-prefix treatment for the terminal chat pane, once/if the TUI's WS client is confirmed pointed at the same hub.

That's it — two new small files plus a config convention, three touched files, none of them rewritten, matching "keep the existing architecture intact wherever possible."

---

## J. Risks and open problems

- **`t:"chat"` vs. `t:"room.msg"` collision.** The existing `t:"chat"` message type is semantically "talk to Cricket" and is load-bearing UI (the whole `.conv`/chatOpen overlay). Reusing that tag for human-to-human room messages would silently break or confuse the AI chat; they need to stay distinct message types even though they'll likely share the same visual chat box.
- **No auth on the hub today.** `gui_hub_bridge.js` currently has zero connection-level authentication — anyone who can reach `:8080` can already claim to be anyone. Before bridging in outside networks, at minimum the bridge processes themselves need to be the *only* writers allowed to stamp `origin.network:"discord"` etc. on a message (the hub should reject a browser panel client claiming a Discord origin) — otherwise identity spoofing is trivial. Gating bridge-toggles behind "is this DJ the room's owner" (§D/§F) meaningfully narrows this, but only once the WS hub actually verifies a JWT on that connection — today the hub and the JWT/auth system have never been wired together at all, so that handshake is a new, concrete prerequisite, not a detail.
- **The hub is young and hand-rolled.** `gui_hub_bridge.js`'s own header says it's *"NOT YET EXERCISED AGAINST A LIVE PD INSTANCE"* and its WebSocket implementation is a from-scratch frame parser with no rate limiting or message-size caps, built for "a local control surface." Piping in traffic from a public Discord server changes its threat model — it now needs basic hardening (per-message size cap, per-bridge rate limit) before it's safe to expose that way, independent of the room/bridge work itself.
- **A Discord bot means a new always-on external dependency.** Everything else in this stack is deliberately local-first (Ollama runs offline, the analysis pipeline needs no network). A Gateway connection is a persistent outbound connection to Discord's infrastructure — fine as an opt-in per-room feature, but it should never become something Gnumbat *requires* to function, and that should probably be reflected in how it's started (its own daemon/LaunchAgent, not folded into `setup.sh`'s required steps).
- **Federation ambition is currently much further along on paper than in code.** `docs/platform/NETWORK.md`'s registry/carnet model is real, working code for *content* federation (`carnet-daemon.js` genuinely replicates today); a Montréal↔Tokyo *room* bridge is not close to that — it's a clean design question, not an extension of existing federation code, and `docs/platform/NETWORK.md` says so itself ("Parked for later"). Worth not overselling how much of the Discord work de-risks that later question — the loop-prevention and identity model in §D/§E generalize to it, but the actual cross-instance transport does not exist yet in any form.
- **Discord API ToS/rate limits** are an operational constraint on `discord-bridge.js`, not an architectural one, but worth flagging early since a busy room posting every message individually can hit Discord's per-channel rate limits under load.
