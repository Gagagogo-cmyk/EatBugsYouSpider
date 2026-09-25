#!/usr/bin/env node
'use strict'

// quarantine.js -- every downloaded artifact, regardless of source (server,
// trusted node, or swarm peer), goes through this before it is trusted or
// ever executed. "Never equate trusted node with safe file" -- so this runs
// identically no matter where the bytes came from:
//
//   download -> quarantine dir -> hash check -> signature check ->
//   type/extension validation -> scan() (real pickle-opcode scan for
//   pickle-risk formats) -> local store -> activate()
//
// activate() is a separate, explicit call -- nothing here flips an artifact
// into a usable state automatically. publish.js is the one exception: a
// node publishing its own, just-created artifact skips re-downloading bytes
// it already produced, but still goes through registry registration the
// same way.
//
// IMPORTANT SCOPE NOTE: hashing + signing (already checked above scan())
// answer "did this arrive unaltered from who it claims to be from?" --
// they say nothing about whether the publisher's own bytes were malicious
// to begin with. scan() is the check for that different question, and
// today it only covers one well-known, concrete vector: a pickle-format
// payload (.pkl/.pickle, or PyTorch's zip-wrapped .pt/.pth/.ckpt/.bin)
// smuggling arbitrary code execution via its GLOBAL/REDUCE opcodes. It
// does NOT statically analyze a Tool's own .py/.js/.pd source for
// malicious logic -- those are only extension-allowlisted below, same as
// before. See pickle_scan.py's own docstring for exactly what the pickle
// scan does and doesn't catch, and ARTIFACT_NETWORK.md's "Security model"
// section for the honest list of what's still unguarded.

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { NETWORK_DIR } = require('./identity')
const { hashArtifact } = require('./hash')
const manifestMod = require('./manifest')
const registry = require('./registry')

const QUARANTINE_DIR = path.join(NETWORK_DIR, 'quarantine')
const STORE_DIR = path.join(NETWORK_DIR, 'store')
const PICKLE_SCAN_SCRIPT = path.join(__dirname, 'pickle_scan.py')

// Extremely conservative allowlist per artifact type. This is a first
// pass, not the only line of defense on its own -- pickle-risk extensions
// below additionally go through scan(). Reject anything unexpected rather
// than guess.
//
// 'model' here means what EBYS actually produces: the remix engine's
// learned-bias taste model (docs/instrument/... slicer_bridge.js's
// loadLearnedBias()) -- a small MLP's weights exported as plain JSON
// (learned_bias.json), NOT a generative model and NOT a LoRA checkpoint.
// .json is therefore the primary/expected format and is inherently free
// of the pickle vector below (JSON can't carry executable opcodes). The
// other extensions are allowed because *some* published model might
// legitimately be a PyTorch/pickle-based file from elsewhere on the
// network -- every one of them is required to pass the pickle scan below,
// specifically because that format carries real code-execution risk that
// .json does not.
const ALLOWED_EXTENSIONS = {
  model: ['.json', '.safetensors', '.pt', '.pth', '.ckpt', '.bin', '.pkl', '.pickle', '.txt', '.md'],
  tool: ['.pd', '.js', '.json', '.md', '.txt', '.py', '.zip'],
  branch: ['.patch', '.diff', '.json', '.md', '.txt']
}

// File formats that can carry a pickle stream -- either directly (.pkl/
// .pickle) or wrapped in a zip container, which is PyTorch's default
// torch.save() shape for .pt/.pth/.ckpt/.bin. Every file with one of
// these extensions gets opcode-scanned by pickle_scan.py before this
// artifact can pass quarantine.
const PICKLE_RISK_EXTENSIONS = new Set(['.pkl', '.pickle', '.pt', '.pth', '.ckpt', '.bin'])

// Both paths carry the artifact's extension (from the manifest's signed
// `ext` field) so a downloaded file is actually recognizable as what it
// claims to be -- swarm/server transport only carries raw bytes, with no
// filename, so without this the extension allowlist and pickle-risk scan
// below would silently never match anything on the receiving end.
function quarantinePathFor(hash, ext = '') {
  return path.join(QUARANTINE_DIR, hash + (ext || ''))
}

function storePathFor(hash, ext = '') {
  return path.join(STORE_DIR, hash + (ext || ''))
}

// For callers that only have a bare hash (activate(), the CLI) -- looks
// up the already-registered manifest to recover its extension, rather
// than requiring every caller to thread `ext` through by hand.
function resolvedStorePath(hash) {
  const entry = registry.get(hash)
  const ext = entry && entry.manifest ? (entry.manifest.ext || '') : ''
  return storePathFor(hash, ext)
}

function walkFiles(root) {
  const out = []
  const stat = fs.statSync(root)
  if (stat.isFile()) return [root]
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

function validateTypes(rootPath, type) {
  const allowed = ALLOWED_EXTENSIONS[type]
  if (!allowed) throw new Error(`no extension allowlist configured for type ${type}`)
  for (const f of walkFiles(rootPath)) {
    const ext = path.extname(f).toLowerCase()
    if (!allowed.includes(ext)) {
      throw new Error(`file ${path.basename(f)} (${ext || 'no extension'}) is not allowed for artifact type ${type}`)
    }
  }
}

// Runs pickle_scan.py against one file -- never calls pickle.load()/
// torch.load() itself, and neither does the script (see its docstring).
// Resolves rather than rejects on a scanner failure, folding the failure
// into the result, so a single bad scan cleanly fails the artifact
// instead of throwing past callers that expect a result object.
function runPickleScan(filePath) {
  return new Promise((resolve) => {
    execFile('python3', [PICKLE_SCAN_SCRIPT, filePath, '--type', 'auto'], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ clean: false, findings: [{ label: filePath, issue: `scanner failed to run (${stderr || err.message})` }] })
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (parseErr) {
        resolve({ clean: false, findings: [{ label: filePath, issue: `scanner produced unparseable output: ${parseErr.message}` }] })
      }
    })
  })
}

// The real scan: a static, non-executing pickle-opcode check for every
// file whose extension can carry a pickle payload. See the SCOPE NOTE at
// the top of this file for what this does and does not cover.
async function scan(rootPath, manifest) {
  const riskFiles = walkFiles(rootPath).filter((f) => PICKLE_RISK_EXTENSIONS.has(path.extname(f).toLowerCase()))
  const findings = []
  for (const f of riskFiles) {
    const result = await runPickleScan(f)
    if (!result.clean) {
      for (const finding of (result.findings || [])) {
        findings.push(`${path.basename(f)} (${finding.label || ''}): ${finding.issue}`)
      }
    }
  }
  if (findings.length > 0) {
    return { clean: false, engine: 'pickle_scan.py', reason: findings.join('; ') }
  }
  return { clean: true, engine: 'pickle_scan.py', filesScanned: riskFiles.length }
}

// Run an already-downloaded artifact (sitting at quarantinePathFor(hash))
// through the full verification pipeline. Throws on any failure -- callers
// must not fall back to trusting an artifact that failed a check.
async function process(hash, manifest) {
  const qPath = quarantinePathFor(hash, manifest.ext)
  if (!fs.existsSync(qPath)) throw new Error(`nothing in quarantine for ${hash}`)

  const actualHash = await hashArtifact(qPath)
  if (actualHash !== hash) {
    throw new Error(`hash mismatch: expected ${hash}, got ${actualHash} -- refusing to trust this download`)
  }
  if (manifest.hash !== hash) {
    throw new Error('manifest hash does not match the artifact hash requested')
  }
  if (!manifestMod.verify(manifest)) {
    throw new Error(`signature verification failed for ${hash} -- manifest was not signed by its claimed origin`)
  }

  validateTypes(qPath, manifest.type)

  // Registered BEFORE the scan (not after, as this used to do) so a
  // FLAGGED artifact still leaves a durable, queryable registry entry --
  // "this hash was seen and refused" -- instead of vanishing without a
  // trace the instant scan() fails below. The throw on a failed scan is
  // unchanged and still aborts before STORE_DIR/activation either way --
  // this only changes what's left behind for the model browser to show.
  registry.register(manifest)

  const scanResult = await scan(qPath, manifest)
  registry.setPickleScanResult(hash, pickleScanStatusFor(manifest.ext, scanResult))
  if (!scanResult.clean) {
    throw new Error(`artifact ${hash} failed security scan (${scanResult.engine}): ${scanResult.reason || 'flagged'}`)
  }

  fs.mkdirSync(STORE_DIR, { recursive: true })
  const dest = storePathFor(hash, manifest.ext)
  if (fs.existsSync(dest)) {
    // Content-addressed: identical hash means identical bytes, already
    // verified the first time this landed here -- no need to delete and
    // re-write it. Just discard the redundant quarantine copy
    // (best-effort: some mounted/networked filesystems restrict deletes
    // entirely; a leftover quarantine copy is harmless either way).
    try { fs.rmSync(qPath, { recursive: true, force: true }) } catch (err) { /* best-effort */ }
  } else {
    fs.renameSync(qPath, dest)
  }

  registry.setActivated(hash, false)

  return { hash, storedAt: dest, scan: scanResult }
}

function activate(hash) {
  if (!fs.existsSync(resolvedStorePath(hash))) {
    throw new Error(`${hash} has not passed quarantine yet -- nothing to activate`)
  }
  return registry.setActivated(hash, true)
}

function isActivated(hash) {
  const entry = registry.get(hash)
  return !!(entry && entry.activated)
}

// PICKLE_SCAN_VERSION -- bumped whenever pickle_scan.py's own detection
// logic changes meaningfully (e.g. SAFE_GLOBALS additions), so a
// persisted pickleScan result can be told apart from one produced by an
// older/newer scanner without re-scanning just to find out.
const PICKLE_SCAN_VERSION = '1.0'

// pickleScanStatusFor -- maps a scan() result (or the fact that this
// file's extension was never pickle-risk to begin with) onto the small
// persisted enum registry.setPickleScanResult() expects -- see that
// function's own comment for what each status means to a UI trying to
// show "scanned? state?" at a glance, per the model-network spec's own
// "make the state understandable at a glance" requirement.
function pickleScanStatusFor(ext, scanResult) {
  const isRiskExt = PICKLE_RISK_EXTENSIONS.has((ext || '').toLowerCase())
  if (!isRiskExt) return { status: 'not-applicable', engine: 'pickle_scan.py', scannerVersion: PICKLE_SCAN_VERSION }
  return {
    status: scanResult.clean ? 'scanned-clean' : 'flagged',
    engine: scanResult.engine || 'pickle_scan.py',
    scannerVersion: PICKLE_SCAN_VERSION
  }
}

module.exports = {
  QUARANTINE_DIR, STORE_DIR,
  quarantinePathFor, storePathFor, resolvedStorePath,
  process, activate, isActivated, scan, validateTypes, pickleScanStatusFor, PICKLE_SCAN_VERSION
}
