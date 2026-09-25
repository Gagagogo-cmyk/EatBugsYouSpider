'use strict'

// routes/feedback.js -- FeedbackService (spec §23). The ONLY mutating
// consumer-facing route besides /tips. Deliberately not a playlist
// like/dislike: every call is a full structured event (spec §4-5) so the
// eventual PyTorch trainer has real context to learn from -- see
// docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md for the path from here to
// a new model version. Pressing Like/Dislike must never block or interrupt
// playback (spec §11) -- this is a single fire-and-forget POST.

const express = require('express')
const router = express.Router()
const {
  insertFeedback,
  createFeedbackTrainingBatch,
  getFeedbackTrainingBatch,
  listFeedbackForBatch,
  updateFeedbackTrainingBatchStatus
} = require('../db/queries')

// POST /feedback
// Body: {
//   listenerId,            // required -- stable client id (localStorage), no login
//   feedback,               // required -- 'like' | 'dislike'
//   sessionId,               // optional -- which live session this was heard on
//   modelHash, modelVersion, seedHash,   // optional -- what was actually playing
//   arrangementRef,          // optional -- {trackId, sliceId, descriptors, ...}, whatever's known
//   positionMs,               // optional -- playback position when pressed
//   playStartedAt, playDurationMs, skipped, completed, replayed  // optional passive signals (spec §4) -- never surfaced as UI controls
// }
router.post('/', async (req, res) => {
  const {
    listenerId, feedback, sessionId,
    modelHash, modelVersion, seedHash,
    arrangementRef, positionMs,
    playStartedAt, playDurationMs, skipped, completed, replayed
  } = req.body || {}

  if (!listenerId) return res.status(400).json({ error: 'listenerId required' })
  if (feedback !== 'like' && feedback !== 'dislike') return res.status(400).json({ error: "feedback must be 'like' or 'dislike'" })

  try {
    const row = await insertFeedback({
      listenerId,
      sessionId: sessionId || null,
      modelArtifactId: modelHash || null,
      modelVersion: modelVersion || null,
      seedHash: seedHash || null,
      arrangementRef: arrangementRef || null,
      positionMs: positionMs || null,
      feedback,
      playStartedAt: playStartedAt || null,
      playDurationMs: playDurationMs || null,
      skipped: skipped ?? null,
      completed: completed ?? null,
      replayed: replayed ?? null
    })
    res.status(201).json({ ok: true, id: row.id, createdAt: row.created_at })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// -- Feedback training batches (spec §20-21: "queued -> training batch ->
// new model version," architecture only, no real trainer here). Not
// listener-facing -- called by src/demucs/export_feedback_dataset.py, the
// manual-run script an operator kicks off, same posture as add_tension.py
// or LoRA training ("always a manual step, never automatic" -- CLAUDE.md).
// No auth on these today, matching every other route in this file/module
// that isn't already behind requireAuth (routes/slices.js) -- worth
// revisiting before this is exposed publicly, same caveat the event
// scraper's own "Add a venue" form already carries (event-crawler/README.md).

// POST /feedback/batches -- queue a batch: every feedback_events row for
// one model within [fromTs, toTs).
// Body: { modelHash, fromTs, toTs }
router.post('/batches', async (req, res) => {
  const { modelHash, fromTs, toTs } = req.body || {}
  if (!modelHash || !fromTs || !toTs) return res.status(400).json({ error: 'modelHash, fromTs, toTs required' })
  try {
    const batch = await createFeedbackTrainingBatch(modelHash, fromTs, toTs)
    res.status(201).json(batch)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /feedback/batches/:id/export -- the batch's raw feedback rows, for
// export_feedback_dataset.py to turn into a dataset file.
router.get('/batches/:id/export', async (req, res) => {
  try {
    const batch = await getFeedbackTrainingBatch(req.params.id)
    if (!batch) return res.status(404).json({ error: 'not found' })
    const events = await listFeedbackForBatch(batch)
    res.json({ batch, events })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /feedback/batches/:id/complete -- flip a batch's status once the
// dataset file has been written (or the write failed).
// Body: { status: 'processing'|'complete'|'failed', resultingModelHash? }
router.post('/batches/:id/complete', async (req, res) => {
  const { status, resultingModelHash } = req.body || {}
  if (!['processing', 'complete', 'failed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'processing', 'complete', or 'failed'" })
  }
  try {
    const batch = await updateFeedbackTrainingBatchStatus(req.params.id, status, resultingModelHash || null)
    if (!batch) return res.status(404).json({ error: 'not found' })
    res.json(batch)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
