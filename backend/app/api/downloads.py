"""
Downloads — lists and serves installable packages from /backend/downloads/.

GET  /downloads        → JSON list of available packages with metadata
GET  /downloads/{name} → streams the file as an attachment

The list is derived by *scanning* the downloads directory rather than from a
hard-coded manifest: each artifact's version is parsed from its filename and the
newest build of each kind wins. That way the listing never drifts out of sync
with the files actually present (e.g. a freshly built wheel just appears, with
the correct version, with no code change).
"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/downloads", tags=["downloads"])

_DOWNLOADS_DIR = Path(__file__).resolve().parents[2] / "downloads"
_VERSION_RE = re.compile(r"(\d+\.\d+\.\d+)")

# Each artifact kind: how to recognise it, plus the display metadata. install_cmd
# is templated with the real filename so it always matches what's served.
_KINDS = [
    {
        "type":        "python-wheel",
        "suffixes":    (".whl",),
        "name":        "HexaLLM CLI",
        "platform":    "all",
        "description": "Terminal AI coding assistant — works instantly, no Ollama required",
        "install_cmd": lambda n: f"pip install {n}",
        "run_cmd":     "hexallm",
    },
    {
        "type":        "desktop-app",
        "suffixes":    (".deb",),
        "name":        "HexaLLM Desktop",
        "platform":    "linux",
        "description": "Native desktop app for Linux (Debian/Ubuntu) — offline model management, local inference",
        "install_cmd": lambda n: f"sudo dpkg -i '{n}'",
        "run_cmd":     "hexallm-ai",
    },
    {
        "type":        "desktop-app",
        "suffixes":    (".exe",),
        "name":        "HexaLLM Desktop",
        "platform":    "windows",
        "description": "Native desktop app for Windows — offline model management, local inference",
        "install_cmd": lambda n: f"Run {n}",
        "run_cmd":     "HexaLLM AI",
    },
    {
        "type":        "desktop-app",
        "suffixes":    (".dmg",),
        "name":        "HexaLLM Desktop",
        "platform":    "macos",
        "description": "Native desktop app for macOS (Apple Silicon + Intel) — offline model management, local inference",
        "install_cmd": lambda n: f"Open {n} and drag to Applications",
        "run_cmd":     "HexaLLM AI",
    },
    {
        "type":        "mobile-app",
        "suffixes":    (".apk",),
        "name":        "HexaLLM Mobile",
        "platform":    "android",
        "description": "Android app — chat with your models on the go",
        "install_cmd": lambda n: "Enable Unknown Sources and install the APK",
        "run_cmd":     "HexaLLM AI",
    },
]


def _version_tuple(name: str) -> tuple[int, ...]:
    m = _VERSION_RE.search(name)
    return tuple(int(p) for p in m.group(1).split(".")) if m else (0, 0, 0)


def _scan() -> list[dict]:
    """Newest build of each (platform) kind present on disk."""
    if not _DOWNLOADS_DIR.exists():
        return []
    # key = (type, platform) so e.g. linux/windows/macos desktop builds coexist
    best: dict[tuple[str, str], tuple[tuple[int, ...], dict]] = {}
    for path in sorted(_DOWNLOADS_DIR.iterdir()):
        if not path.is_file():
            continue
        name = path.name
        kind = next((k for k in _KINDS if name.lower().endswith(k["suffixes"])), None)
        if kind is None:
            continue
        vt = _version_tuple(name)
        key = (kind["type"], kind["platform"])
        if key in best and best[key][0] >= vt:
            continue
        m = _VERSION_RE.search(name)
        best[key] = (vt, {
            "filename":    name,
            "size_bytes":  path.stat().st_size,
            "name":        kind["name"],
            "version":     m.group(1) if m else "0.0.0",
            "description": kind["description"],
            "platform":    kind["platform"],
            "type":        kind["type"],
            "install_cmd": kind["install_cmd"](name),
            "run_cmd":     kind["run_cmd"],
        })
    return [item for _, item in best.values()]


@router.get("")
def list_downloads():
    return _scan()


@router.get("/{filename}")
def download_file(filename: str):
    # Prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = _DOWNLOADS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=str(path),
        filename=filename,
        media_type="application/octet-stream",
    )
