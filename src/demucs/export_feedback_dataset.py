#!/usr/bin/env python3
"""
export_feedback_dataset.py — turn accumulated listener feedback into a
training-ready dataset file for one released model.

This is the ONLY thing spec item "20. MODEL FEEDBACK PIPELINE" /
"21. IMPORTANT TRAINING PRINCIPLE" asks the first implementation to do:
make the path from listener feedback to a dataset file reliable. It does
NOT run any training — no PyTorch import here on purpose. What a future
trainer does with the dataset this writes is a separate, later piece of
work; this script's job stops at "feedback_events -> a real file on disk,
correctly."

Manual step, never automatic — same posture as add_tension.py and the
LoRA training the TUI's `:lora train` command kicks off (see CLAUDE.md:
"an hours-long local-GPU job shouldn't start unattended").

Talks to the Gnumbat backend (src/backend) over plain HTTP (stdlib
urllib — no new dependency, same as everything else in this repo that
already just uses `fetch`/http rather than an ORM/driver), not directly
to Postgres: the backend is the one place that already knows how to query
feedback_events safely, and this script doesn't need DB credentials of
its own.

Usage:
  # 1. Queue a batch: every feedback_events row for a model within a time
  #    range (defaults: from the beginning of time, to now).
  python3 export_feedback_dataset.py queue --model <artifact-id-or-hash> [--from ISO8601] [--to ISO8601]

  # 2. Export a queued batch to a dataset file (data/feedback_datasets/).
  python3 export_feedback_dataset.py export --batch <batch-id>

  # 3. Do both in one call (the common case).
  python3 export_feedback_dataset.py run --model <artifact-id-or-hash> [--from ISO8601] [--to ISO8601]
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone

BACKEND_URL = os.environ.get("GNUMBAT_BACKEND_URL", "http://localhost:3000")
# data/ is where every other cross-pipeline file already lives (gnumbat.db,
# analysis_library.json, ...) -- see CLAUDE.md's "Data files that matter
# across the whole pipeline". This repo root is two levels up from
# src/demucs/.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATASET_DIR = os.path.join(REPO_ROOT, "data", "feedback_datasets")


def _request(method, path, body=None):
    url = BACKEND_URL.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                  headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"{method} {path} -> HTTP {e.code}: {detail}")
    except urllib.error.URLError as e:
        raise SystemExit(f"could not reach backend at {BACKEND_URL} ({e.reason}) -- "
                          f"is `cd src/backend && npm run dev` running? Set GNUMBAT_BACKEND_URL to override.")


def queue_batch(model, from_ts, to_ts):
    batch = _request("POST", "/feedback/batches", {"modelHash": model, "fromTs": from_ts, "toTs": to_ts})
    print(f"queued batch {batch['id']} — {batch['feedback_count']} feedback event(s) "
          f"for model {model} in [{from_ts}, {to_ts})")
    return batch


def export_batch(batch_id):
    payload = _request("GET", f"/feedback/batches/{batch_id}/export")
    batch, events = payload["batch"], payload["events"]

    os.makedirs(DATASET_DIR, exist_ok=True)
    out_path = os.path.join(DATASET_DIR, f"batch_{batch_id}.json")

    # Deliberately the raw structured events, not pre-aggregated into
    # anything like "A->B accepted N times" — spec §5 explicitly warns
    # against collapsing feedback into a simplified binary signal before
    # a real learning algorithm exists to decide how to weight it. This
    # file is the input a future trainer reduces, not a reduction itself.
    dataset = {
        "batch_id": batch["id"],
        "model_artifact_id": batch["model_artifact_id"],
        "from_ts": batch["from_ts"],
        "to_ts": batch["to_ts"],
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "feedback_count": len(events),
        "events": events
    }

    if not events:
        print(f"batch {batch_id}: 0 feedback events in range — writing an empty dataset file "
              f"(honest, not an error: nothing to train on yet)")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(dataset, f, indent=2, default=str)

    status = "complete" if events else "failed"
    _request("POST", f"/feedback/batches/{batch_id}/complete", {"status": status})
    print(f"wrote {out_path} ({len(events)} events), batch {batch_id} marked '{status}'")
    return out_path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_queue = sub.add_parser("queue", help="queue a feedback batch for a model")
    p_queue.add_argument("--model", required=True, help="artifact id/hash of the model")
    p_queue.add_argument("--from", dest="from_ts", default="1970-01-01T00:00:00Z")
    p_queue.add_argument("--to", dest="to_ts", default=None)

    p_export = sub.add_parser("export", help="export an already-queued batch to a dataset file")
    p_export.add_argument("--batch", required=True, type=int)

    p_run = sub.add_parser("run", help="queue + export in one step")
    p_run.add_argument("--model", required=True)
    p_run.add_argument("--from", dest="from_ts", default="1970-01-01T00:00:00Z")
    p_run.add_argument("--to", dest="to_ts", default=None)

    args = parser.parse_args()

    if args.cmd == "queue":
        to_ts = args.to_ts or datetime.now(timezone.utc).isoformat()
        queue_batch(args.model, args.from_ts, to_ts)
    elif args.cmd == "export":
        export_batch(args.batch)
    elif args.cmd == "run":
        to_ts = args.to_ts or datetime.now(timezone.utc).isoformat()
        batch = queue_batch(args.model, args.from_ts, to_ts)
        export_batch(batch["id"])


if __name__ == "__main__":
    main()
