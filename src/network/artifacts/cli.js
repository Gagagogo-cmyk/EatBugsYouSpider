#!/usr/bin/env node
'use strict'

// cli.js -- manual entry point for the artifact network, same role for
// this module as carnet-daemon.js's `npm start`/`npm run dump` are for the
// carnet: a way to actually exercise publish/fetch/list/activate by hand
// or from a script, with no UI required yet.
//
// Usage:
//   node cli.js publish <path> --type model|tool|branch [--version v] [--parent id] [--server url]
//   node cli.js fetch <hash> [--server url]
//   node cli.js activate <hash>
//   node cli.js list
//   node cli.js whoami
//   node cli.js model card <hash>
//   node cli.js model vote <hash> up|down [--voter id] [--kind listener|trainer]
//   node cli.js model edit <hash> --editor name
//   node cli.js model integrate <hash> on|off
//   node cli.js model replant <hash> [--reason text] [--actor name]

const { publish } = require('./publish')
const { fetchArtifact } = require('./fetch')
const quarantine = require('./quarantine')
const registry = require('./registry')
const lineage = require('./lineage')
const votes = require('./votes')
const { identity } = require('./identity')

function flag(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx === -1 ? def : process.argv[idx + 1]
}

async function main() {
  const [, , cmd, arg] = process.argv

  if (cmd === 'model') {
    // Its own [sub, hash] pair, one level deeper than every other
    // command here -- kept as a single 'model' verb with subcommands
    // rather than five new top-level commands, since these all operate
    // on the same mutable model-card state (registry.js/lineage.js/
    // votes.js) as one family, distinct from publish/fetch/activate's
    // artifact-bytes concerns above.
    const [, , , sub, hash] = process.argv

    if (sub === 'card') {
      console.log(JSON.stringify(registry.modelCard(hash), null, 2))
      process.exit(0)
    }

    if (sub === 'vote') {
      const direction = process.argv[5]
      if (direction !== 'up' && direction !== 'down') {
        console.error('usage: node cli.js model vote <hash> up|down [--voter id] [--kind listener|trainer]')
        process.exit(1)
      }
      const result = votes.castVote(hash, flag('voter', 'anonymous'), direction === 'up' ? 1 : -1, flag('kind'))
      console.log(JSON.stringify(result, null, 2))
      process.exit(0)
    }

    if (sub === 'edit') {
      const editor = flag('editor')
      if (!editor) { console.error('usage: node cli.js model edit <hash> --editor name'); process.exit(1) }
      console.log(JSON.stringify(registry.addEditor(hash, { name: editor, nodeId: identity().publicKey.toString('hex') }), null, 2))
      process.exit(0)
    }

    if (sub === 'integrate') {
      const onOff = process.argv[5]
      if (onOff !== 'on' && onOff !== 'off') {
        console.error('usage: node cli.js model integrate <hash> on|off')
        process.exit(1)
      }
      console.log(JSON.stringify(registry.setIntegrateFollowingBranches(hash, onOff === 'on'), null, 2))
      process.exit(0)
    }

    if (sub === 'replant') {
      const result = lineage.replant(hash, { reason: flag('reason'), actor: flag('actor') || identity().publicKey.toString('hex') })
      console.log(JSON.stringify(result, null, 2))
      process.exit(0)
    }

    console.error('usage: node cli.js model <card|vote|edit|integrate|replant> <hash> [args]')
    process.exit(1)
  }

  if (cmd === 'publish') {
    const result = await publish(arg, {
      type: flag('type'),
      version: flag('version'),
      parent: flag('parent'),
      license: flag('license'),
      creator: flag('creator'),
      serverUrl: flag('server')
    })
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  }

  if (cmd === 'fetch') {
    const result = await fetchArtifact(arg, { serverUrl: flag('server') })
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  }

  if (cmd === 'activate') {
    console.log(JSON.stringify(quarantine.activate(arg), null, 2))
    process.exit(0)
  }

  if (cmd === 'list') {
    console.log(JSON.stringify(registry.list(), null, 2))
    process.exit(0)
  }

  if (cmd === 'whoami') {
    console.log(identity().publicKey.toString('hex'))
    process.exit(0)
  }

  console.error('usage: node cli.js <publish|fetch|activate|list|whoami|model> [args]')
  process.exit(1)
}

main().catch((err) => {
  console.error('[artifacts]', err.message)
  process.exit(1)
})
