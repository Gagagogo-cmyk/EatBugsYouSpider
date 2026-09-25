'use strict'

// routes/models.js -- ModelService (spec §23): the consumer app's ONLY view
// of models. Every query here filters to release_state IN
// ('released','evolving') -- see db/queries.js's listReleasedModels()/
// getModelCard()/getModelLineage() -- so an unfinished model (development/
// training/testing/ready) can never leak to a listener, matching spec §22.
//
// This deliberately does not expose trainingState, creators/editors,
// pickleScan, or anything else src/network/artifacts/registry.js's
// modelCard() carries for CREATORS (src/gui/panel.html) -- those stay behind
// the local hub. This is the public-safe subset only.

const express = require('express')
const router = express.Router()
const { listReleasedModels, getModelCard, getModelLineage } = require('../db/queries')

function publicModel(row) {
  const manifest = row.manifest || {}
  return {
    hash: row.hash,
    name: manifest.displayName || null,
    version: row.version,
    releaseState: row.release_state,
    releasedAt: row.released_at,
    parentHash: row.parent_id,
    createdAt: row.created_at
  }
}

// GET /models/released -- every consumer-eligible model/station. This is
// what lets the Radio screen (and any future "browse stations" surface)
// discover what's available without the listener ever picking a model
// manually (spec §10, §18).
router.get('/released', async (req, res) => {
  try {
    const rows = await listReleasedModels()
    res.json(rows.map(publicModel))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /models/:hash/card -- one released model's public card.
router.get('/:hash/card', async (req, res) => {
  try {
    const row = await getModelCard(req.params.hash)
    if (!row) return res.status(404).json({ error: 'not found or not released' })
    res.json(publicModel(row))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /models/:hash/lineage -- read-only seed/branch tree for the CRKT
// screen (spec §12). No create/edit/merge/replant here -- that stays a
// creator-only action in the desktop hub (src/gui/gui_hub_bridge.js).
router.get('/:hash/lineage', async (req, res) => {
  try {
    const tree = await getModelLineage(req.params.hash)
    if (!tree) return res.status(404).json({ error: 'not found' })
    res.json(tree)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
