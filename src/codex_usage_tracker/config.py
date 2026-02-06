import json
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .platform import default_config_path

DEFAULT_TIMEZONE = "Europe/Stockholm"


def _load_config(db_path: Optional[Path] = None) -> dict:
    config_path = default_config_path(db_path)
    try:
        raw = config_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    except OSError:
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def is_valid_timezone(value: str) -> bool:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError:
        return False
    return True


def _coerce_bool(value: Optional[object]) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "yes", "1", "on"):
            return True
        if lowered in ("false", "no", "0", "off"):
            return False
    if isinstance(value, int):
        if value == 1:
            return True
        if value == 0:
            return False
    return None


def resolve_timezone_name(
    db_path: Optional[Path] = None,
    override: Optional[str] = None,
) -> str:
    candidate: Optional[object] = override
    if not candidate:
        payload = _load_config(db_path)
        candidate = (
            payload.get("timezone")
            or payload.get("time_zone")
            or payload.get("tz")
        )
    if isinstance(candidate, str):
        trimmed = candidate.strip()
        if trimmed and is_valid_timezone(trimmed):
            return trimmed
    return DEFAULT_TIMEZONE


def resolve_capture_payloads(db_path: Optional[Path] = None) -> bool:
    """
    Whether to store raw message/tool-call payloads.

    Default is False (privacy + smaller DB) unless explicitly enabled in config.json.
    """
    payload = _load_config(db_path)
    candidate: Optional[object] = (
        payload.get("capture_payloads")
        if isinstance(payload, dict)
        else None
    )
    coerced = _coerce_bool(candidate)
    return bool(coerced) if coerced is not None else False


def resolve_timezone(
    db_path: Optional[Path] = None,
    override: Optional[str] = None,
) -> ZoneInfo:
    name = resolve_timezone_name(db_path, override)
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TIMEZONE)
