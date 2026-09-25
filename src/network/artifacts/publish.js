#!/usr/bin/env node
'use strict'

// publish.js -- ties hashing, manifest signing, local seeding, registry
// registration, and (optionally) pushing to the configured Gnumbat server
// into one call. This is the only place a Model/Tool/Branch actually
// becomes "on the network" -- the Alice-publishes-a-model flow from the
// spec starts here.

const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { hashArtifact } = require('./hash')
const manifestMod = require('./manifest')
const registry = require('./registry')
const swarm = require('./swarm')
const quarantine = require('./quarantine')
const lineage = require('./lineage')
const { identity } = require('./identity')

function postToServer(serverUrl, manifest, filePath) {
  return new Promise((resolve, reject) => {
    const client = serverUrl.startsWith('https') ? https : http
    const body = fs.readFileSync(filePath)
    const req = client.request(`${serverUrl}/network/artifacts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': body.length,
        'x-ebys-manifest': Buffer.from(JSON.stringify(manifest)).toString('base64')
      }
    }, (res) => {
      res.resume()
      if (res.statusCode >= 200 && res.statusCode < 300) resolve(true)
      else reject(new Error(`server rejected publish: ${res.statusCode}`))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// filePath must be a single file in this v1 (zip multi-file tools before
// publishing -- see docs/platform/ARTIFACT_NETWORK.md, "known v1 limitations").
// creator may be a single name (back-compat with earlier single-creator
// callers, e.g. cli.js's --creator flag) or an array of names, per the
// model-network spec's "support multiple creators" requirement.
// integrateFollowingBranches is a seed-only publish-time option (see
// registry.setIntegrateFollowingBranches -- silently ignored for a
// branch publish, i.e. when `parent` is set, rather than erroring, since
// a caller publishing a whole batch of branches+seeds shouldn't need to
// special-case which ones may pass it).
// seed (default true) -- whether to actually join the P2P swarm for this
// artifact's bytes. A brand-new, untrained draft model (models.js's
// createModel()) has nothing anyone else would want to fetch yet, so it
// registers a real, honest identity (hash/manifest/registry entry)
// without opening a Hyperswarm connection that would otherwise sit open
// for the rest of this process's life per artifact ever created --
// exactly the "don't claim network availability you don't mean"
// principle applied to publish() itself: this node still shows as a
// location (registry.noteLocation() below, unconditional) so the model
// is honestly self-available, just not yet broadcast to the wider swarm.
async function publish(filePath, { type, version, parent, license, creator, integrateFollowingBranches, serverUrl, seed = true } = {}) {
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) {
    throw new Error('publish() requires a single file in this v1 -- zip multi-file tools/models first')
  }

  const hash = await hashArtifact(filePath)
  const ext = path.extname(filePath)

  // Publishing your own file still runs it through the same extension
  // allowlist + pickle scan every downloader's quarantine runs -- "your
  // own bytes" isn't the same guarantee as "safe bytes" (a compromised
  // dependency, a bad copy-paste, an accidental wrong file). This is
  // deliberately the same code path resolve()/quarantine.process() uses,
  // not a separate, looser check.
  if (!fs.statSync(filePath).isFile()) {
    throw new Error('publish() requires a single file in this v1')
  }
  quarantine.validateTypes(filePath, type)
  const scanResult = await quarantine.scan(filePath, { type, hash })
  if (!scanResult.clean) {
    throw new Error(`refusing to publish ${filePath}: failed security scan (${scanResult.engine}): ${scanResult.reason || 'flagged'}`)
  }

  const coreKey = seed ? (await swarm.seed(hash, filePath)).coreKey : null
  const manifest = manifestMod.build({ type, hash, version, parent, license, creator, coreKey, ext })

  registry.register(manifest)
  // lineage.syncRoleAndSeed -- stamps role ('seed'|'branch') + seedId +
  // a default lineageStatus derived from the manifest's own (immutable)
  // parent pointer. Runs on every publish, seed or branch, so nothing
  // downstream (the hub, the UI) has to re-derive it by hand.
  lineage.syncRoleAndSeed(hash)
  if (creator) {
    const creatorNames = Array.isArray(creator) ? creator : [creator]
    registry.setCreators(hash, creatorNames.map((name) => ({ name, nodeId: identity().publicKey.toString('hex') })))
  }
  if (!parent && integrateFollowingBranches !== undefined) {
    registry.setIntegrateFollowingBranches(hash, integrateFollowingBranches)
  }
  // Persist the scan this function already ran above (scanResult),
  // instead of letting that result evaporate the moment publish()
  // returns -- see quarantine.js's pickleScanStatusFor() for the mapping.
  registry.setPickleScanResult(hash, quarantine.pickleScanStatusFor(ext, scanResult))
  // We just verified this locally (same checks a downloader would run),
  // so it goes straight to the store -- same destination
  // quarantine.process() would put it in, without re-downloading bytes we
  // already have.
  fs.mkdirSync(quarantine.STORE_DIR, { recursive: true })
  fs.copyFileSync(filePath, quarantine.storePathFor(hash, ext))
  registry.setActivated(hash, true)
  registry.noteLocation(hash, { kind: 'node', id: identity().publicKey.toString('hex') })

  let pushedToServer = false
  if (serverUrl) {
    try {
      await postToServer(serverUrl, manifest, filePath)
      registry.noteLocation(hash, { kind: 'server', id: serverUrl })
      pushedToServer = true
    } catch (err) {
      // Server unreachable is fine -- this node still serves it over the
      // swarm. A publish never blocks on the server being up (phase 3,
      // "rogue," is the whole point).
    }
  }

  return { manifest, hash, coreKey, seeded: seed, pushedToServer }
}

module.exports = { publish }
