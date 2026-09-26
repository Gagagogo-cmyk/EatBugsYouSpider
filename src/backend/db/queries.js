const { Pool } = require('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Get the full session log for a session
// Returns DJ, all contributing artists, and the aggregate mix stats
async function getSessionLog(sessionId) {
  // Get session + DJ
  const sessionResult = await pool.query(
    `SELECT s.*, u.stripe_account_id as dj_stripe_account
     FROM sessions s
     JOIN users u ON u.id = s.dj_id
     WHERE s.id = $1`,
    [sessionId]
  )
  const session = sessionResult.rows[0]

  // Get all slices, grouped by track/artist
  // Sum duration per artist — that's their proportional weight
  const slicesResult = await pool.query(
    `SELECT
       u.id as artist_id,
       u.stripe_account_id,
       SUM(sl.duration_ms) as total_ms
     FROM slices sl
     JOIN tracks t ON t.id = sl.track_id
     JOIN users u ON u.id = t.artist_id
     WHERE sl.session_id = $1
     GROUP BY u.id, u.stripe_account_id`,
    [sessionId]
  )

  const artists = slicesResult.rows.map(row => ({
    artistId: row.artist_id,
    stripeAccountId: row.stripe_account_id,
    totalMs: parseInt(row.total_ms)
  }))

  return {
    dj: { stripeAccountId: session.dj_stripe_account },
    artists,
    mode: session.mode,
    deck: session.deck || 'gnumbat'
  }
}

// Open a session when the DJ starts playing
// deck: 'gnumbat' (full split equation) | 'direct' (100% to DJ, no artist split)
async function openSession(djId, venue, mode, deck = 'gnumbat', modelArtifactId = null, seedHash = null) {
  // modelArtifactId/seedHash -- which released model/seed is actually driving
  // this session, if the instrument reports one. Both nullable: today's
  // instrument control layer (src/max/ws_server.js) has no notion of "current
  // model artifact" yet (see docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md),
  // so a 'web' session opened without them is a legitimate, common case --
  // RadioService (routes/radio.js) reports that honestly as "no model loaded"
  // rather than guessing, matching the consumer mockup's own empty state.
  const result = await pool.query(
    `INSERT INTO sessions (dj_id, venue, mode, deck, model_artifact_id, seed_hash) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [djId, venue, mode, deck, modelArtifactId, seedHash]
  )
  return result.rows[0]
}

// setSessionModel -- lets a session's model/seed be attached or updated
// after open (e.g. the instrument decides/changes its current seed mid-set).
async function setSessionModel(sessionId, modelArtifactId, seedHash = null) {
  const result = await pool.query(
    `UPDATE sessions SET model_artifact_id = $2, seed_hash = $3 WHERE id = $1 RETURNING *`,
    [sessionId, modelArtifactId, seedHash]
  )
  return result.rows[0]
}

// getCurrentRadioSession -- the active 'web' session, if any, joined to its
// model's manifest (for name/version) -- what RadioService's GET
// /radio/current reports as "what's actually playing right now."
async function getCurrentRadioSession() {
  await ensureSocialColumn()
  const result = await pool.query(
    `SELECT s.*, a.manifest as model_manifest, a.version as model_version,
            a.release_state as model_release_state,
            u.username as dj_username, u.social_links as dj_social_links,
            (u.stripe_account_id IS NOT NULL) as dj_can_tip
     FROM sessions s
     LEFT JOIN artifacts a ON a.id = s.model_artifact_id
     LEFT JOIN users u ON u.id = s.dj_id
     WHERE s.mode = 'web' AND s.status = 'active'
     ORDER BY s.started_at DESC
     LIMIT 1`
  )
  return result.rows[0] || null
}

// listReleasedModels -- ModelService: every artifact whose release_state
// makes it consumer-eligible (spec: only 'released'/'evolving' -- never
// development/training/testing/ready, and never anything else regardless
// of local trainingState/votes).
async function listReleasedModels() {
  const result = await pool.query(
    `SELECT id, hash, version, parent_id, release_state, released_at, manifest, created_at
     FROM artifacts
     WHERE type = 'model' AND release_state IN ('released', 'evolving')
     ORDER BY released_at DESC NULLS LAST, created_at DESC`
  )
  return result.rows
}

// getModelCard -- single released model, or null if it doesn't exist / isn't
// consumer-eligible. Deliberately the same eligibility filter as
// listReleasedModels() -- a direct hash lookup never leaks an unreleased model.
async function getModelCard(hash) {
  const result = await pool.query(
    `SELECT id, hash, version, parent_id, release_state, released_at, manifest, created_at
     FROM artifacts
     WHERE hash = $1 AND type = 'model' AND release_state IN ('released', 'evolving')`,
    [hash]
  )
  return result.rows[0] || null
}

// getModelLineage -- seed/branch tree for the CRKT screen (read-only). Walks
// via manifest.parent (JSONB) since that's the same signed provenance field
// src/network/artifacts/lineage.js's seedIdFor() walks locally -- this is
// just a server-side read of the same shape, not a second lineage system.
async function getModelLineage(hash) {
  const all = await pool.query(
    `SELECT id, hash, version, parent_id, release_state, manifest FROM artifacts WHERE type = 'model'`
  )
  const byId = new Map(all.rows.map((r) => [r.id, r]))
  const bareParent = (r) => {
    const p = r.manifest && r.manifest.parent
    if (!p) return null
    return p.startsWith('sha256:') ? p.slice(7) : p
  }
  // walk to the root
  let current = all.rows.find((r) => r.hash === hash)
  if (!current) return null
  const seen = new Set()
  let root = current
  while (root && bareParent(root) && !seen.has(root.id)) {
    seen.add(root.id)
    const parentHash = bareParent(root)
    const next = all.rows.find((r) => r.hash === parentHash)
    if (!next) break
    root = next
  }
  // collect every descendant of root, depth-first
  const childrenOf = (id) => all.rows.filter((r) => {
    const p = bareParent(r)
    return p && byId.get(r.id) && r.parent_id === id
  })
  function toNode(r) {
    return {
      hash: r.hash,
      version: r.version,
      releaseState: r.release_state,
      name: (r.manifest && r.manifest.displayName) || null,
      branches: childrenOf(r.id).map(toNode)
    }
  }
  return toNode(root)
}

// Find or create a track record by source name.
// Gnumbat identifies tracks by filename (e.g. "DREPTO CE3o") — we use that as the fingerprint.
// artist_id is left NULL until the artist registers a Stripe account.
async function upsertTrack(name) {
  const result = await pool.query(
    `INSERT INTO tracks (title, fingerprint)
     VALUES ($1, $2)
     ON CONFLICT (fingerprint) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    [name, name]
  )
  return result.rows[0].id
}

// Log a slice as Gnumbat plays it.
// trackName = Gnumbat source track name (e.g. "DREPTO CE3o") — looked up/created automatically.
// durationMs = segment duration in ms (from slicer.js snapSegDurMs).
async function logSlice(sessionId, trackName, durationMs) {
  const trackId = await upsertTrack(trackName)
  await pool.query(
    `INSERT INTO slices (session_id, track_id, duration_ms)
     VALUES ($1, $2, $3)`,
    [sessionId, trackId, Math.round(durationMs)]
  )
}

// Get artist contributions by duration — what % of the set did each artist's tracks occupy?
// upToTime: for web tips (cut at exact tip moment). null = full session (venue).
//
// Note: follow-weighted variant (duration × avg follow weight per time window) was considered
// but dropped in favour of pure duration — simpler, more predictable for artists.
// The follow_states table and logFollowState() are kept for potential future use.
async function getWeightedContributions(sessionId, upToTime = null) {
  const timeFilter = upToTime ? `AND sl.played_at <= $2` : ''
  const params = upToTime ? [sessionId, upToTime] : [sessionId]

  const result = await pool.query(
    `SELECT
       u.id                    AS artist_id,
       u.stripe_account_id,
       SUM(sl.duration_ms)     AS total_ms
     FROM slices sl
     JOIN tracks t ON t.id = sl.track_id
     JOIN users  u ON u.id = t.artist_id
     WHERE sl.session_id = $1 ${timeFilter}
     GROUP BY u.id, u.stripe_account_id
     ORDER BY total_ms DESC`,
    params
  )

  // Normalize to proportions (0.0 to 1.0, sums to 1.0)
  const totalMs = result.rows.reduce((sum, r) => sum + parseFloat(r.total_ms), 0)

  return result.rows.map(row => ({
    artistId: row.artist_id,
    stripeAccountId: row.stripe_account_id,
    proportion: parseFloat(row.total_ms) / totalMs
  }))
}

// Log a periodic system state ping from Gnumbat
// seg_avg is pre-computed in ws_server.js; individual stems stored for per-stem history
async function logPing(sessionId, simultaneousN, segVoc, segMel, segBas, segDrm, segVariance) {
  await pool.query(
    `INSERT INTO pings (session_id, simultaneous_n, seg_voc, seg_mel, seg_bas, seg_drm, seg_variance)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sessionId, simultaneousN, segVoc, segMel, segBas, segDrm, segVariance]
  )
}

// Get avg stats from ping log
// upToTime: for web tips (cut at tip moment). null = full session (venue).
async function getAvgSessionStats(sessionId, upToTime = null) {
  const timeFilter = upToTime ? `AND recorded_at <= $2` : ''
  const params = upToTime ? [sessionId, upToTime] : [sessionId]

  const result = await pool.query(
    `SELECT
       AVG(simultaneous_n) AS avg_n,
       AVG(seg_voc)        AS avg_voc,
       AVG(seg_mel)        AS avg_mel,
       AVG(seg_bas)        AS avg_bas,
       AVG(seg_drm)        AS avg_drm,
       AVG(seg_variance)   AS avg_variance
     FROM pings
     WHERE session_id = $1 ${timeFilter}`,
    params
  )

  const row = result.rows[0]
  return {
    avgN: parseFloat(row?.avg_n) || 1.0,
    segmentLengths: {
      VOC:      parseFloat(row?.avg_voc)      || 8,
      MEL:      parseFloat(row?.avg_mel)      || 8,
      BAS:      parseFloat(row?.avg_bas)      || 8,
      DRM:      parseFloat(row?.avg_drm)      || 8,
      variance: parseFloat(row?.avg_variance) || 0,
    }
  }
}

// Create a new user (registration)
async function createUser({ username, passwordHash, email, is_dj, is_artist }) {
  const result = await pool.query(
    `INSERT INTO users (username, password_hash, email, is_dj, is_artist)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, username, is_dj, is_artist`,
    [username, passwordHash, email, is_dj, is_artist]
  )
  return result.rows[0]
}

// Find user by username (login)
async function findUserByUsername(username) {
  const result = await pool.query(
    `SELECT * FROM users WHERE username = $1`,
    [username]
  )
  return result.rows[0] || null
}

// Close a session (end of venue set)
async function closeSession(sessionId) {
  await pool.query(
    `UPDATE sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`,
    [sessionId]
  )
}

// Get all pending venue tips for a session (to batch split on close)
async function getPendingVenueTips(sessionId) {
  const result = await pool.query(
    `SELECT * FROM tips
     WHERE session_id = $1 AND mode = 'venue' AND status = 'pending'`,
    [sessionId]
  )
  return result.rows
}

// Record a payout
async function recordPayout(tipId, userId, amountCents, stripeTransferId) {
  await pool.query(
    `INSERT INTO payouts (tip_id, user_id, amount_cents, stripe_transfer_id)
     VALUES ($1, $2, $3, $4)`,
    [tipId, userId, amountCents, stripeTransferId]
  )
}

// Mark a tip as split
async function markTipSplit(tipId) {
  await pool.query(
    `UPDATE tips SET status = 'split' WHERE id = $1`,
    [tipId]
  )
}

// ---- Network layer (Models/Tools/Branches) -- docs/platform/ARTIFACT_NETWORK.md ----
// Metadata only, mirrors the pattern every other function in this file
// already uses (raw pg queries via the shared pool). Artifact bytes never
// pass through here -- see routes/network.js for where the blob itself is
// written to disk.

async function upsertNode(id, kind, displayName) {
  await pool.query(
    `INSERT INTO nodes (id, kind, display_name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET last_seen = NOW(), display_name = COALESCE($3, nodes.display_name)`,
    [id, kind, displayName || null]
  )
}

async function registerArtifact(manifest) {
  await pool.query(
    `INSERT INTO artifacts (id, type, hash, origin_node, version, parent_id, license, signature, manifest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [manifest.id, manifest.type, manifest.hash, manifest.origin, manifest.version,
      manifest.parent, manifest.license, manifest.signature, manifest]
  )
}

async function noteReplica(artifactId, nodeId, kind) {
  await pool.query(
    `INSERT INTO artifact_replicas (artifact_id, node_id, kind)
     VALUES ($1, $2, $3)
     ON CONFLICT (artifact_id, node_id) DO UPDATE SET last_seen = NOW(), kind = $3`,
    [artifactId, nodeId, kind]
  )
}

async function getArtifactManifest(hash) {
  const result = await pool.query(`SELECT manifest FROM artifacts WHERE hash = $1`, [hash])
  return result.rows[0] ? result.rows[0].manifest : null
}

async function getArtifactIdByHash(hash) {
  const result = await pool.query(`SELECT id FROM artifacts WHERE hash = $1`, [hash])
  return result.rows[0] ? result.rows[0].id : null
}

async function listArtifacts(type) {
  const params = []
  let query = `SELECT id, type, hash, origin_node, version, parent_id, license, created_at FROM artifacts`
  if (type) {
    params.push(type)
    query += ` WHERE type = $1`
  }
  query += ` ORDER BY created_at DESC LIMIT 200`
  const result = await pool.query(query, params)
  return result.rows
}

// insertFeedback -- FeedbackService's one write path. Deliberately just an
// INSERT: no upsert-by-listener, no "latest wins" collapsing -- every
// like/dislike is its own row with its own playback context, because the
// point is training-signal density over time, not a per-listener preference
// toggle (see docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md).
async function insertFeedback({
  listenerId, sessionId, modelArtifactId, modelVersion, seedHash,
  arrangementRef, positionMs, feedback,
  playStartedAt, playDurationMs, skipped, completed, replayed
}) {
  const result = await pool.query(
    `INSERT INTO feedback_events
       (listener_id, session_id, model_artifact_id, model_version, seed_hash,
        arrangement_ref, position_ms, feedback,
        play_started_at, play_duration_ms, skipped, completed, replayed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, created_at`,
    [listenerId, sessionId || null, modelArtifactId || null, modelVersion || null, seedHash || null,
      arrangementRef ? JSON.stringify(arrangementRef) : null, positionMs || null, feedback,
      playStartedAt || null, playDurationMs || null, skipped ?? null, completed ?? null, replayed ?? null]
  )
  return result.rows[0]
}

// -- Feedback training batches: the "clean path" from accumulated listener
// feedback to a dataset file the (future) PyTorch trainer can consume.
// See docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md and
// src/demucs/export_feedback_dataset.py, the manual-run script that calls
// these through routes/feedback.js's /feedback/batches endpoints.

async function createFeedbackTrainingBatch(modelArtifactId, fromTs, toTs) {
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM feedback_events WHERE model_artifact_id = $1 AND created_at >= $2 AND created_at < $3`,
    [modelArtifactId, fromTs, toTs]
  )
  const result = await pool.query(
    `INSERT INTO feedback_training_batches (model_artifact_id, from_ts, to_ts, feedback_count, status)
     VALUES ($1, $2, $3, $4, 'queued') RETURNING *`,
    [modelArtifactId, fromTs, toTs, parseInt(countResult.rows[0].count, 10)]
  )
  return result.rows[0]
}

async function getFeedbackTrainingBatch(id) {
  const result = await pool.query(`SELECT * FROM feedback_training_batches WHERE id = $1`, [id])
  return result.rows[0] || null
}

async function listFeedbackForBatch(batch) {
  const result = await pool.query(
    `SELECT * FROM feedback_events WHERE model_artifact_id = $1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at ASC`,
    [batch.model_artifact_id, batch.from_ts, batch.to_ts]
  )
  return result.rows
}

async function updateFeedbackTrainingBatchStatus(id, status, resultingArtifactId = null) {
  const result = await pool.query(
    `UPDATE feedback_training_batches
     SET status = $2, resulting_artifact_id = $3,
         completed_at = CASE WHEN $2 IN ('complete', 'failed') THEN NOW() ELSE completed_at END
     WHERE id = $1 RETURNING *`,
    [id, status, resultingArtifactId]
  )
  return result.rows[0]
}

// ---- password reset (see routes/auth.js /forgot + /reset) ----------------------------
// The two reset columns are added on first use (idempotent), so an existing database needs no
// manual migration; schema.sql carries the same ALTER for fresh installs.
let resetColumnsReady = null
function ensureResetColumns() {
  if (!resetColumnsReady) {
    resetColumnsReady = pool.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(64),
                         ADD COLUMN IF NOT EXISTS reset_expires    TIMESTAMP`
    ).catch(err => { resetColumnsReady = null; throw err })
  }
  return resetColumnsReady
}

// social_links column (DJ socials above the play bar) -- same lazy-migration
// pattern as ensureResetColumns(), so existing databases need no manual step.
let socialColumnReady = null
function ensureSocialColumn() {
  if (!socialColumnReady) {
    socialColumnReady = pool.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '[]'::jsonb`
    ).catch(err => { socialColumnReady = null; throw err })
  }
  return socialColumnReady
}

async function setSocialLinks(userId, links) {
  await ensureSocialColumn()
  const result = await pool.query(
    `UPDATE users SET social_links = $2::jsonb WHERE id = $1 RETURNING social_links`,
    [userId, JSON.stringify(links)]
  )
  return result.rows[0] ? result.rows[0].social_links : null
}

// username OR email (case-insensitive for email)
async function findUserByLogin(login) {
  const result = await pool.query(
    `SELECT * FROM users WHERE username = $1 OR LOWER(email) = LOWER($1) LIMIT 1`,
    [login]
  )
  return result.rows[0] || null
}

async function setResetToken(userId, tokenHash, expires) {
  await ensureResetColumns()
  await pool.query(`UPDATE users SET reset_token_hash = $2, reset_expires = $3 WHERE id = $1`, [userId, tokenHash, expires])
}

async function findUserByResetHash(tokenHash) {
  await ensureResetColumns()
  const result = await pool.query(
    `SELECT * FROM users WHERE reset_token_hash = $1 AND reset_expires > NOW() LIMIT 1`,
    [tokenHash]
  )
  return result.rows[0] || null
}

async function setPasswordAndClearReset(userId, passwordHash) {
  await ensureResetColumns()
  await pool.query(
    `UPDATE users SET password_hash = $2, reset_token_hash = NULL, reset_expires = NULL WHERE id = $1`,
    [userId, passwordHash]
  )
}

// renameUser -- the dev account rename (server.js DEV ACCOUNT, user: "change
// my account name from abc to ap3"): same user row, so everything tied to
// its id stays with it.
async function renameUser(id, username) {
  await pool.query(`UPDATE users SET username = $2 WHERE id = $1`, [id, username])
}

// -- Bookings (routes/bookings.js) -- see schema.sql's bookings table.
let bookingsTableReady = null
function ensureBookingsTable() {
  if (!bookingsTableReady) {
    bookingsTableReady = pool.query(
      `CREATE TABLE IF NOT EXISTS bookings (
         id          SERIAL PRIMARY KEY,
         model_ref   VARCHAR(255) NOT NULL,
         model_name  VARCHAR(255),
         starts_at   TIMESTAMPTZ NOT NULL,
         hours       NUMERIC(4,1) NOT NULL CHECK (hours > 0 AND hours <= 24),
         venue       VARCHAR(255) NOT NULL,
         contact     VARCHAR(255) NOT NULL,
         status      VARCHAR(20) DEFAULT 'requested' CHECK (status IN ('requested','confirmed','cancelled')),
         created_at  TIMESTAMP DEFAULT NOW()
       );
       CREATE INDEX IF NOT EXISTS bookings_model_idx ON bookings(model_ref, starts_at);`
    ).catch(err => { bookingsTableReady = null; throw err })
  }
  return bookingsTableReady
}

// upcoming (not cancelled) bookings, optionally for one model
async function listBookings(modelRef) {
  await ensureBookingsTable()
  const result = await pool.query(
    `SELECT id, model_ref, model_name, starts_at, hours, venue, status
     FROM bookings
     WHERE status <> 'cancelled'
       AND starts_at + (hours * INTERVAL '1 hour') > NOW()
       AND ($1::text IS NULL OR model_ref = $1)
     ORDER BY starts_at
     LIMIT 50`,
    [modelRef || null]
  )
  return result.rows
}

// inserts unless the model is already booked for an overlapping slot;
// returns { booking } or { conflict }
async function createBooking({ modelRef, modelName, startsAt, hours, venue, contact }) {
  await ensureBookingsTable()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // one booking at a time per model, so two requests can't both pass the check
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [modelRef])
    const clash = await client.query(
      `SELECT id, starts_at, hours, venue FROM bookings
       WHERE model_ref = $1 AND status <> 'cancelled'
         AND starts_at < $2::timestamptz + ($3 * INTERVAL '1 hour')
         AND starts_at + (hours * INTERVAL '1 hour') > $2::timestamptz
       LIMIT 1`,
      [modelRef, startsAt, hours]
    )
    if (clash.rows[0]) { await client.query('ROLLBACK'); return { conflict: clash.rows[0] } }
    const result = await client.query(
      `INSERT INTO bookings (model_ref, model_name, starts_at, hours, venue, contact)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, model_ref, model_name, starts_at, hours, venue, status`,
      [modelRef, modelName || null, startsAt, hours, venue, contact]
    )
    await client.query('COMMIT')
    return { booking: result.rows[0] }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  renameUser,
  createUser,
  findUserByUsername,
  findUserByLogin,
  setResetToken,
  findUserByResetHash,
  setPasswordAndClearReset,
  openSession,
  setSessionModel,
  getCurrentRadioSession,
  setSocialLinks,
  listReleasedModels,
  getModelCard,
  getModelLineage,
  getSessionLog,
  getWeightedContributions,
  getAvgSessionStats,
  upsertTrack,
  logSlice,
  logPing,
  closeSession,
  getPendingVenueTips,
  recordPayout,
  markTipSplit,
  upsertNode,
  registerArtifact,
  noteReplica,
  getArtifactManifest,
  getArtifactIdByHash,
  listArtifacts,
  insertFeedback,
  createFeedbackTrainingBatch,
  getFeedbackTrainingBatch,
  listFeedbackForBatch,
  updateFeedbackTrainingBatchStatus,
  listBookings,
  createBooking
}
