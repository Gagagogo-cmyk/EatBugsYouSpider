import subprocess
import time
import os
import re
import json
import shutil
import urllib.request
import queue
import threading
from pathlib import Path
from watchdog.observers.polling import PollingObserver as Observer
from watchdog.events import FileSystemEventHandler

# Serial processing queue — prevents concurrent Demucs/FluCoMa runs
_work_queue: queue.Queue = queue.Queue()
_queued_stems: set = set()  # track stems already queued to avoid duplicates

def _enqueue(filepath: Path):
    stem = filepath.stem
    if stem in _queued_stems:
        print(f"Skipping duplicate: {filepath.name}")
        return
    _queued_stems.add(stem)
    _work_queue.put(filepath)

def _worker():
    while True:
        filepath = _work_queue.get()
        try:
            AudioHandler().process_file(filepath)
        except Exception as e:
            print(f"Worker error on {filepath.name}: {e}")
        finally:
            _queued_stems.discard(filepath.stem)
            _work_queue.task_done()

threading.Thread(target=_worker, daemon=True).start()


# =========================
# PROGRESS REPORTING
# POSTs pipelineStage events to ws_server.js /progress endpoint.
# ws_server broadcasts to all TUI clients.
# =========================
WS_SERVER_PROGRESS_URL = "http://localhost:8080/progress"

def post_progress(data):
    try:
        body = json.dumps(data).encode('utf-8')
        req = urllib.request.Request(
            WS_SERVER_PROGRESS_URL, data=body,
            headers={'Content-Type': 'application/json'}, method='POST'
        )
        urllib.request.urlopen(req, timeout=1)
    except Exception:
        pass  # TUI not connected — silent

# =========================
# PATHS  (all relative — works on any machine)
# =========================
SRC_DIR  = Path(__file__).parent          # EBYS/src/demucs/
ROOT_DIR = SRC_DIR.parent.parent          # EBYS/ (repo root)
DATA_ROOT = ROOT_DIR / "data"

# raw_uploads/ is PER-SESSION (data/sessions/<id>/raw_uploads/) — each session
# keeps its own dropped source files, so :resetAll (which wipes the active
# session dir) removes them and switching sessions never mixes uploads. Defined
# below via raw_uploads_dir(), once session_data_dir() exists. watchdog needs a
# concrete path to watch, so it watches the CURRENT session's folder and the
# main loop re-points the observer whenever the active session changes.

# session_data_dir()/current_session_id() — mirrors session_manager.js /
# the Max js objects' getSessionId()+getDataDir() pattern (see that file's
# header comment for the full multi-session design). Re-read fresh every
# call — this process is a long-running watchdog that outlives any single
# TUI session, so process_file() re-resolves these at the top of each run
# rather than caching them once at module load, letting a mid-run
# :switchSession in the TUI redirect the *next* file that lands in
# raw_uploads/ into the newly active session without needing a restart.
def current_session_id() -> str:
    p = DATA_ROOT / "current_session.txt"
    try:
        sid = p.read_text().strip()
        return sid or "default"
    except Exception:
        return "default"

def session_data_dir() -> Path:
    d = DATA_ROOT / "sessions" / current_session_id()
    d.mkdir(parents=True, exist_ok=True)
    return d

# Module-load-time snapshot — good enough for the one-shot startup scan
# below (analyze_missing_tracks/pending files), which only ever runs once
# right as this process starts.
DATA_DIR  = session_data_dir()
STEMS_DIR = DATA_DIR / "stems"
TEMP_DIR  = DATA_DIR / "temp"

STEMS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

def raw_uploads_dir() -> Path:
    """Current session's raw_uploads/ (re-resolved each call, like session_data_dir)."""
    d = session_data_dir() / "raw_uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d

# Concrete drop-zone for the session active at boot. The main loop re-points the
# observer at raw_uploads_dir() again whenever current_session.txt changes.
RAW_UPLOADS = raw_uploads_dir()

# One-time migration: relocate anything still sitting in the OLD global
# data/raw_uploads/ into the current session, so files dropped before this
# change aren't orphaned (the watcher no longer watches the global path).
_LEGACY_GLOBAL_UPLOADS = DATA_ROOT / "raw_uploads"
if _LEGACY_GLOBAL_UPLOADS.is_dir() and _LEGACY_GLOBAL_UPLOADS.resolve() != RAW_UPLOADS.resolve():
    for _f in list(_LEGACY_GLOBAL_UPLOADS.iterdir()):
        if _f.is_file() and not _f.name.startswith('.'):
            _dest = RAW_UPLOADS / _f.name
            if not _dest.exists():
                try:
                    shutil.move(str(_f), str(_dest))
                    print(f"raw_uploads migration: moved {_f.name} → session '{current_session_id()}'")
                except Exception as _e:
                    print(f"raw_uploads migration: could not move {_f.name}: {_e}")


# =========================
# PYTHON SELECTION
# =========================
# demucs_env: for Demucs itself (needs torch, Python 3.14)
DEMUCS_PYTHON = str(SRC_DIR / "demucs_env" / "bin" / "python3")

# Analysis python: needs essentia + madmom (requires Python ≤ 3.11)
# Try candidates in order; first one that has both wins.
def _find_analysis_python():
    candidates = [
        "/opt/homebrew/bin/python3.10",   # ideal: madmom + essentia sweet spot
        "/opt/homebrew/bin/python3.11",
        "/usr/local/bin/python3.10",
        "/usr/local/bin/python3.11",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        DEMUCS_PYTHON,   # last resort
    ]
    for py in candidates:
        if not Path(py).exists():
            continue
        r = subprocess.run([py, "-c", "import madmom, essentia"], capture_output=True)
        if r.returncode == 0:
            print(f"Analysis python: {py}")
            return py
    # Fallback: just needs essentia (genre_tagger) or madmom separately
    for py in candidates:
        if Path(py).exists():
            print(f"Analysis python fallback: {py}")
            return py
    return DEMUCS_PYTHON

ANALYSIS_PYTHON = _find_analysis_python()

# Subprocess env with Homebrew in PATH (needed for ffmpeg inside madmom)
SUBPROCESS_ENV = os.environ.copy()
SUBPROCESS_ENV["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + SUBPROCESS_ENV.get("PATH", "")


# =========================
# STARTUP ANALYSIS
# Run genre + madmom on any existing track not yet in genres.json / downbeats.json
# =========================
def analyze_missing_tracks():
    ht_root = STEMS_DIR / "htdemucs"
    if not ht_root.exists():
        return

    genres_path    = DATA_DIR / "genres.json"
    downbeats_path = DATA_DIR / "downbeats.json"

    try:
        genres_db = json.load(open(genres_path)) if genres_path.exists() else {}
    except Exception:
        genres_db = {}
    try:
        beats_db = json.load(open(downbeats_path)) if downbeats_path.exists() else {}
    except Exception:
        beats_db = {}

    missing = []
    for folder in sorted(ht_root.iterdir()):
        if not folder.is_dir():
            continue
        name = folder.name
        in_genres = any(name in k or k in name for k in genres_db)
        in_beats  = any(name in k or k in name for k in beats_db)
        if not in_genres or not in_beats:
            missing.append(name)

    if not missing:
        print("startup: all tracks already analyzed ✓")
        return

    print(f"startup: {len(missing)} track(s) need analysis: {missing}")
    HT_ROOT = str(ht_root)

    print("startup → genre_tagger.py ...")
    subprocess.run(
        [ANALYSIS_PYTHON, str(SRC_DIR / "genre_tagger.py"),
         "--htdemucs-root", HT_ROOT,
         "--out", str(genres_path)],
        env=SUBPROCESS_ENV
    )

    print("startup → madmom_tagger.py ...")
    subprocess.run([
        ANALYSIS_PYTHON, str(SRC_DIR / "madmom_tagger.py"),
        "--htdemucs-root", HT_ROOT,
        "--out", str(downbeats_path),
    ], env=SUBPROCESS_ENV)

    print("startup: analysis complete ✓")

analyze_missing_tracks()


# =========================
# SQLITE IMPORT HELPER
# =========================
def _run_import_library():
    """Import genres + downbeats (and any existing slices) into ebys.db."""
    import_script = SRC_DIR / "import_library.py"
    if not import_script.exists():
        return
    try:
        r = subprocess.run(
            [ANALYSIS_PYTHON, str(import_script)],
            capture_output=True, text=True, timeout=60,
            env=SUBPROCESS_ENV
        )
        if r.stdout.strip():
            print(f"import_library: {r.stdout.strip()}")
        if r.returncode != 0 and r.stderr.strip():
            print(f"import_library ERROR: {r.stderr.strip()}")
    except Exception as e:
        print(f"import_library failed: {e}")


# Run once at startup to populate DB from existing JSON files
_run_import_library()


# =========================
# WATCHER HANDLER
# =========================
class AudioHandler(FileSystemEventHandler):

    def process_file(self, filepath: Path):

        # Re-resolve per-session paths fresh for THIS file — shadows the
        # module-level DATA_DIR/STEMS_DIR/TEMP_DIR (set once at process
        # start) for the rest of this method, so a :switchSession in the
        # TUI since this watcher last started redirects this file into the
        # session that's active right now. See session_data_dir() above.
        DATA_DIR  = session_data_dir()
        STEMS_DIR = DATA_DIR / "stems"
        TEMP_DIR  = DATA_DIR / "temp"
        STEMS_DIR.mkdir(parents=True, exist_ok=True)
        TEMP_DIR.mkdir(parents=True, exist_ok=True)

        print("\n========================")
        print("NEW FILE:", filepath)
        print(f"  → session: {current_session_id()}  (stems → {STEMS_DIR})")
        print("========================")

        ext = filepath.suffix.lower()

        # -------------------------
        # INPUT HANDLING
        # -------------------------
        if ext in (".mp4", ".m4a", ".mp3", ".flac", ".aif", ".aiff", ".3gp"):
            wav_path = TEMP_DIR / f"{filepath.stem}.wav"
            subprocess.run([
                "/opt/homebrew/bin/ffmpeg", "-y",
                "-i", str(filepath),
                str(wav_path)
            ])
            target_audio = wav_path

        elif ext == ".wav":
            target_audio = filepath

        else:
            print("Unsupported file type:", ext)
            return

        print("Processing:", target_audio.name)

        original_name = target_audio.stem
        ht_root = STEMS_DIR / "htdemucs"
        song_folder = None

        # -------------------------
        # SKIP IF STEMS ALREADY EXIST
        # -------------------------
        if ht_root.exists():
            for folder in ht_root.iterdir():
                if folder.is_dir() and any(folder.glob(f"{original_name}_*.wav")):
                    print(f"Stems already exist for '{original_name}' — skipping Demucs")
                    song_folder = folder
                    break

        if song_folder is None:
            # -------------------------
            # RUN DEMUCS (stream progress to TUI)
            # -------------------------
            post_progress({'type': 'pipelineStage', 'stage': 'demucs',
                           'status': 'start', 'track': original_name, 'percent': 0})

            demucs_env = SUBPROCESS_ENV.copy()
            demucs_env["PYTHONUNBUFFERED"] = "1"
            proc = subprocess.Popen([
                DEMUCS_PYTHON,
                "-m", "demucs",
                "-o", str(STEMS_DIR),
                str(target_audio)
            ], stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, env=demucs_env)

            # Parse tqdm progress from stderr (uses \r for in-place updates)
            buf = b''
            last_pct = -1
            for chunk in iter(lambda: proc.stderr.read(64), b''):
                buf += chunk
                parts = re.split(b'[\r\n]', buf)
                buf = parts[-1]
                for part in parts[:-1]:
                    line = part.decode('utf-8', errors='replace')
                    m = re.search(r'(\d+)%', line)
                    if m:
                        pct = int(m.group(1))
                        if pct != last_pct:
                            last_pct = pct
                            print(f"Demucs: {pct}%")
                            post_progress({'type': 'pipelineStage', 'stage': 'demucs',
                                           'status': 'progress', 'track': original_name, 'percent': pct})
            proc.wait()
            post_progress({'type': 'pipelineStage', 'stage': 'demucs',
                           'status': 'done', 'track': original_name})

            print("Demucs finished")

            if not ht_root.exists():
                print("No htdemucs folder found")
                return

            # Demucs always names the output folder after the input stem
            song_folder = ht_root / original_name
            if not song_folder.exists() or not list(song_folder.glob("*.wav")):
                print(f"Expected folder not found: {song_folder}")
                return

            print("Using folder:", song_folder.name)

            # -------------------------
            # RENAME FILES
            # -------------------------
            for f in list(song_folder.glob("*.wav")):
                new_name = f"{original_name}_{f.stem}.wav"
                new_path = f.parent / new_name
                print(f"Renaming {f.name} -> {new_name}")
                try:
                    f.rename(new_path)
                except Exception as e:
                    print("Rename error:", e)

            print("DONE\n")

        # -------------------------
        # RUN ANALYSIS PIPELINE  (genre + madmom BEFORE stream.txt write)
        # stream.txt is written last so streamWatcher only fires when the
        # full track (Demucs + genre + madmom) is ready for FluCoMa.
        # -------------------------
        HT_ROOT = str(STEMS_DIR / "htdemucs")

        print("→ genre_tagger.py ...")
        post_progress({'type': 'pipelineStage', 'stage': 'genre',
                       'status': 'start', 'track': original_name})
        r_genre = subprocess.run(
            [ANALYSIS_PYTHON, str(SRC_DIR / "genre_tagger.py"),
             "--htdemucs-root", HT_ROOT,
             "--out", str(DATA_DIR / "genres.json")],
            env=SUBPROCESS_ENV, capture_output=True, text=True
        )
        if r_genre.stderr.strip():
            print(f"genre_tagger output:\n{r_genre.stderr.strip()}")
        if r_genre.returncode != 0:
            print(f"genre_tagger FAILED (code {r_genre.returncode})")
            post_progress({'type': 'pipelineStage', 'stage': 'genre',
                           'status': 'error', 'track': original_name,
                           'msg': f'code {r_genre.returncode}'})
        else:
            post_progress({'type': 'pipelineStage', 'stage': 'genre',
                           'status': 'done', 'track': original_name})

        print("→ madmom_tagger.py ...")
        post_progress({'type': 'pipelineStage', 'stage': 'madmom',
                       'status': 'start', 'track': original_name})
        r_madmom = subprocess.run([
            ANALYSIS_PYTHON, str(SRC_DIR / "madmom_tagger.py"),
            "--htdemucs-root", HT_ROOT,
            "--out", str(DATA_DIR / "downbeats.json"),
        ], env=SUBPROCESS_ENV, capture_output=True, text=True)
        # Always print madmom output — it exits 0 even on analysis failure
        if r_madmom.stderr.strip():
            print(f"madmom_tagger output:\n{r_madmom.stderr.strip()}")
        if r_madmom.stdout.strip():
            print(f"madmom_tagger stdout:\n{r_madmom.stdout.strip()}")
        if r_madmom.returncode != 0:
            print(f"madmom_tagger FAILED (code {r_madmom.returncode})")
            post_progress({'type': 'pipelineStage', 'stage': 'madmom',
                           'status': 'error', 'track': original_name,
                           'msg': f'code {r_madmom.returncode}'})
        else:
            # Verify downbeats.json was actually populated
            db_path = DATA_DIR / "downbeats.json"
            try:
                db = json.load(open(db_path)) if db_path.exists() else {}
                if db:
                    post_progress({'type': 'pipelineStage', 'stage': 'madmom',
                                   'status': 'done', 'track': original_name})
                else:
                    print("madmom_tagger WARNING: downbeats.json is empty — madmom may have failed silently")
                    post_progress({'type': 'pipelineStage', 'stage': 'madmom',
                                   'status': 'error', 'track': original_name,
                                   'msg': 'downbeats.json empty — check watchdemucs.log'})
            except Exception as e:
                print(f"madmom_tagger WARNING: could not verify downbeats.json: {e}")
                post_progress({'type': 'pipelineStage', 'stage': 'madmom',
                               'status': 'done', 'track': original_name})

        # -------------------------
        # Write stream.txt — Max reads this to get file paths and load audio buffers.
        STEM_ORDER = [('vocals','vocals'), ('drums','drums'), ('bass','bass'), ('other','melody')]
        ht_root   = STEMS_DIR / "htdemucs"
        all_lines = []
        if ht_root.exists():
            for track_folder in sorted(ht_root.iterdir()):
                if not track_folder.is_dir():
                    continue
                track_base = track_folder.name
                for demucs_stem, label in STEM_ORDER:
                    exact = track_folder / f"{track_base}_{demucs_stem}.wav"
                    matches = list(track_folder.glob(f"*_{demucs_stem}.wav"))
                    stem_file = exact if exact.exists() else (matches[0] if matches else None)
                    if stem_file:
                        all_lines.append(f"{label} {stem_file}")
        if all_lines:
            stream_path = DATA_DIR / "stream.txt"
            stream_path.write_text('\n'.join(all_lines) + '\n')
            print(f"stream.txt → {len(all_lines)} stems")

        # Notify TUI + Max that stems are ready.
        # ws_server broadcasts to TUI and outlets 'stemsReady' so Max bangs the read object.
        post_progress({'type': 'stemsReady', 'track': original_name})

        # Import updated genres + downbeats into SQLite.
        # Slice rows are imported after FluCoMa analysis completes (ws_server analysisDone).
        _run_import_library()

        print("✓ pipeline complete\n")



    def on_created(self, event):

        if event.is_directory:
            return

        filepath = Path(event.src_path)
        filename = filepath.name

        # Skip hidden/system files
        if filename.startswith('.'):
            return

        AUDIO_EXTS = {'.wav', '.mp4', '.m4a', '.mp3', '.flac', '.aif', '.aiff', '.3gp'}
        if filepath.suffix.lower() not in AUDIO_EXTS:
            return

        print("🔥 WATCHER TRIGGERED:", event.src_path)

        # Notify TUI immediately — before any processing
        post_progress({'type': 'fileDetected', 'filename': filename})

        time.sleep(2)  # let copy finish
        _enqueue(filepath)


# =========================
# STARTUP SCAN
# =========================
# Process any audio files already sitting in raw_uploads/ that haven't been
# separated yet (no corresponding htdemucs folder with wav stems).
AUDIO_EXTS = {'.wav', '.mp4', '.m4a', '.mp3', '.flac', '.aif', '.aiff', '.3gp'}

def already_processed(filepath: Path) -> bool:
    """Return True if htdemucs stems already exist for this file in the ACTIVE
    session (re-resolved each call so this stays correct after a session switch)."""
    stem_dir = session_data_dir() / "stems" / 'htdemucs' / filepath.stem
    return stem_dir.is_dir() and any(stem_dir.glob('*.wav'))

handler = AudioHandler()

def scan_pending(folder: Path):
    """Queue any un-separated audio already sitting in `folder`. Run at startup
    and again each time the watcher re-points to a new session's raw_uploads/."""
    pending = [
        f for f in folder.iterdir()
        if f.is_file() and not f.name.startswith('.') and f.suffix.lower() in AUDIO_EXTS
        and not already_processed(f)
    ]
    if pending:
        print(f"Scan: {len(pending)} unprocessed file(s) in {folder} — queuing")
        for f in pending:
            post_progress({'type': 'fileDetected', 'filename': f.name})
            _enqueue(f)
    else:
        print(f"Scan: nothing pending in {folder}")

scan_pending(RAW_UPLOADS)

# =========================
# START WATCHER
# =========================
observer = Observer()
watch = observer.schedule(handler, str(RAW_UPLOADS), recursive=False)
observer.start()

_watched_session = current_session_id()
print(f"Watching {RAW_UPLOADS} (session '{_watched_session}')...")

try:
    while True:
        time.sleep(1)
        # Re-point the watcher when the active session changes so the drop-zone
        # always follows the current session (raw_uploads is per-session now).
        sid = current_session_id()
        if sid != _watched_session:
            _watched_session = sid
            new_dir = raw_uploads_dir()
            print(f"Session changed → '{sid}'. Re-pointing watcher to {new_dir}")
            try:
                observer.unschedule(watch)
            except Exception:
                observer.unschedule_all()
            watch = observer.schedule(handler, str(new_dir), recursive=False)
            globals()['RAW_UPLOADS'] = new_dir
            scan_pending(new_dir)

except KeyboardInterrupt:
    observer.stop()

observer.join()
