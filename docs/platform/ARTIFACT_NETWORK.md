# EBYS Artifact Network — Models, Tools, Branches, Nodes

How a Model, Tool, or code Branch moves from one person's machine, through
the EBYS server, out into the hands of everyone who wants it — and how the
network keeps working even if the original server disappears, without
EBYS ever becoming a conventional centralized platform.

This is a different layer from `docs/platform/NETWORK.md` (code-provenance
across forked *instances* of the whole codebase, via `.provenance.yml` and
a human-reviewed registry repo) and from `docs/decentralize.md` (metadata
federation *between communities'* deck indexes — pods, circles, the follow
graph). This doc is about individual, runtime-created artifacts —
something one DJ trained, built, or forked — moving across the network of
users, nodes, and the bootstrap server. It deliberately reuses both of
those docs' vocabulary and mechanisms rather than inventing new ones; see
"What this builds on" below.

---

## The one idea this implements

> The EBYS server bootstraps the network. The network should eventually
> become capable of carrying itself.

```
PHASE 1 — BOOTSTRAP          PHASE 2 — PROPAGATION         PHASE 3 — ROGUE
     SERVER                      SERVER                    USER <-> USER
    /  |  \                    /   |   \                    ^  \  /  ^
 USER USER USER             USER USER USER                 |   \/   |
                               \    |    /                 NODE <-> USER
                                USER USER                    ^       ^
                                                            USER <-> NODE
```

The server is infrastructure, not ownership. It is the *first* copy of an
artifact, the *most persistent* copy, and (per "server incentives" below)
one useful copy among several — never the only place an artifact can be
found once it has propagated.

---

## Concepts → code

| Spec concept | What it maps to in this repo |
|---|---|
| **STATION** | Not built in this pass. A DJ's live presence already exists as `sessions` in `src/backend/db/schema.sql`. Making a Station publishable the same way as a Model/Tool is a natural follow-up, not built here. |
| **TOOLS** | New artifact type `tool` — a patch, script, or control-logic bundle. Zip multi-file tools before publishing (see "Known v1 limitations"). |
| **MODELS** | New artifact type `model`. EBYS is a remixing engine, not a generative one — the actual thing this maps to is the remix engine's *taste model*: `train_bias_torch.py`'s learned-bias MLP, exported as plain JSON (`learned_bias.json`, `feature_names`/`hidden_w`/`hidden_b`/`output_w`/`output_b`) and consumed by `slicer_bridge.js`'s `loadLearnedBias()` to score candidate slice combinations against one DJ's own preferences. Not a LoRA, not audio synthesis — it never generates a sound, it only predicts which *existing* slice combinations that DJ would rate well. Wiring the training script's output to call `publish()` automatically is a follow-up, not built here. |
| **AGENT** | Per the working definition: the coding agent only (e.g. this session), not Cricket (the instrument's AI DJ personality, unrelated). Git already gives code branches real lineage; this layer adds artifact type `branch` so a fork/diff can be published and replicated through the same pipeline as a Model or Tool, if that's ever useful outside git itself. No change to git or to Cricket. |
| **NETWORK** | `src/network/artifacts/` (this doc's code) + `src/backend/routes/network.js` (the bootstrap server's side), generalized from the exact pattern already proven in `src/network/carnet-daemon.js` / `mirror.js`. |

---

## What this builds on (read this before extending it)

- **`src/network/carnet-daemon.js` + `mirror.js`** — a working
  Corestore/Hyperswarm prototype, already validated across two machines,
  today scoped to replicating Montréal's event-crawler output as an
  append-only log. `src/network/artifacts/swarm.js` generalizes the exact
  same mechanism (one Hypercore per unit of content in a shared Corestore,
  `swarm.join(core.discoveryKey)`) from "one JSON event log" to "chunked
  bytes of any artifact." Nothing in `carnet-daemon.js`, `mirror.js`, or
  their `README.md` changed.
- **`docs/platform/NETWORK.md`'s provenance registry** — its
  `.provenance.yml` shape (`id`, `origin`, `license`, `version`, `parent`)
  is reused verbatim as the artifact manifest's field names (see below),
  so code-lineage and artifact-lineage stay one mental model.
- **`docs/decentralize.md`** flags, as the actual missing prerequisite for
  any of this, that EBYS tracks have no content hash today (`tracks.name`
  / `tracks.fingerprint` are literally the filename —
  `src/backend/db/queries.js`, `upsertTrack()`). `src/network/artifacts/hash.js`
  is that prerequisite, built here — deliberately scoped to Models/Tools/
  Branches rather than raw audio, which carries real copyright exposure
  that content-hashing doesn't resolve on its own (same caveat
  `decentralize.md` already states).
- **`docs/instrument/USER_LORA.md` / `GENERATIVE_LAYER.md`** describe a separate, optional generative layer (Stable Audio 3) that does not exist in the live instrument today — the instrument itself remixes real recordings, it doesn't synthesize new audio. If that generative layer is ever actually built, its LoRA checkpoints would be a second, later kind of `model` artifact — not the one this doc's examples assume, and not built or assumed here.
- **No blockchain, no tokens.** `docs/protocol/TOKEN.md` confirms CRKT is
  parked/speculative, not active; `docs/decentralize.md` explicitly rules
  out token-incentivized storage (Filecoin/Arweave) as contradicting the
  live tipping protocol's "no crypto required, ever." Node/artifact
  identity here is a plain ed25519 keypair (`hypercore-crypto`, already a
  transitive dependency via `corestore`), not a wallet.

---

## Artifact manifest

```json
{
  "id": "sha256:<hash>",
  "type": "model | tool | branch",
  "hash": "<sha256 of the artifact's bytes>",
  "origin": "<publishing node's ed25519 public key, hex>",
  "creator": "<username, optional>",
  "version": "1.0",
  "parent": null,
  "license": "AGPL-3.0",
  "created_at": "2026-09-14T21:00:00.000Z",
  "coreKey": "<hex public key of the Hypercore carrying the bytes>",
  "signature": "<ed25519 signature over every field above, hex>"
}
```

`parent` pointing at another artifact's `id` is how a fork or derivative is
expressed. Publishing a modification never overwrites the original — it's
a new manifest with `parent` set, exactly:

```
Alice
  |
  +-- Model X v1        (parent: null)
         |
         +-- Bob's branch  (parent: "sha256:<Model X v1's hash>")
```

Both manifests, and both sets of bytes, keep existing side by side. Nobody
can silently mutate someone else's published artifact — the hash and
signature make any tampering immediately detectable by every downloader.

---

## Flows

**Publish** (`src/network/artifacts/publish.js`) — hash the file → build +
sign a manifest with this node's identity → append the bytes into a local,
named Hypercore and join the swarm on its discovery key (now serving it)
→ copy straight into local storage and mark it activated (a node trusts
its own just-created output without re-quarantining it) → optionally
`POST` the manifest + bytes to the configured EBYS server. A server push
failing never blocks the publish — the node is already serving the
artifact over the swarm regardless.

**Download / priority resolver** (`src/network/artifacts/resolve.js`) —
tries, in order: (1) the configured EBYS server, (2) known dedicated nodes
from the local peer cache (most-recently-seen first), (3) a swarm peer,
if a coreKey for this hash is already known from an earlier lookup. First
success wins. If all three fail, the result is
`{ unavailable: true, reason: ... }` — never a fabricated source.

**Quarantine** (`src/network/artifacts/quarantine.js`) — every downloaded
artifact, regardless of which of the three sources it came from, is
verified identically before it is trusted:

```
download → quarantine/<hash>/ → hash check → signature check →
file-extension allowlist per type → scan() (real pickle-opcode scan for
pickle-risk formats) → store/<hash>/ → activate(hash)
                                        ^ separate, explicit call
```

Nothing in this pipeline executes the artifact or flips it to "usable"
automatically — `activate()` is a distinct call a person or a specific,
deliberate integration point makes, never a side effect of download.

Hashing and signing answer one question — "did this arrive unaltered
from who it claims to be from?" They say nothing about whether the
publisher's own bytes were malicious to begin with. `scan()`
(`src/network/artifacts/pickle_scan.py`) answers a slice of that
different question: any file whose format can carry a pickle payload
(`.pkl`/`.pickle`, or PyTorch's zip-or-raw `.pt`/`.pth`/`.ckpt`/`.bin`) is
statically disassembled — via Python's stdlib `pickletools.genops()`,
which parses the opcode stream without ever calling `pickle.load()` or
`torch.load()` — and any `GLOBAL`/`STACK_GLOBAL` opcode referencing
anything outside a small, explicit allowlist of known-safe reconstruction
helpers (`collections.OrderedDict`, `numpy`'s and `torch`'s own tensor
reconstructors, etc.) fails the artifact closed. This runs identically on
publish (your own file) and on every download from any source, including
the official server — publishing something never gets a looser check
than receiving it.

This is real, tested detection for one well-known, concrete attack —
pickle's `__reduce__`/`GLOBAL` mechanism, the same vector tools like
`picklescan`/`fickling` exist to catch, and the classic way a "model"
file smuggles arbitrary code execution. It does **not** statically
analyze a Tool's own `.py`/`.js`/`.pd` source for malicious logic — those
still only go through the extension allowlist above, not content
inspection. `.json` (the actual format EBYS's own taste model uses) is
inherently outside this risk entirely — JSON can't carry executable
opcodes.

**Registry** — two small, human-inspectable stores, matching the spec's
explicit "phone book, not a giant database":
- Local: `data/network/registry/<hash>.json` (manifest + known locations +
  activation state) and `data/network/peers.json` (known node pubkeys).
  Same shape as `carnet-daemon.js`'s own `seen.json`.
- Server: three small Postgres tables added to
  `src/backend/db/schema.sql` — `nodes`, `artifacts`, `artifact_replicas`.
  Metadata only; the bytes live in `data/network/server-store/` on disk,
  never in a database row.

**Availability tracking** — `registry.availability(hash)` reports
dedicated-replica count, online-peer count (last-seen within 5 minutes),
and last-seen timestamp, matching the spec's requested fields. If nobody
currently has an artifact online, `resolve()` reports it unavailable —
the system does not pretend otherwise.

---

## Server API (`src/backend/routes/network.js`)

| Route | Purpose |
|---|---|
| `POST /network/artifacts` | Publish: raw bytes in the body, manifest in the `x-ebys-manifest` header (base64 JSON). Server re-checks the hash and writes to `data/network/server-store/`. |
| `GET /network/artifacts/:hash` | Download the bytes — priority-1 source for every downloader. |
| `GET /network/artifacts/:hash/manifest` | Fetch just the manifest (used before downloading bytes). |
| `GET /network/artifacts?type=` | List/query the phone book. |
| `POST /network/nodes/announce` | A node pings in with its pubkey and which hashes it currently holds. The *only* thing a peer ever sends unsolicited — no usage telemetry, no content, matching `NETWORK.md`'s explicit "no instance phones home" stance. |

The server never deletes its copy of an artifact just because peers exist
— see "Server incentives" below.

---

## Security model

Every artifact, from every source — the official server included — passes
through the same quarantine pipeline before it's trusted. "Trusted node"
and "safe file" are never treated as the same thing: a signed, verified
manifest proves *who published this and that these exact bytes haven't
been altered since*, not that the bytes are safe to run. That's what the
`scan()` hook and the per-type extension allowlist are for, and why
nothing here auto-activates.

---

## Server incentives (why running a node is worth it)

A node isn't a dumb mirror obligated to hold everything for free. This
server's role — persistent hosting, being the well-known bootstrap
address, cold storage that outlives any one peer going offline — is
itself a service worth running. A community or individual can run a
dedicated node specialized however makes sense to them (models only,
tools only, just persistent storage, GPU-backed generation services,
whatever) — the registry doesn't require or assume uniformity across
nodes, only that a node truthfully announces what it currently holds.

## Model lineage, local votes & replanting (built, local-first)

Everything above this section is the general artifact layer (any Model or
Tool). This section is the part built specifically for Gnumbat's own model
browser (`src/gui/panel.html`'s `#modelSelectView`, served through
`src/gui/gui_hub_bridge.js`'s `models` command target) — a seed/branch
lineage, votes, training state, and persisted PickleScan status, all
stored on top of the same local, per-node registry described above. No
new database and no login system: same "local phone book, not a
database" posture as the rest of this doc, and unrelated to the
server-backed `model_refs`/`artifact_votes` design in "Open models" below,
which remains unbuilt. If that design is ever built, it and this one would
need reconciling; today only this one exists in code.

### Registry additions (`registry.js`)

`register()`'s JSON shape (`data/network/registry/<hash>.json`) grew
additive fields — every existing entry keeps working untouched, backfilled
through the same `withDefaults()` pattern already used elsewhere in this
file:

- `role` (`'seed'` | `'branch'`) — permanent, derived once from whether
  `manifest.parent` is set. Never changes after publish, even across a
  replant (see below) — `lineageStatus` is the field that moves.
- `seedId` — the hash of this lineage's original root artifact. Constant
  for every node in one lineage, branch or seed.
- `lineageStatus` (`'seed'` | `'branch'` | `'current-seed'` |
  `'previous-seed'` | `'ancestor'`) — the dynamic half. A fresh root
  starts `'seed'`, a fresh branch starts `'branch'`; only `replant()`
  (lineage.js, below) ever moves a node to `'current-seed'`/
  `'previous-seed'`/`'ancestor'`.
- `integrateFollowingBranches` (bool, default `false`) — a seed-only flag
  a curator can toggle (`setIntegrateFollowingBranches()`, wired to the
  UI's "integrate branches: on/off" chip). **Stored and displayed only —
  no code reads it to actually do anything yet.** It exists as the
  architectural placeholder for "lineage stays independent models,
  evolutionary integration is optional and never literal file merging,"
  per the spec this was built against; what integration actually means in
  practice is deliberately still undecided, same posture as succession
  below.
- `creators[]` / `editors[]` — creators (plural: multiple supported) come
  from `publish()`'s `creator` option; `editors[]` (`{name, nodeId,
  lastEditAt}`) are appended by `addEditor()` on every rename/bake/touch.
  `activeEditors` (in `modelCard()`, not stored) filters `editors[]` to
  the last `ACTIVE_EDITOR_WINDOW_MS` (30 days) — "who's actively working
  on this," distinct from "who ever touched it."
- `trainingState` (`'untrained'` | `'training'` | `'ready'`, extend as
  real training wiring lands) and `pickleScan` (`{status, scannedAt,
  engine, scannerVersion}`) — see below.
- `votes` — a cached `{up, down}` tally. `votes.js` (below) is the real
  source; this is a fast-read cache updated on every vote, never the
  other way around.

`modelCard(hash)` is the one composed reader the hub calls for the UI: it
returns the manifest plus lineage/creators/editors/trainingState/
pickleScan/votes, and **three separately-named sub-objects that are never
allowed to collapse into each other**:

- `historical` — metadata says this was ever registered (`recorded`,
  `registeredAt`).
- `network` — a peer currently has it right now (`dedicated_replicas`,
  `online_peers`, `last_seen`, `currently_available`) — same
  `registry.availability()` this doc already described above, just
  exposed through this reader too.
- `usability` — locally present, quarantine-passed, activated
  (`locallyPresent`, `quarantinePassed`, `activated`, `usable`).

A model that's `historical.recorded: true` but `network.currently_available:
false` is exactly "existed, nobody has it right now" — the UI's
`modelStateText()` reports that as `archived` (was a seed/branch, now only
historical) or `unavailable` (still supposed to be reachable, isn't),
never as ready-to-use.

### Lineage & replanting (`lineage.js`, new)

`roleOf()` / `seedIdFor()` derive `role` and walk `manifest.parent`
pointers to the lineage root (cycle-guarded, same defensive idiom
`panel.html`'s own `flattenTree()` uses).

`replant(hash, {reason, actor})` is the branch→new-seed transition
("replanting," not replacement or deletion — the spec's own term).
**It never touches `manifest.parent`** (immutable, signed) **and never
deletes anything.** It only relabels `lineageStatus` — the target branch
becomes `'current-seed'`, the outgoing current-seed becomes
`'previous-seed'` (older ones on file step down further, to `'ancestor'`,
so there's always at most one `'previous-seed'`, the immediately
preceding one) — and appends one entry to an append-only history file at
`data/network/lineage/<seedId>.json` (`{at, actor, reason, fromHash,
toHash}`). The old seed's registry entry, bytes, and `network`/`usability`
status are completely untouched by this call; whether it's still
*usable* is entirely `modelCard()`'s own, separate judgment, exactly as
long as the P2P network actually still has it.

`evaluateSuccession(seedId, {policy})` is the deliberately inert
succession hook. It ships with **no default policy** — call it without
one and you get back `{recommendation: null, reason: 'no succession
policy configured'}`. A policy is a plain function `(candidates,
{votesByHash, availabilityByHash}) => hash|null` a future caller supplies;
this file invents none, per the explicit instruction not to hardcode
something like "if upvotes > seed: replace seed." `replant()` itself
stays callable directly regardless of whether a policy ever exists —
today the only caller is the UI's own "Replant as seed" action, i.e. a
human decision, not an algorithm.

### Votes (`votes.js`, new)

A local, no-account ledger: one JSON file per artifact at
`data/network/votes/<hash>.json`, keyed by a caller-supplied `voterId` —
any stable string the caller already has (the hub mints and persists one
per browser via `localIdentity()` in `panel.html`, no account, no login).
Re-voting updates that voter's entry in place rather than double-counting;
`value: 0` retracts. `voterKind` (`'listener'` | `'trainer'` | undefined)
is recorded for future analysis only — **both kinds can vote today, and
nothing currently weights or gates a vote by it.** `castVote()` recomputes
`tally()` from the ledger (the ledger is the real source of truth) and
writes the result into the registry's cached `votes` field.

This is intentionally the *only* thing votes do. Nothing in this file, or
anywhere else in this feature, deletes or hides a model for losing votes
or popularity — the only thing that removes a registry entry at all is
the UI's own explicit delete action (`models.js`'s `deleteModel()`,
unchanged by this work). Votes are one candidate input a future
succession `policy` function could read (see `evaluateSuccession()`
above); they are never a rule enforced here.

### PickleScan, persisted (`quarantine.js`, `publish.js`)

Previously, a scan's result was returned once and thrown away. Both the
download path (`quarantine.process()`) and the local-publish path
(`publish()`) now call `registry.setPickleScanResult(hash, {...})` after
scanning, so the result survives past that one call and the UI can show a
real status, not just "whatever the last scan said in this process." Four
distinct states (`pickleGlyph()` in `panel.html`), never collapsed into a
single checkmark: `scanned-clean` (✓), `flagged` (⚠ — quarantined,
recorded, never activated), `scan-failed` (?), and `not-applicable` (—,
e.g. this feature's own untrained JSON draft models, which aren't pickle
files at all and were never at risk). A legacy row from before this
change reads as "not yet scanned" (`…`) rather than silently claiming
either clean or flagged.

### The hub as source of truth (`gui_hub_bridge.js`, `panel.html`)

Before this work, every field above (`MODELS` in `panel.html`) lived only
in that one browser tab's `localStorage`. Now `gui_hub_bridge.js` exposes
a `models` command target (`list`, `card`, `newSeed`, `branch`,
`hybridize`, `rename`, `delete`, `setBakes`, `touchEdit`, `vote`,
`setIntegrate`, `replant`) backed directly by `registry.js`/`lineage.js`/
`votes.js`/`models.js` — never held only in the hub process's memory —
and every mutation broadcasts the refreshed list to every connected
panel, so multiple open tabs stay in sync. `panel.html` requests
`models/list` on hub connect and treats the reply as `MODELS`;
`localStorage` is kept only as a fallback cache, read when the hub is
unreachable (`hubReady()` false) so a standalone/offline `panel.html`
still opens and works exactly as it did before this change, just without
any of the fields above — a legacy-only row shows `…` (not-yet-scanned)
and `○0` (not currently available) rather than fabricating either.

### What this section does *not* claim

- No succession algorithm ships. `evaluateSuccession()` requires an
  explicit policy function; replanting today is a human clicking
  "Replant as seed," never automatic.
- `integrateFollowingBranches` is a stored, displayed flag with no
  behavior wired to it yet — see above.
- Vote weighting by `voterKind`, and any actual use of `trainingState`
  beyond the three placeholder values, are both future work.
- The votes ledger has the same honesty caveat as "Open models"'s own
  voting design below: a `voterId` is a real cost above a free click
  (the hub's identity is per-browser, not per-request), but nothing here
  cryptographically proves one node/browser can't vote more than once by
  clearing storage and re-minting an identity. Good enough for a
  no-login, local-first v1; not sybil-proof.


## Open models — continuous P2P training without a full download

**Status: designed here, not implemented.** Everything above this section
(hashing, signing, quarantine, the pickle scanner, replication) is real
and tested. This section is the design for the next slice, worked out
because it changes what the manifest and server schema need to look
like -- worth settling before more code gets written on top of the
current shape, not before it's built.

**The problem this solves:** the base design makes every artifact
content-addressed and immutable -- the moment a model's weights change,
it's different bytes, a different hash, a new artifact. That's
deliberate (no silent mutation, ever). But it means a naive reading would
force every training contribution to feel like a fork, and it would force
a contributor to download the full model just to add one small update to
it. Neither is necessary.

### A model ref: a name that moves, versions that don't

Same trick git uses for branches. The immutable chain underneath doesn't
change -- version 1, 2, 3, each a real, individually hashed and signed
artifact with the previous one as `parent`, exactly as already designed
above. What's new is a small, separate, *mutable* record -- a **model
ref** -- that just points at "whichever version is current":

```
model_refs
  ref_id          e.g. "alice/vocal-taste"
  creator_user_id
  current_artifact_id   -- moves forward on each accepted contribution
  open_for_training      boolean, creator's own choice, can be flipped off
  created_at
```

Everyone who cares about "Alice's vocal-taste model" points at the ref,
not at one specific version -- so it keeps improving under a stable name,
without ever breaking the rule that a published version, once published,
never silently changes underneath someone already using it. Anyone can
still fork any specific version off the chain into their own private
artifact at any time, whether or not the open line keeps moving --
opening a model for community training never removes anyone's ability to
just take a snapshot and go their own way.

### Who hosts it (per your call above: any opted-in node)

Training a model requires the full weights loaded in memory wherever the
gradient step actually runs -- that part has no shortcut. What doesn't
require a shortcut is *who* that is: any node that opts in announces
itself as a **trainer** for that ref (an extension of the existing
`POST /network/nodes/announce` -- add `trains: ["alice/vocal-taste", ...]`
to what a node already reports about itself). This is the same
"nodes can specialize" idea already in "Server incentives" above, applied
to one more role. The EBYS server can be a trainer too -- it's simply one
more opted-in node, not a required one.

If nobody currently opted in as a trainer for a ref is online, training on
it pauses -- exactly the same honest "temporarily unavailable" story
every other artifact already gets, not a special case.

### Contributing without downloading

A contribution is small on purpose, because of what EBYS's taste model
actually trains on: not audio, not the model's own weights, just the
session's rating logs (`training_log_horizontal.jsonl`-shaped data, a few
KB). Contributing means sending that small file to any node currently
hosting the ref as a trainer -- never the model itself. The receiving node
retrains locally (the same `train_bias_torch.py` step it would run on its
own data), publishes the result as a new version with `parent` pointing at
the version it started from, and advances the ref. The contributor never
holds the full model unless they separately choose to fork or download it.

### Voting (per your call above: only after verified use)

Ratings need one converged view to mean anything as "community trust," so
-- unlike artifact bytes -- they live on the server, in a small table next
to the existing `artifacts`/`nodes` tables, not replicated peer-to-peer:

```
artifact_votes
  artifact_id
  voter_node_id
  value          -- +1 or -1
  created_at
  UNIQUE(artifact_id, voter_node_id)
```

A vote is only accepted if the voting node can show it actually has that
exact artifact locally, active and quarantine-passed (its own
`data/network/registry/<hash>.json` says `activated: true`) -- proof of
real use, not proof of identity. It's not unbeatable (someone could
download, vote, delete, repeat), but it's a real cost above "free vote,"
consistent with not wanting a login requirement for something the rest of
the network doesn't otherwise require one for.

### What still needs building (not done yet)

- `model_refs`, `artifact_votes` tables + `POST/GET /network/refs`,
  `POST /network/artifacts/:id/vote`, `GET /network/artifacts/:id/score`
  on the server.
- The `trains: [...]` field in the node-announce payload, and a matching
  "accept a contribution" endpoint on a trainer node itself (today every
  node only exposes local CLI commands, not an inbound HTTP surface of
  its own -- a trainer node needs one).
- Wiring `train_bias_torch.py` to actually run as "retrain from a
  contribution" rather than only "retrain from this node's own local
  logs."

---


---

## Known v1 limitations (deliberate, documented, not silently missing)

- **Model refs, open-model training, and voting are designed but not built.** See "Open models" above for the full design — none of `model_refs`, `artifact_votes`, or a trainer node's contribution endpoint exist in code yet.
- **Single-file artifacts only.** `publish()` requires one file; zip a
  multi-file Tool before publishing. Directory hashing exists in
  `hash.js` for future use but the P2P transport (`swarm.js`) currently
  moves one file's bytes.
- **No blind discovery-by-hash over the swarm.** A peer can only fetch an
  artifact over Hyperswarm once it already has that artifact's manifest
  (and therefore its `coreKey`) from the server or a known node. Pure
  "ask the DHT who has this hash" discovery is future work — the spec
  calls for P2P to start simple and evolve, and this is that simple
  starting point.
- **No multi-writer merge (Autobase).** Each artifact has exactly one
  publishing node; forks are new artifacts with `parent` set, not
  collaborative edits to one core.
- **`scan()` covers one real, specific vector — not everything.** The
  pickle-opcode scan (`pickle_scan.py`) is real, tested detection for
  code smuggled via `.pkl`/`.pickle`/`.pt`/`.pth`/`.ckpt`/`.bin` files.
  It does not review a Tool's own script source (`.py`/`.js`/`.pd`) for
  malicious logic, and it does not scan inside a Tool's `.zip` bundle's
  contents — those are only extension-allowlisted today. A general
  content/malware scanner for everything else is still a documented gap,
  not silently claimed as covered.
- **No automatic publish trigger.** Nothing in the taste-model trainer
  (`train_bias_torch.py`), the TUI, or the instrument calls `publish()`
  on its own yet — every publish today is a deliberate, explicit call
  (via `node src/network/artifacts/cli.js publish ...` or the library
  directly).

---

## Trying it

```bash
cd src/network
npm install                      # picks up hypercore-crypto alongside the existing corestore/hyperswarm deps
node artifacts/cli.js whoami     # prints this node's public identity, generating one on first run
node artifacts/cli.js publish /path/to/a-lora-checkpoint.safetensors --type model --version 1.0
node artifacts/cli.js list       # the local registry
node artifacts/cli.js fetch <hash> --server https://your-ebys-server
```

`data/network/` (gitignored, same as everything else under `data/`) holds
all local state: `identity.json`, `registry/`, `peers.json`,
`quarantine/`, `store/`, and the Corestore itself.
