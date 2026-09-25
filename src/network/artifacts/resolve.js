#!/usr/bin/env node
'use strict'

// resolve.js -- server-first, P2P-fallback download priority, exactly as
// specified: (1) the configured Gnumbat server, (2) known trusted/dedicated
// nodes from the local peer cache (ranked by last-seen), (3) any swarm
// peer already known to hold the artifact. First success wins. If every
// source fails, this reports the artifact as temporarily unavailable --
// it never fabricates a source.

const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const registry = require('./registry')
const swarm = require('./swarm')
const quarantine = require('./quarantine')

const DEFAULT_SERVER = process.env.GNUMBAT_SERVER_URL || null

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`server responded ${res.statusCode} for ${url}`))
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      const file = fs.createWriteStream(destPath)
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(destPath)))
      file.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error(`timed out fetching ${url}`)))
  })
}

function fetchManifest(hash, serverUrl) {
  return new Promise((resolve, reject) => {
    const url = `${serverUrl}/network/artifacts/${hash}/manifest`
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`manifest ${res.statusCode}`)) }
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

// Try an HTTP-capable Gnumbat server (the preferred server, or a dedicated
// node running the same backend API).
async function tryServer(hash, serverUrl) {
  if (!serverUrl) return null
  try {
    const manifest = await fetchManifest(hash, serverUrl)
    const dest = quarantine.quarantinePathFor(hash, manifest.ext)
    await download(`${serverUrl}/network/artifacts/${hash}`, dest)
    return { manifest, source: { kind: 'server', id: serverUrl } }
  } catch (err) {
    return null
  }
}

// Known dedicated nodes this instance already trusts, ranked most-recently-seen first.
async function tryKnownNodes(hash) {
  const peers = registry.loadPeers()
  const nodes = Object.entries(peers)
    .filter(([, info]) => (info.kind === 'node' || info.kind === 'server') && info.url)
    .sort((a, b) => (a[1].last_seen < b[1].last_seen ? 1 : -1))
  for (const [, info] of nodes) {
    const result = await tryServer(hash, info.url)
    if (result) return result
  }
  return null
}

// Last resort: ask the swarm directly via a coreKey we already know about
// from a prior registry entry (e.g. cached from an earlier server lookup).
async function tryPeers(hash) {
  const entry = registry.get(hash)
  if (!entry || !entry.manifest || !entry.manifest.coreKey) return null
  try {
    const dest = quarantine.quarantinePathFor(hash, entry.manifest.ext)
    await swarm.fetch(entry.manifest.coreKey, dest)
    return { manifest: entry.manifest, source: { kind: 'peer', id: entry.manifest.coreKey } }
  } catch (err) {
    return null
  }
}

async function resolve(hash, { serverUrl = DEFAULT_SERVER } = {}) {
  const attempts = [
    () => tryServer(hash, serverUrl),
    () => tryKnownNodes(hash),
    () => tryPeers(hash)
  ]
  for (const attempt of attempts) {
    const result = await attempt()
    if (result) {
      const verified = await quarantine.process(hash, result.manifest)
      registry.noteLocation(hash, result.source)
      return { ...verified, source: result.source }
    }
  }
  return { unavailable: true, hash, reason: 'no server, known node, or swarm peer currently has this artifact' }
}

module.exports = { resolve, DEFAULT_SERVER }
