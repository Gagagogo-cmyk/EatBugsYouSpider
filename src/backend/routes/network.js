'use strict'

// routes/network.js -- the EBYS server's half of the artifact network: the
// "preferred server" priority-1 download source, and the small metadata
// registry (nodes + artifacts + replicas) described in
// docs/platform/ARTIFACT_NETWORK.md. The server never auto-deletes its own
// copy just because peer availability looks sufficient -- see that doc's
// "server incentives" section. POST /artifacts needs the raw request body
// (artifact bytes); express.raw() for this path is mounted in server.js
// before the global express.json(), the same pattern already used for
// /tips/webhook.

const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  upsertNode,
  registerArtifact,
  noteReplica,
  getArtifactManifest,
  getArtifactIdByHash,
  listArtifacts
} = require('../db/queries')

const router = express.Router()

const STORE_DIR = path.join(__dirname, '..', '..', '..', 'data', 'network', 'server-store')

function storePathFor(hash) {
  return path.join(STORE_DIR, hash)
}

// POST /network/artifacts -- publish. Body is the raw artifact bytes; the
// manifest travels in the x-ebys-manifest header (base64 JSON), same shape
// src/network/artifacts/manifest.js produces and every downloader
// re-verifies in quarantine.js. The server re-checks hash/structure here
// too, but it is not the trust root -- every peer verifies independently.
router.post('/artifacts', async (req, res) => {
  let manifest
  try {
    manifest = JSON.parse(Buffer.from(req.get('x-ebys-manifest') || '', 'base64').toString('utf8'))
  } catch (err) {
    return res.status(400).json({ error: 'missing or invalid x-ebys-manifest header' })
  }
  if (!manifest || !manifest.hash || !manifest.signature || !manifest.origin || !manifest.type) {
    return res.status(400).json({ error: 'manifest missing required fields' })
  }

  const body = req.body // Buffer -- express.raw() mounted on this path in server.js
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ error: 'empty body' })
  }

  const actualHash = crypto.createHash('sha256').update(body).digest('hex')
  if (actualHash !== manifest.hash) {
    return res.status(400).json({ error: 'hash mismatch between body and manifest -- rejected' })
  }

  try {
    fs.mkdirSync(STORE_DIR, { recursive: true })
    fs.writeFileSync(storePathFor(manifest.hash), body)
    await upsertNode(manifest.origin, 'peer')
    await registerArtifact(manifest)
    await noteReplica(manifest.id, manifest.origin, 'server')
  } catch (err) {
    return res.status(500).json({ error: `registry write failed: ${err.message}` })
  }

  res.status(201).json({ id: manifest.id, hash: manifest.hash })
})

// GET /network/artifacts/:hash -- download (priority-1 source).
router.get('/artifacts/:hash', (req, res) => {
  const filePath = storePathFor(req.params.hash)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found on this server' })
  res.sendFile(filePath)
})

// GET /network/artifacts/:hash/manifest
router.get('/artifacts/:hash/manifest', async (req, res) => {
  try {
    const manifest = await getArtifactManifest(req.params.hash)
    if (!manifest) return res.status(404).json({ error: 'not found' })
    res.json(manifest)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /network/artifacts -- list/query the phone book. Optional ?type=
router.get('/artifacts', async (req, res) => {
  try {
    res.json(await listArtifacts(req.query.type))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /network/nodes/announce -- a node pings in with its pubkey and
// which hashes it currently holds, updating replica availability. This is
// the only thing a peer node ever sends unsolicited -- no usage
// telemetry, no content, matching docs/platform/NETWORK.md's explicit
// "no instance phones home" stance for the code-provenance registry.
router.post('/nodes/announce', express.json(), async (req, res) => {
  const { nodeId, kind, displayName, hashes } = req.body || {}
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' })
  try {
    await upsertNode(nodeId, kind || 'peer', displayName)
    const replicaKind = kind === 'server' ? 'server' : (kind === 'dedicated' ? 'node' : 'peer')
    for (const hash of (hashes || [])) {
      const artifactId = await getArtifactIdByHash(hash)
      if (!artifactId) continue
      await noteReplica(artifactId, nodeId, replicaKind)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
