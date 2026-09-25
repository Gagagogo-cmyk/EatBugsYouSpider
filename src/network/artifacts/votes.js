#!/usr/bin/env node
'use strict'

// votes.js -- a local, no-account vote ledger for Models/Branches/Seeds.
// Per docs/platform/ARTIFACT_NETWORK.md's own framing (no centralized
// database, no login system for this layer), a vote is cast by a
// caller-supplied `voterId` -- any stable string the caller already has
// (gui_hub_bridge.js mints and persists one per browser, panel.html
// keeps it in localStorage; the future listener-facing radio page could
// mint its own the same way) -- not a real account. One JSON ledger per
// artifact hash at data/network/votes/<hash>.json holds every voter's
// CURRENT vote (re-voting updates in place rather than double-counting),
// so `tally()` is always a plain recount, never a running total that can
// drift from the ledger it's supposed to summarize.
//
// This deliberately has nothing to do with succession -- see lineage.js's
// evaluateSuccession(): votes are one INPUT a future policy could use,
// never a rule this file enforces itself.

const fs = require('fs')
const path = require('path')
const { NETWORK_DIR } = require('./identity')
const registry = require('./registry')

const VOTES_DIR = path.join(NETWORK_DIR, 'votes')

function ledgerPath(hash) {
  return path.join(VOTES_DIR, `${hash}.json`)
}

function loadLedger(hash) {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(hash), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

function saveLedger(hash, ledger) {
  fs.mkdirSync(VOTES_DIR, { recursive: true })
  fs.writeFileSync(ledgerPath(hash), JSON.stringify(ledger, null, 2))
}

function tally(hash) {
  const ledger = loadLedger(hash)
  let up = 0, down = 0
  for (const voterId of Object.keys(ledger)) {
    if (ledger[voterId].value > 0) up++
    else if (ledger[voterId].value < 0) down++
  }
  return { up, down }
}

// castVote -- value must be exactly 1 (upvote) or -1 (downvote); passing
// 0 clears an existing vote (lets a voter retract without having to
// "vote the other way" to cancel out). voterKind is optional free-form
// context ('listener' | 'trainer' | undefined) -- recorded for future
// analysis/curation, never used to weight or gate a vote today.
function castVote(hash, voterId, value, voterKind) {
  if (!registry.get(hash)) throw new Error(`unknown artifact ${hash} -- register() its manifest first`)
  if (!voterId) throw new Error('castVote requires a voterId')
  if (value !== 1 && value !== -1 && value !== 0) throw new Error('vote value must be 1, -1, or 0 (retract)')
  const ledger = loadLedger(hash)
  if (value === 0) delete ledger[voterId]
  else ledger[voterId] = { value, voterKind: voterKind || null, votedAt: new Date().toISOString() }
  saveLedger(hash, ledger)
  const result = tally(hash)
  registry.setVoteTally(hash, result)
  return result
}

function voteOf(hash, voterId) {
  const ledger = loadLedger(hash)
  return ledger[voterId] ? ledger[voterId].value : 0
}

module.exports = { castVote, tally, voteOf, VOTES_DIR }
