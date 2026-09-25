#!/usr/bin/env node
'use strict'

// fetch.js -- the public "get me this artifact" entry point. Thin wrapper
// around resolve.js's server-first/peer-fallback priority chain, returning
// either the local, quarantine-verified path, or an explicit "unavailable"
// result -- this is Bob/Claire/David's side of the spec's flow.

const { resolve } = require('./resolve')
const quarantine = require('./quarantine')

async function fetchArtifact(hash, opts = {}) {
  const result = await resolve(hash, opts)
  if (result.unavailable) return result
  // result.storedAt is the exact path quarantine.process() just verified
  // and wrote to (hash + the manifest's own ext) -- use that directly
  // rather than re-deriving it and risking a mismatch.
  return { hash, path: result.storedAt, activated: quarantine.isActivated(hash), source: result.source }
}

module.exports = { fetchArtifact }
