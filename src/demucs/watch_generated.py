#!/usr/bin/env python3
"""
EBYS — Watch Generated Dump Folder

The generative-pipeline counterpart to watch_demucs.py, but one layer up:
watch_demucs.py watches raw_uploads/ for new audio and turns it into
stems/htdemucs/ entries; this watches data/generated/ (generate_agent.py's
own output folder — already the "dump" the generative pipeline writes
into, nothing new to create) for new manifest_*.json files and turns THOSE
into stems/htdemucs/ entries, by running ingest_generated.py against each
one as it appears.

Why watch the manifest, not the individual wav files:
generate_agent.py writes every clip in a batch first, and only writes
manifest_<timestamp>.json — one file, one atomic json.dump() — as its very
last step (see its main(), bottom). So a manifest's existence already
means "this whole batch finished," with no partial-batch race to guard
against and no "sleep a couple seconds and hope the copy is done" needed
the way watch_demucs.py has to for raw_uploads/ (which receives files from
an external copy/upload, arbitrary size, arbitrary timing). One created
manifest = one batch ready to ingest.

What this script does NOT do, deliberately:
- No naming logic. generate_agent.py already names every clip
  GEN__<stem>_<timestamp>_<n> before this script ever sees it — the
  GEN__ prefix is the "special tag" slicer.js's filterPoolByAgentMode()
  and import_library.py's source_for_name() both key off. This script
  doesn't invent or check that convention, it just hands the manifest to
  the script that does (ingest_generated.py).
- No Demucs. There is nothing to separate — generate_agent.py already
  produces one isolated stem per file. See ingest_generated.py's own
  docstring for the full pipeline-shape comparison.
- No FluCoMa analysis. That still only runs inside the Max patch (FluCoMa's
  buf~ externals aren't callable outside Max — see GENERATIVE_LAYER.md).
  This script gets a batch as far into stems/htdemucs/ + ebys.db as any
  Python-only process can; the Max patch still has to be open to actually
  compute C/S/E/F/P/H/T for the new buffers, exactly as it does for real
  uploads.

Usage:
  python3 watch_generated.py
"""

import subprocess
import sys
import time
import queue
import threading
from pathlib import Path
from watchdog.observers.polling import PollingObserver as Observer
from watchdog.events import FileSystemEventHandler

SRC_DIR      = Path(__file__).parent               # EBYS/src/demucs/
ROOT_DIR     = SRC_DIR.parent.parent                # EBYS/ (repo root)
DUMP_DIR     = ROOT_DIR / "data" / "generated"       # generate_agent.py's own out_dir default
INGEST_SCRIPT = SRC_DIR / "ingest_generated.py"

DUMP_DIR.mkdir(parents=True, exist_ok=True)

# Serial processing queue — same reasoning as watch_demucs.py's: ingest_generated.py
# ends in import_library.py, a write to the shared ebys.db. Two of those racing
# concurrently is the failure mode being avoided, not anything specific to generation.
_work_queue: queue.Queue = queue.Queue()
_queued: set = set()


def _enqueue(manifest_path: Path):
    key = str(manifest_path)
    if key in _queued:
        print(f"Skipping duplicate: {manifest_path.name}")
        return
    _queued.add(key)
    _work_queue.put(manifest_path)


def _ingest(manifest_path: Path):
    print("\n========================")
    print("NEW MANIFEST:", manifest_path.name)
    print("========================")
    r = subprocess.run(
        [sys.executable, str(INGEST_SCRIPT), "--manifest", str(manifest_path)],
        capture_output=True, text=True,
    )
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.returncode != 0:
        print(f"ingest_generated.py FAILED (code {r.returncode}):\n{r.stderr.strip()}")
    else:
        print(f"ingested {manifest_path.name}")


def _worker():
    while True:
        manifest_path = _work_queue.get()
        try:
            _ingest(manifest_path)
        except Exception as e:
            print(f"Worker error on {manifest_path.name}: {e}")
        finally:
            _queued.discard(str(manifest_path))
            _work_queue.task_done()


threading.Thread(target=_worker, daemon=True).start()


class ManifestHandler(FileSystemEventHandler):

    def on_created(self, event):
        if event.is_directory:
            return
        filepath = Path(event.src_path)
        if not filepath.name.startswith("manifest_") or filepath.suffix != ".json":
            return
        print("🔥 WATCHER TRIGGERED:", filepath.name)
        # generate_agent.py writes the manifest in one json.dump() call, so unlike
        # raw_uploads/ there's no slow external copy to wait out — this pause is
        # just a small safety margin against the filesystem event firing a beat
        # before the write is fully flushed, not a stand-in for real stability
        # detection the way watch_demucs.py's is.
        time.sleep(1)
        _enqueue(filepath)


# =========================
# STARTUP SCAN
# =========================
# Any manifest already sitting in data/generated/ (from a batch generated while
# this watcher wasn't running) gets queued too. Safe to re-run on one already
# ingested — ingest_generated.py skips any clip whose destination file already
# exists and still no-ops cleanly the rest of its steps.
def scan_pending():
    pending = sorted(DUMP_DIR.glob("manifest_*.json"))
    if pending:
        print(f"Scan: {len(pending)} manifest(s) in {DUMP_DIR} — queuing")
        for f in pending:
            _enqueue(f)
    else:
        print(f"Scan: nothing pending in {DUMP_DIR}")


scan_pending()

# =========================
# START WATCHER
# =========================
observer = Observer()
observer.schedule(ManifestHandler(), str(DUMP_DIR), recursive=False)
observer.start()
print(f"Watching {DUMP_DIR} for new manifest_*.json files (Ctrl-C to stop)...")

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    observer.stop()
observer.join()
