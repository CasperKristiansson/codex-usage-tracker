import base64
import hashlib
import os
from pathlib import Path
import zipfile
import tomllib


def _project_info():
    data = tomllib.loads(Path("pyproject.toml").read_text())
    project = data.get("project", {})
    name = project.get("name", "codex-usage-tracker")
    version = project.get("version", "0.0.0")
    dependencies = project.get("dependencies", [])
    scripts = project.get("scripts", {})
    return name, version, dependencies, scripts


def _normalize(name: str) -> str:
    return name.replace("-", "_")


def _dist_info_dir(name: str, version: str) -> str:
    return f"{_normalize(name)}-{version}.dist-info"


def _hash_bytes(data: bytes) -> str:
    digest = hashlib.sha256(data).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _build_metadata(name: str, version: str, dependencies) -> str:
    lines = [
        "Metadata-Version: 2.1",
        f"Name: {name}",
        f"Version: {version}",
    ]
    for dep in dependencies:
        lines.append(f"Requires-Dist: {dep}")
    lines.append("")
    return "\n".join(lines)


def _write_wheel(wheel_path: Path, editable: bool) -> None:
    name, version, dependencies, scripts = _project_info()
    dist_info = _dist_info_dir(name, version)
    records = []

    def add_bytes(zf, arcname: str, data: bytes) -> None:
        zf.writestr(arcname, data)
        records.append((arcname, _hash_bytes(data), len(data)))

    def add_file(zf, arcname: str, path: Path) -> None:
        data = path.read_bytes()
        add_bytes(zf, arcname, data)

    with zipfile.ZipFile(wheel_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        if editable:
            src_path = str((Path(__file__).resolve().parent / "src").resolve())
            add_bytes(zf, f"{_normalize(name)}.pth", (src_path + "\n").encode("utf-8"))
        else:
            pkg_root = Path("src") / "codex_usage_tracker"
            for path in pkg_root.rglob("*"):
                if path.is_file():
                    rel = path.relative_to(pkg_root)
                    arcname = str(Path("codex_usage_tracker") / rel)
                    add_file(zf, arcname, path)

        metadata = _build_metadata(name, version, dependencies)
        add_bytes(zf, f"{dist_info}/METADATA", metadata.encode("utf-8"))
        wheel_text = "\n".join(
            [
                "Wheel-Version: 1.0",
                "Generator: build_backend",
                "Root-Is-Purelib: true",
                "Tag: py3-none-any",
                "",
            ]
        )
        add_bytes(zf, f"{dist_info}/WHEEL", wheel_text.encode("utf-8"))
        if scripts:
            entry_lines = ["[console_scripts]"]
            for key, value in scripts.items():
                entry_lines.append(f"{key} = {value}")
            entry_lines.append("")
            add_bytes(
                zf,
                f"{dist_info}/entry_points.txt",
                "\n".join(entry_lines).encode("utf-8"),
            )

        record_path = f"{dist_info}/RECORD"
        record_lines = []
        for path, digest, size in records:
            record_lines.append(f"{path},{digest},{size}")
        record_lines.append(f"{record_path},,")
        zf.writestr(record_path, "\n".join(record_lines))


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    name, version, _, _ = _project_info()
    wheel_name = f"{_normalize(name)}-{version}-py3-none-any.whl"
    wheel_path = Path(wheel_directory) / wheel_name
    wheel_path.parent.mkdir(parents=True, exist_ok=True)
    _write_wheel(wheel_path, editable=False)
    return wheel_name


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    name, version, _, _ = _project_info()
    wheel_name = f"{_normalize(name)}-{version}.editable-py3-none-any.whl"
    wheel_path = Path(wheel_directory) / wheel_name
    wheel_path.parent.mkdir(parents=True, exist_ok=True)
    _write_wheel(wheel_path, editable=True)
    return wheel_name


def get_requires_for_build_wheel(config_settings=None):
    return []


def get_requires_for_build_editable(config_settings=None):
    return []


def prepare_metadata_for_build_wheel(metadata_directory, config_settings=None):
    name, version, dependencies, scripts = _project_info()
    dist_info = Path(metadata_directory) / _dist_info_dir(name, version)
    dist_info.mkdir(parents=True, exist_ok=True)
    metadata = _build_metadata(name, version, dependencies)
    (dist_info / "METADATA").write_text(metadata, encoding="utf-8")
    if scripts:
        entry_lines = ["[console_scripts]"]
        for key, value in scripts.items():
            entry_lines.append(f"{key} = {value}")
        entry_lines.append("")
        (dist_info / "entry_points.txt").write_text(
            "\n".join(entry_lines), encoding="utf-8"
        )
    return dist_info.name
