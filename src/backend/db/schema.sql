-- Gnumbat Database Schema

-- Artists and DJs
CREATE TABLE users (
  id                SERIAL PRIMARY KEY,
  username          VARCHAR(255) UNIQUE NOT NULL,  -- public DJ name
  password_hash     VARCHAR(255),                  -- null until account claimed
  email             VARCHAR(255) UNIQUE,
  is_dj             BOOLEAN DEFAULT false,
  is_artist         BOOLEAN DEFAULT false,
  stripe_account_id VARCHAR(255),                  -- Stripe Connect account
  solana_wallet     VARCHAR(255),                  -- for CRKT conversion (optional)
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Tracks in the Gnumbat corpus
CREATE TABLE tracks (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(255),
  artist_id     INTEGER REFERENCES users(id),
  fingerprint   VARCHAR(255) UNIQUE,  -- audio fingerprint
  created_at    TIMESTAMP DEFAULT NOW()
);

-- A session = one DJ set
CREATE TABLE sessions (
  id            SERIAL PRIMARY KEY,
  dj_id         INTEGER REFERENCES users(id),
  venue         VARCHAR(255),         -- null if web radio
  mode          VARCHAR(50),          -- 'web' or 'venue' (tip timing)
  deck          VARCHAR(50) DEFAULT 'gnumbat',  -- 'gnumbat' or 'direct' (split mode)
  status        VARCHAR(50) DEFAULT 'active',  -- 'active' or 'closed'
  started_at    TIMESTAMP DEFAULT NOW(),
  closed_at     TIMESTAMP
);

-- Every slice Gnumbat plays gets logged
CREATE TABLE slices (
  id            SERIAL PRIMARY KEY,
  session_id    INTEGER REFERENCES sessions(id),
  track_id      INTEGER REFERENCES tracks(id),
  duration_ms   INTEGER,              -- how long this slice played
  played_at     TIMESTAMP DEFAULT NOW()
);

-- Periodic system state ping — fired every 4 bars (based on current BPM)
-- Captures full state regardless of what caused it: manual command or probabilistic engine
-- Used to compute avg segment length variance (L3) and avg simultaneous N
CREATE TABLE pings (
  id             SERIAL PRIMARY KEY,
  session_id     INTEGER REFERENCES sessions(id),
  simultaneous_n FLOAT,   -- distinct source tracks across stems right now
  seg_voc        FLOAT,   -- segment length for vocals stem (bars)
  seg_mel        FLOAT,   -- segment length for melody stem (bars)
  seg_bas        FLOAT,   -- segment length for bass stem (bars)
  seg_drm        FLOAT,   -- segment length for drums stem (bars)
  seg_variance   FLOAT,   -- variance across the 4 stems (pre-computed) — L3 signal
  recorded_at    TIMESTAMP DEFAULT NOW()
);

-- Tips from listeners
CREATE TABLE tips (
  id                        SERIAL PRIMARY KEY,
  session_id                INTEGER REFERENCES sessions(id),
  amount_cents              INTEGER,
  stripe_payment_intent_id  VARCHAR(255) UNIQUE,
  status                    VARCHAR(50) DEFAULT 'pending', -- 'pending', 'split', 'failed'
  mode                      VARCHAR(50),  -- 'web' or 'venue'
  created_at                TIMESTAMP DEFAULT NOW()
);

-- Record of each payout after split runs
CREATE TABLE payouts (
  id            SERIAL PRIMARY KEY,
  tip_id        INTEGER REFERENCES tips(id),
  user_id       INTEGER REFERENCES users(id),
  amount_cents  INTEGER,
  stripe_transfer_id VARCHAR(255),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Network layer: artifact registry (Models, Tools, Branches).
-- See docs/platform/ARTIFACT_NETWORK.md. This is metadata only -- "a phone
-- book, not a giant centralized database" (docs/platform/NETWORK.md). The
-- actual artifact bytes live in data/network/server-store/ on this server,
-- and in each node's own local Corestore elsewhere -- never in these rows.
-- ============================================================

-- A node participating in the network: this server, a dedicated peer
-- node, or an ordinary user's EBYS instance acting as a temporary peer.
-- id is the node's hex ed25519 public key -- see
-- src/network/artifacts/identity.js.
CREATE TABLE nodes (
  id            VARCHAR(64) PRIMARY KEY,
  kind          VARCHAR(20) NOT NULL,      -- 'server' | 'dedicated' | 'peer'
  display_name  VARCHAR(255),
  first_seen    TIMESTAMP DEFAULT NOW(),
  last_seen     TIMESTAMP DEFAULT NOW()
);

-- A published Model, Tool, or Branch. Content-addressed by hash --
-- publishing a modification never overwrites this row, it inserts a new
-- one with parent_id pointing back (the Alice/Bob fork example in
-- docs/platform/ARTIFACT_NETWORK.md).
CREATE TABLE artifacts (
  id              VARCHAR(255) PRIMARY KEY,  -- "sha256:<hash>", matches the manifest's own id
  type            VARCHAR(20) NOT NULL,      -- 'model' | 'tool' | 'branch'
  hash            VARCHAR(64) NOT NULL UNIQUE,
  origin_node     VARCHAR(64) REFERENCES nodes(id),
  creator_user_id INTEGER REFERENCES users(id),
  version         VARCHAR(50),
  parent_id       VARCHAR(255) REFERENCES artifacts(id),
  license         VARCHAR(50),
  signature       TEXT NOT NULL,             -- ed25519 signature, hex
  manifest        JSONB NOT NULL,            -- full manifest as published, for re-verification
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Where a copy of an artifact is currently known to live. Rebuilt from
-- announce pings (POST /network/nodes/announce) -- a cache of
-- availability, not the artifact's only copy of truth.
CREATE TABLE artifact_replicas (
  id            SERIAL PRIMARY KEY,
  artifact_id   VARCHAR(255) REFERENCES artifacts(id),
  node_id       VARCHAR(64) REFERENCES nodes(id),
  kind          VARCHAR(20) NOT NULL,   -- 'server' | 'node' | 'peer'
  last_seen     TIMESTAMP DEFAULT NOW(),
  UNIQUE(artifact_id, node_id)
);

-- ============================================================
-- Consumer app: model release lifecycle, radio/session linkage,
-- and structured listener feedback.
-- See docs/instrument/CONSUMER_FEEDBACK_PIPELINE.md for the full
-- feedback -> training-batch -> new-version path this feeds.
-- ============================================================

-- Model release lifecycle (orthogonal to the local, per-node
-- registry.js `trainingState` field -- that's "has this been
-- trained at all"; this is "is this allowed in front of listeners
-- yet"). Only 'released'/'evolving' are ever consumer-eligible.
-- Mirrored locally as `releaseState` in
-- src/network/artifacts/registry.js (registry.setReleaseState()),
-- pushed here whenever a model artifact is (re-)registered.
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS release_state VARCHAR(20) NOT NULL DEFAULT 'development'
  CHECK (release_state IN ('development','training','testing','ready','released','evolving'));
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS released_at TIMESTAMP;

-- Which model/seed a live 'web' session is actually running --
-- previously sessions had no link to what's playing at all.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS model_artifact_id VARCHAR(255) REFERENCES artifacts(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS seed_hash VARCHAR(255);

-- Structured listener feedback (spec: NOT a playlist like/dislike --
-- enough context to later learn from the reaction). listener_id is a
-- stable client-generated id (localStorage), no account/login, same
-- no-account posture as src/network/artifacts/votes.js's voterId.
-- Like/dislike counts are computed at read time (COUNT ... GROUP BY
-- feedback) rather than a denormalized counter, matching votes.js's
-- own "always a plain recount, never a running total" rule.
CREATE TABLE IF NOT EXISTS feedback_events (
  id                SERIAL PRIMARY KEY,
  listener_id       VARCHAR(255) NOT NULL,
  session_id        INTEGER REFERENCES sessions(id),
  model_artifact_id VARCHAR(255) REFERENCES artifacts(id),
  model_version     VARCHAR(50),
  seed_hash         VARCHAR(255),
  arrangement_ref   JSONB,        -- track/slice ids, descriptor snapshot -- whatever's available at feedback time
  position_ms       INTEGER,
  feedback          VARCHAR(10) NOT NULL CHECK (feedback IN ('like','dislike')),
  play_started_at   TIMESTAMP,
  play_duration_ms  INTEGER,
  skipped           BOOLEAN,
  completed         BOOLEAN,
  replayed          BOOLEAN,
  created_at        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feedback_events_model_idx ON feedback_events(model_artifact_id, created_at);

-- Queued/processed batches of feedback handed to the (future) PyTorch
-- trainer. First implementation only needs this to exist and be
-- populated reliably -- see export_feedback_dataset.py.
CREATE TABLE IF NOT EXISTS feedback_training_batches (
  id                     SERIAL PRIMARY KEY,
  model_artifact_id      VARCHAR(255) REFERENCES artifacts(id),
  from_ts                TIMESTAMP NOT NULL,
  to_ts                  TIMESTAMP NOT NULL,
  feedback_count         INTEGER,
  status                 VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued','processing','complete','failed')),
  resulting_artifact_id  VARCHAR(255) REFERENCES artifacts(id),
  created_at             TIMESTAMP DEFAULT NOW(),
  completed_at           TIMESTAMP
);

-- Password reset (routes/auth.js /forgot + /reset). Also applied automatically on first use by
-- db/queries.js ensureResetColumns(), so existing databases need no manual step.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(64);   -- sha256 of the emailed token
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires    TIMESTAMP;
