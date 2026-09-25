#!/usr/bin/env node
'use strict'

// lineage.js -- seed/branch role, lineage-root ("seedId") resolution, and
// replanting (a branch becoming the new seed of its own lineage).
//
// The manifest's own `parent` field (manifest.js) already expresses "this
// artifact is a fork of that one" and is signed/immutable -- exactly
// right for provenance, wrong for anything that changes over time. This
// file adds the mutable half, stored on the registry entry (registry.js):
// `role` ('seed'|'branch'), `seedId` (the hash of the lineage's original
// root artifact -- constant for every node in one lineage, branch or
// seed), and `lineageStatus` ('seed'|'current-seed'|'previous-seed'|
// 'ancestor'|'branch'). None of this ever rewrites a manifest or deletes
// an artifact -- see replant() below.
//
// Deliberately NOT implemented here: any automatic policy for WHEN a
// branch should replant as the new seed. See evaluateSuccession() --
// this only gives future code a place to plug a policy in, per
// docs/platform/ARTIFACT_NETWORK.md's explicit instruction not to invent
// a hardcoded popularity rule (e.g. "if upvotes > seed: replace seed").

const fs = require('fs')
const path = require('path')
const registry = require('./registry')
const { NETWORK_DIR } = require('./identity')

const LINEAGE_DIR = path.join(NETWORK_DIR, 'lineage')

// manifest.id is "sha256:<hash>" (manifest.js); parent is the same shape.
// Every lookup in this file works in bare hashes (what registry.js keys
// on), so this strips the prefix once, in one place.
function bareHash(id) {
  if (!id) return null
  return id.startsWith('sha256:') ? id.slice('sha256:'.length) : id
}

function parentHash(entry) {
  return entry && entry.manifest ? bareHash(entry.manifest.parent) : null
}

function roleOf(entry) {
  return parentHash(entry) ? 'branch' : 'seed'
}

// seedIdFor -- walk manifest.parent pointers up to the root. Guards
// against a cyclic/broken chain (shouldn't happen -- parent is set once
// at publish and never rewritten -- but a hand-edited or corrupted
// registry file walking forever would otherwise hang any caller) with a
// visited-set, same defensive idiom panel.html's own flattenTree() uses
// for its client-side forest.
function seedIdFor(hash) {
  const seen = new Set()
  let current = hash
  let last = hash
  while (current && !seen.has(current)) {
    seen.add(current)
    const entry = registry.get(current)
    if (!entry) break
    last = current
    const p = parentHash(entry)
    if (!p) return current // this IS the root
    current = p
  }
  return last
}

function lineageFilePath(seedId) {
  return path.join(LINEAGE_DIR, `${seedId}.json`)
}

function loadLineageHistory(seedId) {
  try {
    return JSON.parse(fs.readFileSync(lineageFilePath(seedId), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return { seedId, currentSeedHash: seedId, history: [] }
    throw err
  }
}

function saveLineageHistory(record) {
  fs.mkdirSync(LINEAGE_DIR, { recursive: true })
  fs.writeFileSync(lineageFilePath(record.seedId), JSON.stringify(record, null, 2))
  return record
}

// syncRoleAndSeed -- stamps role+seedId+lineageStatus onto a freshly
// registered artifact. Called by publish.js right after registry.register().
// lineageStatus here is only ever the DEFAULT for a brand-new node
// ('seed' for a root, 'branch' for anything with a parent) -- replant()
// below is the only thing that ever moves a node to 'current-seed'/
// 'previous-seed'/'ancestor'.
function syncRoleAndSeed(hash) {
  const entry = registry.get(hash)
  if (!entry) throw new Error(`unknown artifact ${hash}`)
  const role = roleOf(entry)
  const seedId = seedIdFor(hash)
  const lineage = loadLineageHistory(seedId)
  const lineageStatus = role === 'seed'
    ? (lineage.currentSeedHash === hash ? 'current-seed' : (lineage.currentSeedHash ? 'previous-seed' : 'seed'))
    : 'branch'
  return registry.setLineage(hash, { role, seedId, lineageStatus })
}

// replant -- the branch -> new-seed transition ("replanting", not
// replacement/deletion -- see the spec's own terminology). Never touches
// manifest.parent (immutable/signed) and never deletes the old seed's
// registry entry or bytes: it only relabels lineageStatus on both ends
// and appends one line to this lineage's append-only history file, so
// the OLD seed stays fully discoverable (as 'previous-seed'/'ancestor')
// for as long as the P2P network actually still has it -- registry.js's
// own availability()/modelCard() is what later decides whether it's
// still USABLE, completely independent of this label.
function replant(hash, { reason = null, actor = null } = {}) {
  const branchEntry = registry.get(hash)
  if (!branchEntry) throw new Error(`unknown artifact ${hash}`)
  const seedId = branchEntry.seedId || seedIdFor(hash)
  if (hash === seedId) {
    throw new Error(`${hash} is already this lineage's root -- nothing to replant`)
  }
  const lineage = loadLineageHistory(seedId)
  const fromHash = lineage.currentSeedHash || seedId

  // The outgoing current-seed becomes 'previous-seed' (still part of the
  // network for as long as any peer actually has it -- see modelCard()'s
  // own network/usability split); every OTHER past seed already on file
  // steps down further, to 'ancestor', so there is always at most one
  // 'previous-seed' -- the immediately-preceding one -- and the rest read
  // as older history, not as a second "the seed before this" claim.
  const priorEntry = registry.get(fromHash)
  if (priorEntry) {
    for (const evt of lineage.history) {
      if (evt.fromHash && evt.fromHash !== fromHash) {
        const olderEntry = registry.get(evt.fromHash)
        if (olderEntry && olderEntry.lineageStatus === 'previous-seed') {
          registry.setLineage(evt.fromHash, { lineageStatus: 'ancestor' })
        }
      }
    }
    registry.setLineage(fromHash, { lineageStatus: fromHash === seedId ? 'previous-seed' : 'ancestor' })
  }

  registry.setLineage(hash, { role: branchEntry.role, seedId, lineageStatus: 'current-seed' })

  lineage.currentSeedHash = hash
  lineage.history.push({ at: new Date().toISOString(), actor, reason, fromHash, toHash: hash })
  saveLineageHistory(lineage)

  return { seedId, previousSeedHash: fromHash, currentSeedHash: hash }
}

// evaluateSuccession -- deliberately inert without a policy. `policy` is
// a plain function (candidates, context) => hash|null that the CALLER
// supplies; this file ships none. candidates are every branch belonging
// to `seedId` (registry.list() filtered by seedId, role==='branch');
// context carries {votesByHash, availabilityByHash} so a future policy
// has real network data to reason from, per the instruction that any
// eventual succession rule must be based on meaningful network data, not
// "newest branch wins" or a bare vote-count threshold invented here.
function evaluateSuccession(seedId, { policy } = {}) {
  const candidates = registry.list().filter((e) => e.seedId === seedId && e.lineageStatus === 'branch')
  if (typeof policy !== 'function') {
    return { recommendation: null, reason: 'no succession policy configured', candidates: candidates.map((c) => c.manifest.hash) }
  }
  const votesByHash = {}
  const availabilityByHash = {}
  for (const c of candidates) {
    votesByHash[c.manifest.hash] = c.votes
    availabilityByHash[c.manifest.hash] = registry.availability(c.manifest.hash)
  }
  const recommendation = policy(candidates, { votesByHash, availabilityByHash }) || null
  return { recommendation, reason: recommendation ? 'policy recommendation' : 'policy declined to recommend', candidates: candidates.map((c) => c.manifest.hash) }
}

module.exports = { bareHash, roleOf, seedIdFor, syncRoleAndSeed, replant, evaluateSuccession, loadLineageHistory, LINEAGE_DIR }
