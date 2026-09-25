"""Machine-level settings. Kept OUT of the library so a library stays portable between
machines (paths to Python/Pd/Demucs are machine facts). The location mirrors JUCE's
``userApplicationDataDirectory`` + "Gnumbat" so the plugin and the worker agree.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from .jsonio import atomic_write_json, read_json

SETTINGS_SCHEMA = "gnumbat.settings/0.1"


def app_data_dir() -> Path:
    if os.environ.get("GNUMBAT_HOME"):
        return Path(os.environ["GNUMBAT_HOME"])
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "Gnumbat"
    if sys.platform.startswith("win"):
        return Path(os.environ.get("APPDATA", home / "AppData" / "Roaming")) / "Gnumbat"
    return Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "gnumbat"


def settings_path() -> Path:
    return Path(os.environ.get("GNUMBAT_SETTINGS", app_data_dir() / "settings.json"))


def default_library_root() -> Path:
    return Path.home() / "Documents" / "Gnumbat" / "library"


def load_settings() -> dict:
    p = settings_path()
    if p.exists():
        try:
            return read_json(p)
        except Exception:
            return {"schema": SETTINGS_SCHEMA}
    return {"schema": SETTINGS_SCHEMA}


def save_settings(doc: dict) -> None:
    doc.setdefault("schema", SETTINGS_SCHEMA)
    atomic_write_json(settings_path(), doc)
