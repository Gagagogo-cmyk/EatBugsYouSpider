# Gnumbat Network — Generitype & the Provenance Registry

How the Montréal instance stays one node in a network of autonomous
communities instead of becoming a platform — and how the parts of it that
get reused elsewhere stay traceable without anyone running telemetry.

This extends two things already committed elsewhere in this repo: the
"réseau de communautés autonomes" described in `GRANT.md` (a network of
self-hosted instances, not one central database), and the "Decentralization
vs. carbon" section of `SUSTAINABILITY.md` (AGPL + forkable code already
gets you the meaningful part of decentralized ownership — no IPFS tax
required). This doc makes that concrete: what "Generitype" actually is as a
codebase, how a provenance registry tracks who harvested what, and how a
node visualization lets anyone explore the resulting network.


**Scope note:** everything below is about *code* lineage — which parts of this codebase ended up where, across independently-run instances. For *runtime-created* artifacts — a Model a DJ trained, a Tool someone built, a Branch published outside git — see `docs/platform/ARTIFACT_NETWORK.md`, which reuses this doc's manifest shape (`id`/`origin`/`license`/`version`/`parent`) and its "registry as phone book, not a database" principle, generalized from the working `src/network/carnet-daemon.js` prototype below.

---

## The shape of the network

One clarification worth stating plainly, because "decentralized network"
gets read two different ways: this is not a P2P mesh where instances talk
to each other live. It's a constellation — independently hosted,
independently operated instances that happen to share a common ancestor
codebase and, optionally, list themselves in a shared, human-reviewed
registry. No instance can take another offline. No instance has to
participate. The "network" is closer to a phone book than a grid.

```
        Generitype (template repo, AGPL-3.0)
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
  Gnumbat (Montréal) instance-B    instance-C
  full stack     scraper-only   taxonomy-only
      │
   registers itself in the
   network registry (opt-in)
```

Montréal (Gnumbat) is the reference implementation, not the authority. It's
the instance you maintain because it's the one whose geography (and whose
Spiderbot — the event-crawler, see `src/backend/event-crawler/`) you
actually run. Other communities fork, gut what they don't want, and either
register or don't. Both are fine outcomes — `GRANT.md` already says this:
"une instance pourrait conserver le crawler mais abandonner l'instrument de
remixing."

---

## Within one instance: the regional carnet

The registry above (and `/network`) is how Montréal *finds and links to*
Tokyo's instance — a phone-book entry, not a data feed. That's deliberately
thin: per `GRANT.md`, the project isn't trying to gather every scene into
one database. But "connect to Tokyo's system" and "gather everyone into one
database" aren't the same request, and the phone-book model alone doesn't
fully answer the first one either — clicking through to Tokyo's site works
for a person, but there's no way to actually *hold* a copy of what Tokyo
publishes, and Tokyo's own community still depends on Tokyo's one server
staying up.

The fix sits one level *below* the network, inside a single instance, not
across instances: each region keeps its own append-only, publicly-readable
log (a Hypercore) of the public data it produces — for Montréal, that
starts with `all_events.json` from `src/backend/event-crawler/`. Anyone in
the Montréal community can run a mirror and hold a full replica of
*Montréal's own* carnet; several contributors can each keep their own
signed sub-log (one covers Plateau venues, another the East End, say),
merged locally into a single Montréal-scoped view via Autobase regardless
of who's contributing. Tokyo does the exact same thing, entirely
separately, with its own carnet and its own discovery key — the two never
replicate into each other. No instance's carnet ever contains another
instance's data; only the small registry entry links them.

That registry entry is also where "connect to Tokyo's system" becomes real
instead of just a link: alongside its URL, an instance's registry listing
can carry its carnet's public discovery key. Looking Tokyo up gets you
both — visit their site like today, or point your own machine at their
discovery key and hold a live, read-only mirror of Tokyo's own public
data, without the two carnets ever merging into one and without needing
Tokyo's server to answer your request every time.

Scoped strictly to *content* (events today; genres/tags are the likely
next candidate, see `SUSTAINABILITY.md`'s decentralization note this
extends) — not to code. Seeing which parts of Tokyo's own instance trace
back to Montréal's codebase (its "DNA") is a different, already-designed
mechanism: the provenance registry and `.provenance.yml` manifests below,
which only exist once a community actually forks Generitype and chooses to
register. A carnet is content a live instance produces; provenance is
lineage of the code itself, tracked whether or not that instance ever
contributes a byte of data anywhere.

**Why this doesn't reopen the carbon question `SUSTAINABILITY.md` raises
against P2P replication:** that section's point is about a *global* mesh —
every node holding everyone's data, worldwide, all the time. A per-region
carnet bounds replication to people actually interested in one region's
data, replicating only that region's data — Montréal's own event listings,
not the world's. That's a small, bounded version of the same duplication
cost, not the unbounded one the section warns about; see the note added
there.

---

## Two living trees, one visualization

The grant timeline already commits to an "arbre phylogénétique des genres"
— a taxonomy tree that grows as communities classify their own music.
That's a genealogy of *culture*. What you're describing now — a registry
that logs what gets harvested and by whom — is a genealogy of *code*.
They're the same kind of structure pointed at two different things, and
they can share one visualization.

| | Taxonomy tree (already planned) | Provenance registry (new) |
|---|---|---|
| Tracks | genres, sub-genres, how communities classify sound | code parts, skins, protocols — who forked/reused what |
| Grows from | bakes, user-defined categories | instances registering themselves + what they kept |
| Lives in | `gnumbat.db` / taxonomy tables | a separate, lightweight registry repo (below) |
| Answers | "how did this genre come to exist, and where did it split?" | "where did this piece of code end up, and what's it part of now?" |

Both render through the same `/network` page: a node graph, force-directed,
where you can pan between "genre space" and "code space" or view them
overlaid. One visualization, two data sources.

---

## Splitting the repo: Generitype vs. the Montréal instance

Right now everything lives in one repo. To make "fork the Generitype, run
your own instance" actually mean something, the repo needs a seam between
what's generic and what's Montréal-specific. You don't have to do this
today — the split can happen gradually, module by module — but it's worth
deciding the target shape now so new code lands on the right side of the
line from here on.

| Generitype (core, generic) | Gnumbat (this instance) |
|---|---|
| Analysis pipeline (Demucs/FluCoMa/madmom wiring) | Montréal skins, brand assets, the spider mascot |
| Tipping protocol + split equation (`split.js`) | `venues.go`'s 17 hardcoded Montréal venues |
| Event-crawler framework (`discover*.go`, `ollama.go`) | Gnumbat's own taste model / trained bakes |
| Taxonomy engine (schema, not the data) | The "Gnumbat" name/identity |
| Provenance registry schema + `/network` viz | `eatbugsyouspider.com`/`.org` |
| LINK protocol, TUI framework | Montréal-specific temperature/climate data source |

A community that wants "just the spider" clones Generitype, deletes
everything under the right-hand column, drops in their own venues list and
skin, and they're running. `SUSTAINABILITY.md`'s "fancy-skin split" idea
(base site loads for everyone, a skin is an opt-in CSS/JS bundle) is the
same pattern one level up — apply it to the whole instance, not just the
stylesheet.

---

## Trust without a center: the "trusted download" problem

You flagged the real risk correctly: a codebase that spreads by forking
can spread a poisoned fork just as easily as a clean one. Two things are
worth separating here, because they need different fixes.

**"Is this code what it claims to be?"** — solved by things you already
half have. AGPL-3.0 means every fork must ship its source; a binary with
no source next to it is already non-compliant and a signal to distrust it.
On top of that: sign release tags with your GPG key, publish the
fingerprint somewhere static (your own site, not just GitHub), and put a
one-paragraph `SECURITY.md` in the repo root telling people how to verify
a clone actually traces back to a signed commit
(`git log --show-signature`). Don't ship a packaged installer people
double-click — "clone and build from source" is slower but it's also the
only version of "trusted" that doesn't depend on trusting a binary blob.

**"Is this instance's *code* safe, separate from whether it's
*authentic*?"** — a signed fork of Generitype can still be an authentic
fork that introduces a real vulnerability, intentionally or not. That's
not solvable by signatures; it's solvable by review culture, same as any
other open-source project. Worth being honest that "decentralized and
unkillable" trades away a central authority that could vet every fork —
that's the deal, not a bug to patch.

Montréal's practical role here: be the instance other communities check
against when something looks off, not because you have authority, but
because you're the fork with the longest history and (once the registry
exists) the most other instances vouching for having safely built from it.

---

## The provenance registry: concrete shape

The instinct to "tag code sections to observe how people keep or toss
them" is worth pausing on, because as literally described — telemetry
that reports back to you when someone uses or discards a piece of code —
that's exactly the kind of central server you said you don't want to
build, and it would need consent infrastructure most forks won't want to
carry. The registry below gets you almost everything you actually want
(visible lineage, a network people can explore) without any instance
phoning home.

**Per-part manifest.** Any harvestable unit — a module, a skin, the split
equation, a taxonomy branch — carries a small manifest file next to it:

```yaml
# split.js.provenance.yml
id: tipping-split-equation
origin: gnumbat-montreal
license: AGPL-3.0
version: "1.2"
parent: null          # null = this is where it originated
description: L0-L4 transformation-level split, see docs/protocol/SPLIT_EQUATION.md
```

When another instance forks and keeps a part, they don't have to do
anything for the manifest to stay accurate — `parent` and `origin` are
already correct by inheritance. What makes it *appear in the network* is
opt-in: a `network.yml` at the root of their instance, filled in once,
that lists which parts they kept and a URL for their instance.

**A federated registry, not a live index.** The registry itself is a
second, small git repo (`gnumbat-network` or similar) that any instance can
open a pull request against to list itself — name, URL, city/scene, which
Generitype parts it's running, and its own `origin` chain if it forked
from something other than Montréal directly. This is the same trust model
as an "awesome-list" or Homebrew's `homebrew-core`: cheap to host,
reviewable by a human before merge (catches spam and impersonation), fully
offline-capable, and nobody's server has to stay up for the network to
exist. An instance that goes offline just stops getting new merges; its
history stays in the registry's git log either way.

**What the node visualization actually renders.** A static build step
reads the registry repo's `network.yml` files plus each instance's own
`.provenance.yml` manifests (fetched at build time, not runtime — no live
scraping of other people's servers) and produces the graph data the
`/network` page renders: nodes = instances + parts, edges = `parent`
links. Rebuild it on a schedule (daily, weekly) or on registry PR merge,
not on every visit.

---

## Where this lands relative to the grant timeline

`GRANT.md`'s échéancier already allocates Sept 2026–Jan 2027 to "Raffinage
de l'infrastructure web et communautaire," which is where chat, the
taxonomy tree, and the autonomous radio are scoped. The network/registry
layer above fits as an extension of that same window rather than separate
scope:

| When | What |
|---|---|
| Now (Pd migration window) | No network work yet — keep shipping on the single-repo structure |
| Community-infra window (the grant's Sept–Jan phase) | Draw the Generitype/Gnumbat seam in the repo (table above) as you touch each module anyway; write the `.provenance.yml` schema |
| Launch window (Jan–Mar 2027) | Stand up the `gnumbat-network` registry repo, build the `/network` node visualization, write the fork guide (`FORKING.md`) other communities actually follow |

None of this needs to block the instrument or the Pd migration — it's
additive, and the only genuinely new infrastructure is one small git repo
for the registry.

---

## Parked for later

You raised four other open questions in the same breath as this one —
chat ephemerality, whether to add a forum, login security, image sharing,
and radio copyright exposure. Those are real and worth a proper pass, but
they're a different kind of decision (product/legal, not architecture) and
you said yourself you'll know what matters once people are testing it.
Flagging them here so they don't get lost, worth their own doc once you're
ready:

- Ephemeral vs. persistent chat, and whether a forum belongs alongside it
- How much identity verification the login actually needs
- Whether/how users share images, and what that costs to moderate and store
- Copyright exposure on the radio's remixed/generated streams
