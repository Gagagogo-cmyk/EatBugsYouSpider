'use strict'

// routes/radio.js -- RadioService (spec §23). One read endpoint: "what is
// Gnumbat radio doing right now." The consumer app never picks a model or
// seed itself (spec §10, §18) -- this is the single source of truth it
// polls instead. Honestly reports "no model loaded" (matching the SHOWS/CRKT
// mockup's own "-- no model loaded" empty state) rather than guessing when
// the instrument hasn't attached a model/seed to the live session yet.

const express = require('express')
const router = express.Router()
const { getCurrentRadioSession } = require('../db/queries')

// Icecast's standard status-json.xsl, if configured. Best-effort only --
// the radio state still resolves from Postgres (sessions/artifacts) when
// Icecast is unreachable or not configured; this only adds stream
// url/listener-count/now-playing-title color on top.
const ICECAST_STATUS_URL = process.env.ICECAST_STATUS_URL || null
const ICECAST_MOUNT = process.env.ICECAST_MOUNT || null
const ICECAST_STREAM_URL = process.env.ICECAST_STREAM_URL || null

async function fetchIcecastStatus() {
  if (!ICECAST_STATUS_URL) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(ICECAST_STATUS_URL, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    const json = await res.json()
    const sources = json && json.icestats && (Array.isArray(json.icestats.source) ? json.icestats.source : [json.icestats.source])
    const mount = ICECAST_MOUNT && sources ? sources.find((s) => s && s.listenurl && s.listenurl.endsWith(ICECAST_MOUNT)) : (sources && sources[0])
    if (!mount) return null
    return {
      listeners: mount.listeners ?? null,
      title: mount.title || mount.server_name || null,
      streamUrl: ICECAST_STREAM_URL || mount.listenurl || null
    }
  } catch (err) {
    return null // Icecast down/unreachable -- degrade gracefully, never 500 the whole radio state over it
  }
}

// GET /radio/current
router.get('/current', async (req, res) => {
  try {
    const session = await getCurrentRadioSession()
    const icecast = await fetchIcecastStatus()

    if (!session) {
      return res.json({ live: false, model: null, seedHash: null, stream: icecast ? { url: icecast.streamUrl } : null })
    }

    const hasModel = !!session.model_artifact_id
    res.json({
      live: true,
      sessionId: session.id,
      startedAt: session.started_at,
      model: hasModel ? {
        hash: session.model_artifact_id,
        name: (session.model_manifest && session.model_manifest.displayName) || null,
        version: session.model_version,
        releaseState: session.model_release_state
      } : null,
      seedHash: session.seed_hash || null,
      stream: {
        url: (icecast && icecast.streamUrl) || ICECAST_STREAM_URL || null,
        listeners: icecast ? icecast.listeners : null,
        title: icecast ? icecast.title : null
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
