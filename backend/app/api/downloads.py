"""
Downloads — lists and serves installable packages from /backend/downloads/.

GET  /downloads        → JSON list of available packages with metadata
GET  /downloads/{name} → streams the file as an attachment
"""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/downloads", tags=["downloads"])

_DOWNLOADS_DIR = Path(__file__).resolve().parents[2] / "downloads"

_METADATA: dict[str, dict] = {
    "nebulacode-0.7.0-py3-none-any.whl": {
        "name":        "NebulaCode CLI",
        "version":     "0.7.0",
        "description": "Terminal AI coding assistant — works instantly, no Ollama required",
        "platform":    "all",
        "type":        "python-wheel",
        "install_cmd": "pip install nebulacode-0.7.0-py3-none-any.whl",
        "run_cmd":     "nebula",
    },
    "NebulaX AI_0.6.0_amd64.deb": {
        "name":        "NebulaX Desktop",
        "version":     "0.6.0",
        "description": "Native desktop app for Linux (Debian/Ubuntu) — offline model management, local inference",
        "platform":    "linux",
        "type":        "desktop-app",
        "install_cmd": "sudo dpkg -i 'NebulaX AI_0.6.0_amd64.deb'",
        "run_cmd":     "nebulax-ai",
    },
    "NebulaX-AI_0.6.0_x64-setup.exe": {
        "name":        "NebulaX Desktop",
        "version":     "0.6.0",
        "description": "Native desktop app for Windows — offline model management, local inference",
        "platform":    "windows",
        "type":        "desktop-app",
        "install_cmd": "Run NebulaX-AI_0.6.0_x64-setup.exe",
        "run_cmd":     "NebulaX AI",
    },
    "NebulaX-AI_0.6.0_x64.dmg": {
        "name":        "NebulaX Desktop",
        "version":     "0.6.0",
        "description": "Native desktop app for macOS — offline model management, local inference",
        "platform":    "macos",
        "type":        "desktop-app",
        "install_cmd": "Open NebulaX-AI_0.6.0_x64.dmg and drag to Applications",
        "run_cmd":     "NebulaX AI",
    },
    "nebulax-ai-0.6.0.apk": {
        "name":        "NebulaX Mobile",
        "version":     "0.6.0",
        "description": "Android app — chat with your models on the go",
        "platform":    "android",
        "type":        "mobile-app",
        "install_cmd": "Enable Unknown Sources and install the APK",
        "run_cmd":     "NebulaX AI",
    },
}


@router.get("")
def list_downloads():
    items = []
    for fname, meta in _METADATA.items():
        path = _DOWNLOADS_DIR / fname
        if path.exists():
            items.append({
                "filename": fname,
                "size_bytes": path.stat().st_size,
                **meta,
            })
    return items


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
