import os
import sys
from pathlib import Path

APP_NAME = "codex-usage-tracker"
DB_FILENAME = "usage.sqlite"
CONFIG_FILENAME = "config.json"


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


def default_config_path(db_path: Path | None = None) -> Path:
    env = os.environ.get("CODEX_USAGE_CONFIG")
    if env:
        return Path(env)
    if db_path is not None:
        return Path(db_path).with_name(CONFIG_FILENAME)
    return default_data_dir() / CONFIG_FILENAME


def default_rollouts_dir() -> Path:
    return Path.home() / ".codex" / "sessions"
