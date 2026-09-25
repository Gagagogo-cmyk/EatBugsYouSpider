#!/usr/bin/env node
'use strict'

// registry.js -- the local "phone book": one small JSON file per artifact
// under data/network/registry/<hash>.json (manifest + known locations +
// availability), plus data/network/peers.json (node pubkey -> last-seen).
// Deliberately not a database -- same shape/spirit as carnet-daemon.js's
// own seen.json, and matches docs/platform/NETWORK.md's explicit framing
// of a registry as "a phone book, not a giant centralized database": the
// actual artifact bytes live in the local Corestore (swarm.js) or the
// server's cold storage, never inside these files.
//
// MODEL CARD FIELDS -- this file also owns the *mutable* side of a
// Model/Tool/Branch's story: the manifest (manifest.js) is signed and
// immutable (who published which exact bytes, and its parent, forever),
// but role/lineageStatus/creators/editors/trainingState/pickleScan/votes
// all change over time and were never meant to be part of a signed
// payload -- they live here instead, one JSON file per hash, same as
// locations/activated already do. See lineage.js (role/seedId/replant),
// votes.js (the vote ledger this file only caches a tally of), and
// quarantine.js (persists its scan() result here instead of throwing it
// away once process()/publish() return). docs/platform/ARTIFACT_NETWORK.md
// documents the shape end to end.

const fs = require('fs')
const path = require('path')
const { NETWORK_DIR } = require('./identity')

const REGISTRY_DIR = path.join(NETWORK_DIR, 'registry')
const PEERS_FILE = path.join(NETWORK_DIR, 'peers.json')

// How long an editor stays "active" rather than just "has edited this
// before" -- same "recent within a window" idea registry.availability()
// already uses for peers (ONLINE_WINDOW_MS, below), just a much longer
// window since a model's editing cadence is days/weeks, not seconds.
const ACTIVE_EDITOR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function entryPath(hash) {
  return path.join(REGISTRY_DIR, `${hash}.json`)
}

// stripHashPrefix -- manifest.parent is "sha256:<hash>" or null
// (manifest.js). modelCard() reads it back out in bare-hash form for the
// UI's own tree logic, same convention lineage.js's own bareHash() uses
// -- duplicated here in one line rather than requiring lineage.js (which
// itself requires this file) just for this.
function stripHashPrefix(id) {
  if (!id) return null
  return id.startsWith('sha256:') ? id.slice('sha256:'.length) : id
}

// withDefaults -- every field this update adds is optional/backfilled
// here on READ, same "don't migrate, just default on the way out"
// convention panel.html's own migrateModels() already uses for its
// localStorage rows. An entry written by a build of this file that
// predates model cards entirely still loads and works; it just reads as
// "no metadata recorded yet" for the new fields instead of throwing or
// needing a migration pass.
function withDefaults(entry) {
  if (!entry) return entry
  if (!entry.role) entry.role = entry.manifest && entry.manifest.parent ? 'branch' : 'seed'
  if (entry.seedId === undefined) entry.seedId = null
  if (!entry.lineageStatus) entry.lineageStatus = entry.role === 'seed' ? 'seed' : 'branch'
  if (entry.integrateFollowingBranches === undefined) entry.integrateFollowingBranches = false
  // name -- deliberately NOT part of the signed manifest: a model gets
  // renamed all the time (panel.html's own ^R), and the manifest exists
  // precisely to be the thing that ISN'T mutable. Defaults from the
  // manifest's own draft content the first time an entry is seen, purely
  // as a starting point -- every rename after that only ever touches
  // this field via setName().
  if (entry.name === undefined) entry.name = (entry.manifest && entry.manifest.displayName) || null
  // parentId2 -- second lineage for a hybrid (panel.html's
  // hybridizeModels()). Kept separate from manifest.parent (the primary,
  // signed lineage pointer) rather than overloading a single field to
  // carry two parents, or extending manifest.js's signed field set for a
  // v1 feature that's still purely a display/grouping concern here.
  if (entry.parentId2 === undefined) entry.parentId2 = null
  // bakes -- panel.html's own per-model bake brackets, unchanged shape
  // (each is {id, parentId, ...}, exactly what that file already
  // produces) -- just persisted here now instead of living only in
  // localStorage. Opaque to this file on purpose: bakes are explicitly
  // out of scope for this pass beyond "make them durable."
  if (!Array.isArray(entry.bakes)) entry.bakes = []
  if (!Array.isArray(entry.creators)) {
    // Backfill from the old singular manifest.creator, if any, rather
    // than starting every pre-existing artifact at a bare empty list.
    const c = entry.manifest && entry.manifest.creator
    entry.creators = c ? [{ name: c, nodeId: entry.manifest.origin || null }] : []
  }
  if (!Array.isArray(entry.editors)) entry.editors = []
  if (!entry.trainingState) entry.trainingState = 'untrained'
  // releaseState -- consumer-app lifecycle (spec: DEVELOPMENT -> TRAINING ->
  // TESTING -> READY -> RELEASED -> EVOLVING), deliberately separate from
  // trainingState above ("has this been trained at all" vs "is this allowed
  // in front of listeners yet"). Mirrored server-side as artifacts.release_state
  // (src/backend/db/schema.sql) -- only 'released'/'evolving' are ever
  // consumer-eligible (ModelService's GET /models/released).
  if (!entry.releaseState) entry.releaseState = 'development'
  if (!entry.pickleScan) entry.pickleScan = { status: 'not-scanned', scannedAt: null, engine: null, scannerVersion: null }
  if (!entry.votes) entry.votes = { up: 0, down: 0 }
  return entry
}

function get(hash) {
  try {
    return withDefaults(JSON.parse(fs.readFileSync(entryPath(hash), 'utf8')))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

function list() {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true })
  return fs.readdirSync(REGISTRY_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => withDefaults(JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), 'utf8'))))
}

function write(hash, entry) {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true })
  fs.writeFileSync(entryPath(hash), JSON.stringify(entry, null, 2))
  return entry
}

// Register a manifest (does NOT mark it activated -- see quarantine.js).
function register(manifest) {
  const existing = get(manifest.hash)
  const entry = existing || withDefaults({
    manifest,
    locations: [],
    activated: false,
    registered_at: new Date().toISOString()
  })
  entry.manifest = manifest
  // A re-register (e.g. re-publish of bytes already known) must not
  // clobber role/seedId/lineageStatus that lineage.js may have already
  // set independently of the manifest's own (immutable) parent pointer
  // -- withDefaults() above only fills these in when truly absent, so
  // this is safe to call repeatedly.
  return write(manifest.hash, entry)
}

// Record that some node/server/peer currently holds this artifact.
function noteLocation(hash, location) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash} -- register() its manifest first`)
  const idx = entry.locations.findIndex((l) => l.kind === location.kind && l.id === location.id)
  const seen = { ...location, last_seen: new Date().toISOString() }
  if (idx === -1) entry.locations.push(seen)
  else entry.locations[idx] = seen
  return write(hash, entry)
}

function setActivated(hash, activated) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.activated = !!activated
  return write(hash, entry)
}

// forget -- LOCAL removal only: this node erases its own registry entry
// (and, best-effort, its own local store copy) for a hash. Deliberately
// distinct from "the artifact no longer exists anywhere" -- if any other
// peer still has it, it stays fully discoverable and fetchable through
// THEM; this only ever affects what THIS node's own phone book/store
// remembers. models.js's deleteModel() is the only caller (panel.html's
// explicit ^D), never anything vote- or popularity-driven.
function forget(hash) {
  const entry = get(hash)
  if (!entry) return false
  try { fs.rmSync(entryPath(hash), { force: true }) } catch (err) { /* best-effort */ }
  try {
    const quarantine = require('./quarantine')
    const storePath = quarantine.resolvedStorePath(hash)
    fs.rmSync(storePath, { force: true })
  } catch (err) { /* best-effort -- may never have had bytes locally at all */ }
  return true
}

// --- Model-card mutators -----------------------------------------------
// Each of these loads, mutates one concern, and writes back -- same tiny
// read/mutate/write shape as setActivated() above, so a caller (cli.js,
// gui_hub_bridge.js) never has to know the on-disk JSON shape itself.

function setLineage(hash, { role, seedId, lineageStatus } = {}) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  if (role !== undefined) entry.role = role
  if (seedId !== undefined) entry.seedId = seedId
  if (lineageStatus !== undefined) entry.lineageStatus = lineageStatus
  return write(hash, entry)
}

function setIntegrateFollowingBranches(hash, enabled) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  if (entry.role !== 'seed' && entry.lineageStatus !== 'seed' && entry.lineageStatus !== 'current-seed') {
    throw new Error(`${hash} is not a seed/current-seed -- "integrate following branches" is a seed-only option`)
  }
  entry.integrateFollowingBranches = !!enabled
  return write(hash, entry)
}

function setCreators(hash, creators) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.creators = Array.isArray(creators) ? creators : []
  return write(hash, entry)
}

function setName(hash, name) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.name = name
  return write(hash, entry)
}

function setSecondParent(hash, parentId2) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.parentId2 = parentId2 || null
  return write(hash, entry)
}

// setBakes -- whole-array replace, matching how panel.html already
// treats a model's bakes today (it mutates its own in-memory array, then
// persists the lot in one shot via saveModels()) -- no need for
// finer-grained add/update/delete here when the client already hands
// over the complete, correct array every time.
function setBakes(hash, bakes) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.bakes = Array.isArray(bakes) ? bakes : []
  return write(hash, entry)
}

// addEditor -- distinct from creators: anyone who has touched (renamed,
// baked, re-trained) a model after its creation, so the UI can show
// "created by X" and "active editors: Y, Z" as two different lists
// rather than one. Re-touching by the same editor (matched by nodeId,
// falling back to name) updates lastEditAt in place instead of growing
// duplicate rows.
function addEditor(hash, { name, nodeId } = {}) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  const now = new Date().toISOString()
  const idx = entry.editors.findIndex((e) => (nodeId && e.nodeId === nodeId) || (!nodeId && e.name === name))
  if (idx === -1) entry.editors.push({ name: name || null, nodeId: nodeId || null, lastEditAt: now })
  else entry.editors[idx] = { ...entry.editors[idx], name: name || entry.editors[idx].name, lastEditAt: now }
  return write(hash, entry)
}

// activeEditors -- editors touched within ACTIVE_EDITOR_WINDOW_MS, vs.
// every editor a model has ever had. Mirrors the "online within window"
// vs. "every location ever seen" split availability() already draws for
// peers, applied to people instead of nodes.
function activeEditors(entry) {
  const now = Date.now()
  return (entry.editors || []).filter((e) => now - Date.parse(e.lastEditAt) < ACTIVE_EDITOR_WINDOW_MS)
}

function setTrainingState(hash, state) {
  const VALID = new Set(['untrained', 'training', 'ready', 'failed'])
  if (!VALID.has(state)) throw new Error(`invalid training state: ${state} (expected one of ${[...VALID].join(', ')})`)
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.trainingState = state
  return write(hash, entry)
}

// setReleaseState -- the consumer-app lifecycle gate (see withDefaults()
// above). A curator action in the desktop hub, never automatic. Setting
// 'released' for the first time also stamps releasedAt (kept even if the
// state later moves on to 'evolving', so "when was this first released"
// stays answerable).
function setReleaseState(hash, state) {
  const VALID = new Set(['development', 'training', 'testing', 'ready', 'released', 'evolving'])
  if (!VALID.has(state)) throw new Error(`invalid release state: ${state} (expected one of ${[...VALID].join(', ')})`)
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.releaseState = state
  if (state === 'released' && !entry.releasedAt) entry.releasedAt = new Date().toISOString()
  return write(hash, entry)
}

// setPickleScanResult -- called by quarantine.js right after scan() runs
// (on every download AND on publish's own pre-publish self-scan), so the
// result survives past that one call instead of only living in the
// return value. status is one of:
//   'not-applicable' -- file type can't carry a pickle payload (e.g. the
//                       taste model's plain .json) -- scanning was never
//                       needed, distinct from "not scanned yet".
//   'scanned-clean'  -- ran, found nothing disallowed.
//   'flagged'        -- ran, found a disallowed opcode/global -- refused.
//   'scan-failed'    -- the scanner itself errored (see runPickleScan()).
//   'not-scanned'    -- the withDefaults() default -- recorded but never
//                       actually run through scan() yet.
function setPickleScanResult(hash, { status, engine, scannerVersion } = {}) {
  const VALID = new Set(['not-applicable', 'scanned-clean', 'flagged', 'scan-failed', 'not-scanned'])
  if (!VALID.has(status)) throw new Error(`invalid pickleScan status: ${status}`)
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.pickleScan = { status, scannedAt: new Date().toISOString(), engine: engine || null, scannerVersion: scannerVersion || null }
  return write(hash, entry)
}

// setVoteTally -- votes.js's castVote() is the real source of truth (the
// per-voter ledger); this just caches the recomputed {up,down} here so
// every other reader (modelCard(), the hub) gets it for free without
// also having to know votes.js's own ledger file layout.
function setVoteTally(hash, tally) {
  const entry = get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  entry.votes = { up: tally.up || 0, down: tally.down || 0 }
  return write(hash, entry)
}

// Availability summary matching the spec: replica counts, last-seen, etc.
function availability(hash) {
  const entry = get(hash)
  if (!entry) return null
  const now = Date.now()
  const ONLINE_WINDOW_MS = 5 * 60 * 1000
  const online = entry.locations.filter((l) => now - Date.parse(l.last_seen) < ONLINE_WINDOW_MS)
  return {
    hash,
    dedicated_replicas: entry.locations.filter((l) => l.kind === 'server' || l.kind === 'node').length,
    online_peers: online.length,
    last_seen: entry.locations.reduce((max, l) => (!max || l.last_seen > max ? l.last_seen : max), null),
    currently_available: online.length > 0
  }
}

// modelCard -- the one composed read the UI (via gui_hub_bridge.js) is
// meant to actually call, rather than every caller re-assembling
// manifest + lineage + votes + availability by hand. Deliberately keeps
// "historical" (this metadata exists / was once published), "network"
// (does a peer currently have the actual bytes), and "usability" (is a
// verified, quarantine-passed, activated copy sitting in THIS node's own
// store right now) as three separate sub-objects -- see
// docs/platform/ARTIFACT_NETWORK.md and this repo's model-network spec
// for why those three must never collapse into one boolean.
// quarantine.js is require()'d lazily, inside the function, rather than
// at module load time: quarantine.js requires THIS module at its own top
// level (for registry.register/setActivated), so a top-level require
// here would be circular. Calling it lazily (after both modules have
// finished loading at least once) sidesteps that entirely.
function modelCard(hash) {
  const entry = get(hash)
  if (!entry) return null
  const quarantine = require('./quarantine')
  const net = availability(hash)
  let usability = { locallyPresent: false, quarantinePassed: false, activated: false }
  try {
    const storePath = quarantine.resolvedStorePath(hash)
    usability = {
      locallyPresent: fs.existsSync(storePath),
      quarantinePassed: fs.existsSync(storePath), // reaching STORE_DIR at all means process() already verified it
      activated: quarantine.isActivated(hash)
    }
  } catch (err) { /* leave usability at its conservative false defaults */ }
  return {
    hash,
    manifest: entry.manifest,
    role: entry.role,
    seedId: entry.seedId,
    lineageStatus: entry.lineageStatus,
    integrateFollowingBranches: entry.integrateFollowingBranches,
    name: entry.name,
    parentId: stripHashPrefix(entry.manifest && entry.manifest.parent),
    parentId2: entry.parentId2,
    bakes: entry.bakes,
    creators: entry.creators,
    editors: entry.editors,
    activeEditors: activeEditors(entry),
    trainingState: entry.trainingState,
    releaseState: entry.releaseState,
    releasedAt: entry.releasedAt || null,
    pickleScan: entry.pickleScan,
    votes: entry.votes,
    historical: {
      recorded: true,
      registeredAt: entry.registered_at,
      createdAt: entry.manifest && entry.manifest.created_at
    },
    network: net || { hash, dedicated_replicas: 0, online_peers: 0, last_seen: null, currently_available: false },
    usability: {
      // A model is only ever "usable" if it's BOTH locally present/
      // verified AND explicitly activated -- never inferred from
      // network availability alone (requirement: don't present an
      // unavailable/unverified model as usable).
      ...usability,
      usable: usability.locallyPresent && usability.activated
    }
  }
}

function loadPeers() {
  try {
    return JSON.parse(fs.readFileSync(PEERS_FILE, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

function notePeer(pubKeyHex, info) {
  const peers = loadPeers()
  peers[pubKeyHex] = { ...(peers[pubKeyHex] || {}), ...info, last_seen: new Date().toISOString() }
  fs.mkdirSync(NETWORK_DIR, { recursive: true })
  fs.writeFileSync(PEERS_FILE, JSON.stringify(peers, null, 2))
  return peers[pubKeyHex]
}

module.exports = {
  get, list, register, noteLocation, setActivated, availability, loadPeers, notePeer, REGISTRY_DIR,
  setLineage, setIntegrateFollowingBranches, setCreators, addEditor, activeEditors,
  setTrainingState, setReleaseState, setPickleScanResult, setVoteTally, modelCard, ACTIVE_EDITOR_WINDOW_MS,
  setName, setSecondParent, setBakes, forget
}
