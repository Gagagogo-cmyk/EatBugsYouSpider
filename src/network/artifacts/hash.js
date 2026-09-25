#!/usr/bin/env node
'use strict'

// hash.js -- content-addressing for artifacts (models, tools, branches).
// This is the concrete implementation of the prerequisite docs/decentralize.md
// flags and leaves undone for audio tracks ("le vrai chantier" -- a content
// hash instead of a filename) -- scoped here to Model/Tool/Branch artifacts,
// which carry far less legal exposure than raw audio, so it's a safe place
// to actually build it first. A single file or a directory both hash the
// same way: every regular file's relative path + contents are folded into
// one sha256 in a stable (sorted) order, so the same directory tree always
// produces the same hash regardless of the OS's readdir order.
//
// v1 note: src/network/artifacts/publish.js currently requires artifacts to
// be a single file (zip multi-file tools before publishing -- see
// docs/platform/ARTIFACT_NETWORK.md, "known v1 limitations"). Directory
// hashing is kept here anyway because it's genuinely useful beyond
// publish() -- e.g. hashing a branch's working tree -- and costs nothing
// extra to support.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function listFiles(root) {
  const out = []
  const stat = fs.statSync(root)
  if (stat.isFile()) return [root]
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) out.push(full)
    }
  }
  walk(root)
  return out
}

// sha256 of a single file's bytes, streamed (safe for large .safetensors checkpoints).
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => h.update(chunk))
    stream.on('end', () => resolve(h.digest('hex')))
    stream.on('error', reject)
  })
}

// sha256 over the whole artifact -- one file, or a directory tree.
// Directory hash = sha256 of "<relative-path>\0<file-sha256>\n" for every
// file, sorted by relative path, so it's deterministic and order-independent.
async function hashArtifact(artifactPath) {
  const absRoot = path.resolve(artifactPath)
  const stat = fs.statSync(absRoot)
  if (stat.isFile()) {
    return hashFile(absRoot)
  }
  const files = listFiles(absRoot).sort()
  const h = crypto.createHash('sha256')
  for (const f of files) {
    const rel = path.relative(absRoot, f).split(path.sep).join('/')
    const fileHash = await hashFile(f)
    h.update(rel + '\0' + fileHash + '\n')
  }
  return h.digest('hex')
}

module.exports = { hashArtifact, hashFile, listFiles }
