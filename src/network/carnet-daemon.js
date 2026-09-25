#!/usr/bin/env node
'use strict'

// carnet-daemon.js -- Gnumbat regional carnet, stage 1 (local only, no network
// yet). Watches the event-crawler's all_events.json and appends new/changed
// events into a local, append-only Hypercore ("Montreal's carnet"). No
// Hyperswarm, no replication, no Autobase yet -- see README.md in this
// folder for the staged plan this is step 1 of, and
// docs/platform/NETWORK.md ("Within one instance: the regional carnet") for
// why this lives here as its own small daemon instead of inside the Go
// crawler (src/backend/event-crawler/) -- the crawler needs zero changes,
// it just keeps writing all_events.json exactly like it does today.

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')

const ROOT = path.join(__dirname, '..', '..')
const EVENTS_FILE = path.join(ROOT, 'src', 'backend', 'event-crawler', 'all_events.json')
const CARNET_DIR = path.join(ROOT, 'data', 'carnet')
const SEEN_FILE = path.join(CARNET_DIR, 'seen.json')
const CORE_NAME = 'montreal-events'

function log(msg) {
  console.log(`[carnet] ${new Date().toISOString()} ${msg}`)
}

function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')))
  } catch {
    return new Set()
  }
}

function saveSeen(seen) {
  fs.mkdirSync(CARNET_DIR, { recursive: true })
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen]))
}

// Stable id for one event: hash of the fields that identify "this show",
// not the ones that legitimately change on a re-scrape (event_image,
// price formatting, is_today/is_this_week -- those are derived/mutable,
// see events.go's own comment on enrichEvent()). venue_key + name + date +
// time is the closest thing the Go Event struct has to a natural key.
function eventId(venueKey, e) {
  const key = [venueKey, e.name, e.date, e.time || ''].join('|')
  return crypto.createHash('sha256').update(key).digest('hex')
}

function flattenEvents(store) {
  const out = []
  const venues = store.venues || {}
  for (const venueKey of Object.keys(venues)) {
    const block = venues[venueKey] || {}
    for (const e of block.events || []) {
      out.push({ venueKey, venueName: block.name, event: e })
    }
  }
  return out
}

async function scanAndAppend(core, seen) {
  let raw
  try {
    raw = fs.readFileSync(EVENTS_FILE, 'utf8')
  } catch (err) {
    log(`can't read all_events.json yet (${err.code}) -- waiting for the crawler to write it`)
    return
  }
  let store
  try {
    store = JSON.parse(raw)
  } catch (err) {
    log(`all_events.json didn't parse (probably mid-write) -- skipping this pass: ${err.message}`)
    return
  }

  const flat = flattenEvents(store)
  let added = 0
  for (const { venueKey, venueName, event } of flat) {
    const id = eventId(venueKey, event)
    if (seen.has(id)) continue
    await core.append(JSON.stringify({
      id,
      appended_at: new Date().toISOString(),
      venue_key: venueKey,
      venue_name: venueName,
      event
    }))
    seen.add(id)
    added++
  }
  if (added > 0) {
    saveSeen(seen)
    log(`appended ${added} new event(s) -- carnet length now ${core.length}, ${seen.size} seen total`)
  } else {
    log(`no new events (${flat.length} in file, all already in the carnet)`)
  }
}

async function dump(core, n) {
  const from = Math.max(0, core.length - n)
  for (let i = from; i < core.length; i++) {
    const block = await core.get(i)
    const parsed = JSON.parse(block.toString())
    console.log(`#${i} [${parsed.appended_at}] ${parsed.venue_name} -- ${parsed.event.name} (${parsed.event.date})`)
  }
  console.log(`\n${core.length} total entries in the carnet.`)
}

// Stage 2 -- join the swarm under this carnet's discovery key so any peer
// who already knows the PUBLIC KEY (not the discovery key -- that's derived
// and one-way, see hyperswarm's own docs) can find and replicate it. This
// instance is the writer: {server:true} means it accepts incoming
// connections; {client:true} lets it also dial out if it ever runs
// alongside a --mirror of something else. Every connection just gets
// handed to store.replicate() -- corestore replicates every core it holds
// over one connection, so this line doesn't change if more cores (other
// contributors, once stage 3/Autobase exists) get added to the same store.
function joinSwarm(store, core) {
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn, info) => {
    log(`peer connected (${info.client ? 'outgoing' : 'incoming'}) -- replicating`)
    store.replicate(conn)
  })
  swarm.join(core.discoveryKey, { server: true, client: true })
  return swarm
}

async function main() {
  const store = new Corestore(path.join(CARNET_DIR, 'store'))
  const core = store.get({ name: CORE_NAME })
  await core.ready()
  log(`carnet ready -- public key ${core.key.toString('hex')}`)

  const dumpArgIdx = process.argv.indexOf('--dump')
  if (dumpArgIdx !== -1) {
    const n = parseInt(process.argv[dumpArgIdx + 1], 10) || 10
    await dump(core, n)
    process.exit(0)
  }

  const seen = loadSeen()
  await scanAndAppend(core, seen)

  const noSwarm = process.argv.includes('--no-swarm')
  if (!noSwarm) {
    joinSwarm(store, core)
    log(`joined swarm on discovery key ${core.discoveryKey.toString('hex')} -- reachable by anyone with the public key above`)
  }

  log(`watching all_events.json for changes...`)
  let pending = null
  fs.watch(EVENTS_FILE, () => {
    // debounce -- the crawler's save can touch the file more than once per run
    clearTimeout(pending)
    pending = setTimeout(() => {
      scanAndAppend(core, seen).catch(err => log(`error: ${err.message}`))
    }, 500)
  })
}

main().catch(err => {
  console.error('[carnet] fatal:', err)
  process.exit(1)
})
