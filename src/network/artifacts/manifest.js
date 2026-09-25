#!/usr/bin/env node
'use strict'

// manifest.js -- build, sign, and verify an artifact manifest. Field names
// deliberately mirror docs/platform/NETWORK.md's existing .provenance.yml
// shape (id, origin, license, version, parent) so code-lineage and
// artifact-lineage (models, tools, branches published at runtime) stay one
// mental model instead of two competing ones.
//
// `parent` != null is how a fork/derivative is expressed -- publishing a
// modification never overwrites the parent's manifest, it creates a new
// one that points back (the Alice/Bob example in the spec this implements).

const identityMod = require('./identity')

const VALID_TYPES = new Set(['model', 'tool', 'branch'])

// Canonical JSON: stable key order so the same manifest fields always
// serialize to the same bytes for signing/verification, regardless of
// object construction order.
function canonicalize(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort())
}

function unsigned(fields) {
  const { type, hash, version, parent, license, creator, coreKey, ext } = fields
  if (!VALID_TYPES.has(type)) throw new Error(`invalid artifact type: ${type}`)
  if (!hash) throw new Error('manifest requires a content hash')
  const manifest = {
    id: `sha256:${hash}`,
    type,
    hash,
    origin: identityMod.publicKeyHex(),
    creator: creator || null,
    version: version || '1.0',
    parent: parent || null,
    license: license || 'AGPL-3.0',
    created_at: new Date().toISOString()
  }
  // coreKey identifies which local Hypercore (see swarm.js) currently
  // carries this artifact's bytes on the publishing node -- optional
  // because not every manifest is expected to travel over the swarm
  // (e.g. one only ever pushed straight to the server).
  if (coreKey) manifest.coreKey = coreKey
  // ext (e.g. ".json", ".pt") is signed alongside the hash so the
  // receiving end knows what it's actually looking at -- swarm/server
  // transport only ever carries raw bytes, with no filename of its own.
  // quarantine.js's extension allowlist and pickle-risk scan both depend
  // on this being present and trustworthy (part of the signed payload,
  // not guessed from a filename an attacker could lie about).
  if (ext) manifest.ext = ext
  return manifest
}

function build(fields) {
  const manifest = unsigned(fields)
  const signature = identityMod.sign(Buffer.from(canonicalize(manifest), 'utf8'))
  return { ...manifest, signature: signature.toString('hex') }
}

function verify(manifest) {
  if (!manifest || !manifest.signature || !manifest.origin) return false
  const { signature, ...rest } = manifest
  const message = Buffer.from(canonicalize(rest), 'utf8')
  try {
    return identityMod.verify(message, Buffer.from(signature, 'hex'), manifest.origin)
  } catch (err) {
    return false
  }
}

module.exports = { build, verify, canonicalize, VALID_TYPES }
