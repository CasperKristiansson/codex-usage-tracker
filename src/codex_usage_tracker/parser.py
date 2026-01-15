import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
OSC_RE = re.compile(r"\x1b\][^\x07]*\x07")

TOKEN_USAGE_RE = re.compile(
    r"Token usage:\s*total=(?P<total>[0-9,]+)\s+input=(?P<input>[0-9,]+)"
    r"(?:\s*\(\+\s*(?P<cached>[0-9,]+)\s+cached\))?\s+output=(?P<output>[0-9,]+)"
    r"(?:\s*\(reasoning\s+(?P<reasoning>[0-9,]+)\))?",
    re.IGNORECASE,
)

STATUS_TOKEN_USAGE_RE = re.compile(
    r"Token usage:\s*(?P<total>[0-9.,]+[KMB]?)\s*total\s*\(\s*(?P<input>[0-9.,]+[KMB]?)\s*input\s*\+\s*"
    r"(?P<output>[0-9.,]+[KMB]?)\s*output\s*\)",
    re.IGNORECASE,
)

STATUS_CONTEXT_RE = re.compile(
    r"Context window:\s*(?P<percent>[0-9]+)%\s*left\s*\(\s*(?P<used>[0-9.,]+[KMB]?)\s*used\s*/\s*(?P<total>[0-9.,]+[KMB]?)\s*\)",
    re.IGNORECASE,
)

STATUS_LIMIT_RE = re.compile(
    r"^(?P<label>.+?limit):\s*(?:\[[^\]]*\]\s*)?(?P<percent>[0-9]+)%\s*left(?:\s*\(resets\s+(?P<resets>[^)]+)\))?",
    re.IGNORECASE,
)

STATUS_RESET_RE = re.compile(r"\(resets\s+(?P<resets>[^)]+)\)", re.IGNORECASE)

VERSION_RE = re.compile(r"OpenAI Codex\s*\(v(?P<version>[^)]+)\)", re.IGNORECASE)


@dataclass
class StatusSnapshot:
    model: Optional[str] = None
    directory: Optional[str] = None
    session_id: Optional[str] = None
    codex_version: Optional[str] = None
    token_usage: Dict[str, int] = field(default_factory=dict)
    context_window: Dict[str, int] = field(default_factory=dict)
    limits: Dict[str, Dict[str, Optional[str]]] = field(default_factory=dict)


class StatusCapture:
    def __init__(self) -> None:
        self._awaiting_box = False
        self._capturing_box = False
        self._buffer: List[str] = []
        self._max_lines = 200

    def feed_line(self, line: str) -> Optional[StatusSnapshot]:
        clean = strip_ansi(line)
        if "/status" in clean:
            self._awaiting_box = True

        if self._awaiting_box and "\u256d" in clean:
            self._capturing_box = True
            self._awaiting_box = False
            self._buffer = [line]
            return None

        if self._capturing_box:
            self._buffer.append(line)
            if "\u2570" in clean:
                snapshot = parse_status_panel("\n".join(self._buffer))
                self._capturing_box = False
                self._buffer = []
                return snapshot
            if len(self._buffer) >= self._max_lines:
                snapshot = parse_status_panel("\n".join(self._buffer))
                self._capturing_box = False
                self._buffer = []
                return snapshot
        return None


def strip_ansi(text: str) -> str:
    text = OSC_RE.sub("", text)
    return ANSI_RE.sub("", text)


def _clean_status_line(line: str) -> str:
    line = strip_ansi(line)
    line = line.replace("\r", "")
    line = line.strip()
    if not line:
        return ""
    if line.startswith("\u2502") or line.startswith("|"):
        line = line.lstrip("\u2502|")
    if line.endswith("\u2502") or line.endswith("|"):
        line = line.rstrip("\u2502|")
    return line.strip()


def _parse_int(value: str) -> int:
    return int(value.replace(",", "").strip())


def _parse_compact_number(value: str) -> int:
    value = value.strip().replace(",", "")
    if not value:
        return 0
    suffix = value[-1].upper()
    multiplier = 1
    if suffix in ("K", "M", "B"):
        value = value[:-1]
        if suffix == "K":
            multiplier = 1_000
        elif suffix == "M":
            multiplier = 1_000_000
        elif suffix == "B":
            multiplier = 1_000_000_000
    try:
        number = float(value)
    except ValueError:
        return 0
    return int(number * multiplier)


def parse_token_usage_line(line: str) -> Optional[Dict[str, int]]:
    match = TOKEN_USAGE_RE.search(strip_ansi(line))
    if not match:
        return None
    total = _parse_int(match.group("total"))
    input_tokens = _parse_int(match.group("input"))
    cached = match.group("cached")
    cached_tokens = _parse_int(cached) if cached else 0
    output_tokens = _parse_int(match.group("output"))
    reasoning = match.group("reasoning")
    reasoning_tokens = _parse_int(reasoning) if reasoning else 0
    return {
        "total_tokens": total,
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_tokens,
        "output_tokens": output_tokens,
        "reasoning_output_tokens": reasoning_tokens,
    }


def parse_status_panel(text: str) -> StatusSnapshot:
    snapshot = StatusSnapshot()
    last_limit_key: Optional[str] = None

    for raw in text.splitlines():
        line = _clean_status_line(raw)
        if not line:
            continue
        version_match = VERSION_RE.search(line)
        if version_match:
            snapshot.codex_version = version_match.group("version").strip()
            continue

        if line.lower().startswith("model:"):
            snapshot.model = line.split(":", 1)[1].strip()
            continue
        if line.lower().startswith("directory:"):
            snapshot.directory = line.split(":", 1)[1].strip()
            continue
        if line.lower().startswith("session:"):
            snapshot.session_id = line.split(":", 1)[1].strip()
            continue

        token_match = STATUS_TOKEN_USAGE_RE.search(line)
        if token_match:
            snapshot.token_usage = {
                "total_tokens": _parse_compact_number(token_match.group("total")),
                "input_tokens": _parse_compact_number(token_match.group("input")),
                "output_tokens": _parse_compact_number(token_match.group("output")),
            }
            continue

        context_match = STATUS_CONTEXT_RE.search(line)
        if context_match:
            snapshot.context_window = {
                "percent_left": int(context_match.group("percent")),
                "used_tokens": _parse_compact_number(context_match.group("used")),
                "total_tokens": _parse_compact_number(context_match.group("total")),
            }
            continue

        limit_match = STATUS_LIMIT_RE.search(line)
        if limit_match:
            label = limit_match.group("label").strip().lower()
            percent_left = int(limit_match.group("percent"))
            resets = limit_match.group("resets")
            last_limit_key = label
            snapshot.limits[label] = {
                "percent_left": percent_left,
                "resets": resets.strip() if resets else None,
            }
            continue

        reset_match = STATUS_RESET_RE.search(line)
        if reset_match and last_limit_key:
            resets = reset_match.group("resets").strip()
            existing = snapshot.limits.get(last_limit_key)
            if existing:
                existing["resets"] = resets
            else:
                snapshot.limits[last_limit_key] = {"percent_left": None, "resets": resets}

    return snapshot


def map_limits(snapshot: StatusSnapshot) -> Tuple[Optional[float], Optional[str], Optional[float], Optional[str]]:
    limit_5h_percent = None
    limit_5h_resets = None
    limit_weekly_percent = None
    limit_weekly_resets = None

    for label, data in snapshot.limits.items():
        normalized = label.lower()
        if "5h" in normalized or "5 h" in normalized:
            limit_5h_percent = data.get("percent_left")
            limit_5h_resets = data.get("resets")
        elif "week" in normalized:
            limit_weekly_percent = data.get("percent_left")
            limit_weekly_resets = data.get("resets")

    return limit_5h_percent, limit_5h_resets, limit_weekly_percent, limit_weekly_resets
