#!/usr/bin/env node
'use strict'

// models.js -- the orchestration layer gui_hub_bridge.js's `models` target
// (panel.html's model browser) actually calls. Everything genuinely
// reusable already lives in registry.js/lineage.js/votes.js/publish.js;
// this file only adds the handful of things specific to "a DJ's own
// evolving model row in a local tool" that don't belong in the general
// P2P-artifact layer:
//
//   - createModel(): a brand-new seed/branch/hybrid starts as an UNTRAINED
//     row with no real trained bytes yet. Rather than inventing a second,
//     parallel "draft" storage system, this publishes a tiny JSON
//     declaration of the model (name + creation time) through the exact
//     same publish() pipeline every other artifact goes through -- real
//     hash, real signature, real (trivially "not-applicable") PickleScan
//     status, real registry entry. That declaration IS legitimate content
//     to hash and network-replicate on its own (this model's own
//     existence claim), same as a git commit hashes its own metadata, not
//     some deeper payload. When real trained weights exist later, they
//     become their own artifact (parent-linked); this file's job stops at
//     giving every model a stable, real identity from the moment it's
//     created in the UI.
//   - renameModel()/setBakes(): the mutable, non-manifest fields
//     (registry.setName/setBakes) plus the matching addEditor() touch,
//     mirroring panel.html's own touchModel() convention.
//   - deleteModel(): LOCAL forget, cascading through children exactly the
//     way panel.html's own deleteModel() already does (hybrid survives,
//     drops the removed lineage) -- reimplemented here now that the hub,
//     not the browser tab, owns MODELS.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { publish } = require('./publish')
const registry = require('./registry')
const lineage = require('./lineage')
const votes = require('./votes')

function draftFilePath(name) {
  const safe = String(name || 'untitled').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40)
  return path.join(os.tmpdir(), `gnumbat-model-draft-${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
}

// createModel -- role is implied by whether parentId is set (branchModel())
// or not (newModel()); parentId2 makes it a hybrid (hybridizeModels()).
async function createModel({ name, parentId, parentId2, creator } = {}) {
  const tmpFile = draftFilePath(name)
  fs.writeFileSync(tmpFile, JSON.stringify({ kind: 'gnumbat-model-draft', name, createdAt: new Date().toISOString() }, null, 2))
  try {
    const { hash } = await publish(tmpFile, {
      type: 'model',
      version: '0.0-draft',
      parent: parentId ? `sha256:${parentId}` : null,
      creator: creator || null,
      // seed:false -- see publish.js's own comment: an untrained draft
      // has nothing worth broadcasting to the P2P swarm yet. Still gets
      // a real hash/manifest/registry entry either way.
      seed: false
    })
    registry.setName(hash, name || null)
    if (parentId2) registry.setSecondParent(hash, parentId2)
    return registry.modelCard(hash)
  } finally {
    try { fs.unlinkSync(tmpFile) } catch (err) { /* best-effort scratch cleanup */ }
  }
}

function renameModel(hash, name, { editorName, editorNodeId } = {}) {
  registry.setName(hash, name)
  registry.addEditor(hash, { name: editorName, nodeId: editorNodeId })
  return registry.modelCard(hash)
}

function setBakes(hash, bakes, { editorName, editorNodeId } = {}) {
  registry.setBakes(hash, bakes)
  registry.addEditor(hash, { name: editorName, nodeId: editorNodeId })
  return registry.modelCard(hash)
}

function touchEdit(hash, { editorName, editorNodeId } = {}) {
  registry.addEditor(hash, { name: editorName, nodeId: editorNodeId })
  return registry.modelCard(hash)
}

function children(hash) {
  return registry.list().filter((e) => lineage.bareHash(e.manifest.parent) === hash || e.parentId2 === hash)
}

function isHybrid(entry) {
  return entry.parentId2 != null
}

// deleteModel -- LOCAL forget (registry.forget()), cascading through
// primary-parent descendants, with the exact "hybrid survives, drops the
// dangling lineage" rule panel.html's own deleteModel() already
// implements client-side (see that function's own comment there) --
// reproduced here so the behavior doesn't change now that the hub, not
// the browser tab, is what actually performs it.
function deleteModel(hash) {
  const target = registry.get(hash)
  if (!target) return { deleted: [] }
  const all = registry.list()
  const byHash = new Map(all.map((e) => [e.manifest.hash, e]))
  const toRemove = new Set()

  ;(function collect(h) {
    toRemove.add(h)
    for (const e of all) {
      const p = lineage.bareHash(e.manifest.parent)
      if (p === h && !isHybrid(e)) collect(e.manifest.hash)
    }
  })(hash)

  // Same "survives, drops that lineage" rule as panel.html's own
  // deleteModel(): a hybrid reached only through its PRIMARY parent is
  // never cascaded into toRemove; a hybrid whose primary OR secondary
  // parent is being removed just loses that one link instead.
  for (const e of all) {
    const h = e.manifest.hash
    if (toRemove.has(h)) continue
    const p = lineage.bareHash(e.manifest.parent)
    if (p && toRemove.has(p)) {
      if (e.parentId2 && !toRemove.has(e.parentId2)) {
        // Promote the surviving secondary parent into primary lineage by
        // re-stamping seedId/lineageStatus from it; manifest.parent
        // itself is immutable/signed so it still names the removed
        // artifact historically -- lineageStatus/seedId (the mutable
        // side) are what the UI actually renders from.
        registry.setLineage(h, { seedId: lineage.seedIdFor(e.parentId2) })
        registry.setSecondParent(h, null)
      } else {
        registry.setLineage(h, { seedId: h })
      }
    }
    if (e.parentId2 && toRemove.has(e.parentId2)) registry.setSecondParent(h, null)
  }

  for (const h of toRemove) registry.forget(h)
  return { deleted: [...toRemove] }
}

function listCards() {
  return registry.list().map((e) => registry.modelCard(e.manifest.hash))
}

module.exports = { createModel, renameModel, setBakes, touchEdit, deleteModel, listCards, castVote: votes.castVote }
