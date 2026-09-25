#!/usr/bin/env node
'use strict'

// swarm.js -- P2P replication for artifact bytes, generalized from the
// exact pattern already proven across two machines in carnet-daemon.js and
// mirror.js (see src/network/README.md): one Hypercore per unit of content
// inside a shared Corestore, Hyperswarm rendezvous on that core's
// discoveryKey. carnet-daemon.js carries JSON event blocks; this carries
// fixed-size chunks of an artifact's bytes instead -- the underlying
// mechanism doesn't change, only what's inside each block.
//
// Local writer cores are named after the artifact hash (store.get({name}),
// same convention carnet-daemon.js uses for CORE_NAME) so re-seeding an
// already-published artifact reopens the same core deterministically.
// Foreign (downloaded) cores are opened by their public key -- the
// manifest's `coreKey` field -- exactly as mirror.js opens someone else's
// carnet by its printed public key.

const fs = require('fs')
const path = require('path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const hcrypto = require('hypercore-crypto')
const { NETWORK_DIR } = require('./identity')

const STORE_DIR = path.join(NETWORK_DIR, 'corestore')
const CHUNK_SIZE = 64 * 1024

let sharedStore = null
function store() {
  if (!sharedStore) sharedStore = new Corestore(STORE_DIR)
  return sharedStore
}

// Publish local bytes into a writer core named after the artifact hash and
// start serving it over the swarm. Returns immediately after joining --
// this process now acts as a peer for this artifact for as long as it
// stays running (see docs/platform/ARTIFACT_NETWORK.md, "peer behavior":
// a node only serves while it's actually running).
async function seed(hash, filePath) {
  const core = store().get({ name: hash })
  await core.ready()
  if (core.length === 0) {
    const buf = fs.readFileSync(filePath)
    for (let offset = 0; offset < buf.length; offset += CHUNK_SIZE) {
      await core.append(buf.subarray(offset, offset + CHUNK_SIZE))
    }
  }
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => store().replicate(conn))
  swarm.join(core.discoveryKey, { server: true, client: true })
  await swarm.flush().catch(() => {})
  return { core, swarm, coreKey: core.key.toString('hex') }
}

// Fetch a foreign core by its public key (the manifest's coreKey) and
// reassemble it into destPath. Resolves once the whole core has
// replicated, or rejects after timeoutMs with no peer found -- this v1
// has no DHT-wide "search by hash," only "fetch a known core by key," so
// resolve.js only ever calls this once it already has a manifest with a
// coreKey in hand (from the server, a known node, or a prior registry
// entry).
async function fetch(coreKeyHex, destPath, { timeoutMs = 15000 } = {}) {
  const key = Buffer.from(coreKeyHex, 'hex')
  const core = store().get(key)
  await core.ready()

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => store().replicate(conn))
  const discoveryKey = hcrypto.discoveryKey(key)
  swarm.join(discoveryKey, { server: true, client: true })

  const gotPeer = await Promise.race([
    new Promise((resolve) => swarm.once('connection', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ])
  if (!gotPeer) {
    await swarm.destroy()
    throw new Error(`no peer found for core ${coreKeyHex} within ${timeoutMs}ms`)
  }

  // core.update() waits to learn the writer's current length from a peer.
  await core.update({ wait: true }).catch(() => {})
  const length = core.length
  if (length === 0) {
    await swarm.destroy()
    throw new Error(`peer connected but core ${coreKeyHex} is empty`)
  }

  const chunks = []
  for (let i = 0; i < length; i++) {
    chunks.push(await core.get(i))
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, Buffer.concat(chunks))

  await swarm.destroy()
  return destPath
}

async function closeAll() {
  if (sharedStore) await sharedStore.close()
  sharedStore = null
}

module.exports = { seed, fetch, closeAll, CHUNK_SIZE, STORE_DIR }
