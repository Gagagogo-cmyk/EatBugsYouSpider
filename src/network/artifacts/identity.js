#!/usr/bin/env node
'use strict'

// identity.js -- this node's persistent ed25519 identity. Every artifact
// this node publishes is signed with this key; every manifest verification
// checks a signature against the signer's public key. See
// docs/platform/ARTIFACT_NETWORK.md ("Node identity") for why this reuses
// hypercore-crypto rather than adding a new crypto dependency -- it's
// already resolved transitively via corestore/hyperswarm in this same
// package (src/network/package-lock.json already pins hypercore-crypto).

const fs = require('fs')
const path = require('path')
const crypto = require('hypercore-crypto')

const ROOT = path.join(__dirname, '..', '..', '..')
// Override lets a second local process act as an independent node for
// dev/testing (its own identity, registry, and corestore) without a
// second machine -- e.g. EBYS_NETWORK_DIR=/tmp/peer2 node cli.js ...
const NETWORK_DIR = process.env.EBYS_NETWORK_DIR || path.join(ROOT, 'data', 'network')
const IDENTITY_FILE = path.join(NETWORK_DIR, 'identity.json')

function loadOrCreate() {
  fs.mkdirSync(NETWORK_DIR, { recursive: true })
  try {
    const raw = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'))
    return {
      publicKey: Buffer.from(raw.publicKey, 'hex'),
      secretKey: Buffer.from(raw.secretKey, 'hex')
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    const keyPair = crypto.keyPair()
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify({
      publicKey: keyPair.publicKey.toString('hex'),
      secretKey: keyPair.secretKey.toString('hex'),
      created_at: new Date().toISOString()
    }, null, 2), { mode: 0o600 })
    return keyPair
  }
}

let cached = null
function identity() {
  if (!cached) cached = loadOrCreate()
  return cached
}

function publicKeyHex() {
  return identity().publicKey.toString('hex')
}

function sign(message) {
  return crypto.sign(message, identity().secretKey)
}

function verify(message, signature, publicKeyHexStr) {
  return crypto.verify(message, signature, Buffer.from(publicKeyHexStr, 'hex'))
}

module.exports = { identity, publicKeyHex, sign, verify, NETWORK_DIR }
