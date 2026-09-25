#!/usr/bin/env node
'use strict'

// mirror.js -- stage 2 test harness / reference client. Holds a read-only
// replica of SOMEONE ELSE's carnet, identified only by its public key (the
// value carnet-daemon.js prints on startup as "carnet ready -- public key
// ..."). Never touches all_events.json -- everything it has comes over the
// wire from whoever's actually running that carnet.
//
// Usage: node mirror.js <hex-public-key> [--want N] [--dump N]
//   --want N   wait until block index N-1 has actually arrived (proves a
//              specific block replicated, not just that a connection opened)
//   --dump N   after --want succeeds (or immediately if --want omitted),
//              print the last N blocks

const path = require('path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')

function log(msg) {
  console.log(`[mirror] ${new Date().toISOString()} ${msg}`)
}

async function main() {
  const keyHex = process.argv[2]
  if (!keyHex || keyHex.startsWith('--')) {
    console.error('usage: node mirror.js <hex-public-key> [--want N] [--dump N]')
    process.exit(1)
  }
  const key = Buffer.from(keyHex, 'hex')
  const storeDir = path.join(__dirname, '..', '..', 'data', `carnet-mirror-${keyHex.slice(0, 8)}`)

  const store = new Corestore(storeDir)
  const core = store.get(key) // foreign core -- keyed by the public key itself, not a local {name}
  await core.ready()
  log(`opened -- currently have ${core.length} block(s) locally (storage: ${storeDir})`)

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn, info) => {
    log(`peer connected (${info.client ? 'outgoing' : 'incoming'}) -- replicating`)
    store.replicate(conn)
  })
  swarm.join(core.discoveryKey, { server: true, client: true })
  log(`joined swarm on discovery key ${core.discoveryKey.toString('hex')} -- looking for peers...`)

  const wantIdx = process.argv.indexOf('--want')
  if (wantIdx !== -1) {
    const want = parseInt(process.argv[wantIdx + 1], 10)
    log(`waiting for block #${want - 1} to actually arrive over the wire...`)
    const block = await core.get(want - 1) // blocks until a peer supplies it
    const parsed = JSON.parse(block.toString())
    log(`got block #${want - 1}: ${parsed.venue_name} -- ${parsed.event.name} (${parsed.event.date})`)
    log(`REPLICATION CONFIRMED -- now have ${core.length} block(s) locally, none of it read from all_events.json`)
  }

  const dumpIdx = process.argv.indexOf('--dump')
  if (dumpIdx !== -1) {
    const n = parseInt(process.argv[dumpIdx + 1], 10) || 10
    const from = Math.max(0, core.length - n)
    for (let i = from; i < core.length; i++) {
      const block = await core.get(i)
      const parsed = JSON.parse(block.toString())
      console.log(`#${i} [${parsed.appended_at}] ${parsed.venue_name} -- ${parsed.event.name} (${parsed.event.date})`)
    }
  }

  if (wantIdx !== -1 || dumpIdx !== -1) process.exit(0)

  setInterval(() => log(`have ${core.length} block(s) locally`), 5000)
}

main().catch(err => {
  console.error('[mirror] fatal:', err)
  process.exit(1)
})
