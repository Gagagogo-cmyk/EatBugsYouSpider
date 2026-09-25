# Consumer feedback pipeline

How a listener's Like/Dislike in the Gnumbat consumer app (`src/consumer/`)
eventually becomes a new model version. This document is the map; each
step links to the code that actually implements it.

```
LISTENER (src/consumer/)
   |  POST /feedback  { listenerId, feedback: 'like'|'dislike', modelHash,
   |                     modelVersion, seedHash, arrangementRef, positionMs, ... }
   v
feedback_events table (src/backend/db/schema.sql)
   |  every row keeps FULL playback context -- not a playlist vote.
   |  see routes/feedback.js's own comment for why.
   v
feedback_training_batches (queued, via POST /feedback/batches)
   v
src/demucs/export_feedback_dataset.py  ->  data/feedback_datasets/batch_<id>.json
   |  MANUAL step only -- an operator runs this, same as add_tension.py
   |  or the TUI's `:lora train`. Nothing here auto-triggers on a Like.
   v
[FUTURE, not built yet] PyTorch trainer consumes the dataset file,
produces new weights for the model's lineage (a branch of the current
seed, published through src/network/artifacts/publish.js like any other
model artifact -- registry.js's `parent` field ties it back to the model
it was trained from)
   v
New artifact version, registered with registry.releaseState = 'testing'
(never auto-'released' -- a curator promotes it through panel.html, same
human-in-the-loop rule as replant()/setReleaseState())
   v
Once release_state flips to 'released'/'evolving' (src/network/artifacts/
registry.js's setReleaseState(), mirrored to Postgres artifacts.release_state
by src/backend/db/schema.sql), it becomes eligible again via
GET /models/released -- the loop closes.
```

## Why it stops where it stops

Spec item 21 ("IMPORTANT TRAINING PRINCIPLE") is explicit: feedback
accumulates, training runs periodically and manually, a model never
instantly mutates from one Like. This document and the code behind it
implement exactly that boundary and no further — there is currently no
PyTorch code anywhere in this repo that turns a feedback dataset into
model weights (checked: `slicer.js`'s `selectSegment()` is today's
*heuristic* descriptor-similarity segment selector, not a trained
decision model). Building that trainer is real, separate future work;
this pipeline's job is to make sure that when it exists, it has a
reliable, structured dataset to read from.

## Model release lifecycle

Six states (spec item 6/22), stored two places on purpose:

- **Locally, per node**: `registry.releaseState` in
  `src/network/artifacts/registry.js` (`development` (default) ->
  `training` -> `testing` -> `ready` -> `released` -> `evolving`),
  changed only by `registry.setReleaseState(hash, state)` — a curator
  action, never automatic. This is orthogonal to the existing
  `trainingState` field (`untrained`/`training`/`ready`/`failed`), which
  answers "has this been trained at all," not "is this in front of
  listeners."
- **Mirrored on the server**: `artifacts.release_state` /
  `artifacts.released_at` columns (`src/backend/db/schema.sql`), updated
  whenever a model artifact is (re-)registered with the server. This is
  what `GET /models/released` actually filters on — the consumer app
  never talks to a local node's registry directly.

Only `released`/`evolving` models are ever returned by `ModelService`
(`src/backend/routes/models.js`) — `development`/`training`/`testing`/
`ready` are all hidden from listeners, matching spec item 22's table
exactly.

## Where a session's model comes from

`sessions.model_artifact_id` / `sessions.seed_hash`
(`src/backend/db/schema.sql`) link a live `mode='web'` session to what's
actually playing. **This is currently populated only when explicitly
passed to `POST /slices/session/open`** — today's instrument control
layer (`src/max/ws_server.js`) has no notion of "current model artifact"
yet, so a session opened without them is a normal, honest state:
`RadioService`'s `GET /radio/current` reports that as "no model loaded,"
the same empty state the CRKT/SHOWS mockups already show. Wiring the
instrument side to actually know and report its current released
model/seed is future work, not part of this consumer-app pass.
