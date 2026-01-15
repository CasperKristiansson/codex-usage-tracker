import os
import sys
from pathlib import Path

APP_NAME = "codex-usage-tracker"
DB_FILENAME = "usage.sqlite"


def _xdg_data_home() -> Path:
    env = os.environ.get("XDG_DATA_HOME")
    if env:
        return Path(env)
    return Path.home() / ".local" / "share"


def default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    return _xdg_data_home() / APP_NAME


def default_db_path() -> Path:
    return default_data_dir() / DB_FILENAME
