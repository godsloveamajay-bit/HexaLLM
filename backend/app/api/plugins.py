"""Plugin management API.

Every route requires admin: a plugin's code runs with the backend's
authority, so installing or enabling one is an operator decision, not a
user-facing one. Regular users never reach these endpoints — they just get
plugin tools appearing in the agent and workflow tool pickers.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import tarfile
import tempfile
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.security import require_admin
from ..models.plugin import PluginInstall
from ..services import plugin_service
from ..services.plugin_service import PluginError, plugin_data_dir, registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plugins", tags=["plugins"])


# ── Helpers ─────────────────────────────────────────────────────────────────

def _refresh_registry(db: Session) -> None:
    """Re-scan the plugins dir and re-apply the DB's enable flags.

    Must run before anything reads ``registry.plugins``, otherwise a freshly
    started process has an empty registry and every plugin looks missing.
    """
    rows = db.query(PluginInstall).all()
    registry.refresh(enabled_names={r.name: bool(r.is_enabled) for r in rows})


def _sync_db(db: Session) -> Dict[str, PluginInstall]:
    """Reconcile the DB with what discovery found on disk.

    A plugin that disappeared from PLUGINS_DIR is dropped from the DB; a newly
    discovered one is inserted *disabled*, so nothing starts executing without
    an explicit enable.
    """
    _refresh_registry(db)

    found = registry.plugins
    known = {row.name: row for row in db.query(PluginInstall).all()}

    for name, row in known.items():
        if name not in found:
            db.delete(row)
            db.flush()

    for name, plugin in found.items():
        m = plugin.manifest
        row = known.get(name)
        if row is None:
            row = PluginInstall(
                name=name,
                version=m.version,
                author=m.author,
                description=m.description,
                source="local",
                isolation=m.isolation,
                is_enabled=False,  # never auto-enable discovered code
                manifest=m.to_dict(),
                last_error=plugin.error,
            )
            db.add(row)
        else:
            row.version = m.version
            row.author = m.author
            row.description = m.description
            row.isolation = m.isolation
            row.manifest = m.to_dict()
            row.last_error = plugin.error

    db.commit()
    return {row.name: row for row in db.query(PluginInstall).all()}


def _serialize(row: PluginInstall, plugin: Optional[plugin_service.LoadedPlugin]) -> Dict[str, Any]:
    m = plugin.manifest if plugin else None
    return {
        "name": row.name,
        "version": row.version,
        "author": row.author,
        "description": row.description,
        "source": row.source,
        "isolation": row.isolation,
        "is_enabled": bool(row.is_enabled),
        "installed_at": row.installed_at,
        "last_error": row.last_error,
        # Fresh from disk, so the UI reflects edits without a restart.
        "tools": [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "input_schema": t.get("input_schema", {}),
            }
            for t in (m.tools if m else [])
        ],
        "permissions": (m.permissions.to_dict() if m else {}),
        "valid": plugin is not None and not plugin.error,
        "validation_error": plugin.error if plugin else "plugin files are missing",
    }


def _load_enabled(db: Session) -> None:
    """Rebuild the in-memory registry from the DB's enable flags."""
    _refresh_registry(db)


# ── Schemas ─────────────────────────────────────────────────────────────────

class PluginOut(BaseModel):
    name: str
    version: Optional[str] = None
    author: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    isolation: str
    is_enabled: bool
    installed_at: Optional[datetime] = None
    last_error: Optional[str] = None
    tools: List[Dict[str, Any]] = []
    permissions: Dict[str, Any] = {}
    valid: bool
    validation_error: Optional[str] = None


class PluginListOut(BaseModel):
    plugins: List[PluginOut]
    total: int
    enabled: int
    available_tools: int
    plugins_enabled_globally: bool
    plugins_dir: str


class CallRequest(BaseModel):
    tool: str
    args: Dict[str, Any] = Field(default_factory=dict)


class CallOut(BaseModel):
    tool: str
    plugin: str
    output: str
    latency_ms: int


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("", response_model=PluginListOut)
def list_plugins(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    rows = _sync_db(db)
    _load_enabled(db)
    out = []
    for name, row in rows.items():
        out.append(_serialize(row, registry.plugins.get(name)))
    return PluginListOut(
        plugins=out,
        total=len(out),
        enabled=sum(1 for r in out if r["is_enabled"]),
        available_tools=len(registry.tool_specs()),
        plugins_enabled_globally=bool(settings.PLUGINS_ENABLED),
        plugins_dir=plugin_service._plugins_root(),
    )


@router.get("/tools", response_model=List[Dict[str, Any]])
def list_tools(
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Flat list of every tool contributed by an enabled plugin."""
    _load_enabled(db)
    return registry.tool_specs()


@router.get("/marketplace")
def marketplace(_admin=Depends(require_admin)):
    """No remote registry is configured.

    Deliberately empty rather than a stub: plugins are installed from local
    archives. A future remote source would go here, with signature
    verification, and would need to be opt-in.
    """
    return {
        "sources": [],
        "note": (
            "No remote marketplace is configured. Install plugins with "
            "POST /api/v1/plugins/install using a .tar.gz or .zip archive."
        ),
    }


@router.get("/{name}/manifest")
def get_manifest(
    name: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    _load_enabled(db)
    plugin = registry.plugins.get(name)
    if plugin is None:
        raise HTTPException(404, f"plugin {name!r} is not installed")
    if plugin.error:
        raise HTTPException(400, f"plugin {name!r} is invalid: {plugin.error}")
    return plugin.manifest.to_dict()


@router.post("/{name}/enable", response_model=PluginOut)
def enable_plugin(
    name: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    row = db.query(PluginInstall).filter(PluginInstall.name == name).first()
    if row is None:
        raise HTTPException(404, f"plugin {name!r} is not installed")

    _sync_db(db)
    plugin = registry.plugins.get(name)
    if plugin is None or plugin.error:
        raise HTTPException(400, f"plugin {name!r} failed validation: "
                                  f"{plugin.error if plugin else 'missing'}")

    row.is_enabled = True
    db.commit()
    _load_enabled(db)
    logger.info("Plugin enabled: %s", name)
    return _serialize(row, registry.plugins.get(name))


@router.post("/{name}/disable", response_model=PluginOut)
def disable_plugin(
    name: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    row = db.query(PluginInstall).filter(PluginInstall.name == name).first()
    if row is None:
        raise HTTPException(404, f"plugin {name!r} is not installed")
    row.is_enabled = False
    db.commit()
    _load_enabled(db)
    logger.info("Plugin disabled: %s", name)
    return _serialize(row, registry.plugins.get(name))


@router.post("/{name}/call", response_model=CallOut)
async def call_plugin_tool(
    name: str,
    body: CallRequest,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Invoke a tool on a specific plugin (for testing from the UI)."""
    _load_enabled(db)
    plugin = registry.plugins.get(name)
    if plugin is None or not plugin.enabled:
        raise HTTPException(400, f"plugin {name!r} is not installed or is disabled")

    tool = body.tool
    if tool not in {t["name"] for t in plugin.manifest.tools}:
        raise HTTPException(400, f"plugin {name!r} does not declare tool {tool!r}")

    import time
    started = time.time()
    try:
        output = await registry.call(tool, body.args)
    except PluginError as exc:
        raise HTTPException(400, str(exc))
    latency = int((time.time() - started) * 1000)

    row = db.query(PluginInstall).filter(PluginInstall.name == name).first()
    if row:
        row.last_used_at = datetime.now(timezone.utc)
        row.last_error = None
        db.commit()
    return CallOut(tool=tool, plugin=name, output=output, latency_ms=latency)


@router.post("/install_archive", response_model=PluginOut)
def install_plugin_archive(
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    """Install from a local .tar.gz or .zip archive path on the server.

    Takes a path rather than an upload so a plugin can be installed from CI or
    a synced directory. The archive is extracted into a temp dir, validated,
    and only then moved into PLUGINS_DIR.
    """
    path = str(payload.get("path") or "").strip()
    if not path:
        raise HTTPException(400, "'path' is required")
    if not os.path.isfile(path):
        raise HTTPException(404, f"no such file: {path}")
    if not (path.endswith((".tar.gz", ".tgz", ".zip"))):
        raise HTTPException(400, "archive must be .tar.gz, .tgz or .zip")

    tmp = tempfile.mkdtemp(prefix="hexallm_plugin_")
    try:
        try:
            if path.endswith(".zip"):
                with zipfile.ZipFile(path) as zf:
                    _safe_extract_zip(zf, tmp)
            else:
                with tarfile.open(path, "r:gz") as tf:
                    _safe_extract_tar(tf, tmp)
        except PluginError:
            raise
        except Exception as exc:
            raise HTTPException(400, f"could not read archive: {exc}")

        # The archive may or may not wrap everything in a single directory.
        root = tmp
        entries = [e for e in os.listdir(tmp) if not e.startswith((".", "__MACOSX"))]
        if len(entries) == 1 and os.path.isdir(os.path.join(tmp, entries[0])):
            root = os.path.join(tmp, entries[0])

        manifest_path = os.path.join(root, "manifest.json")
        if not os.path.isfile(manifest_path):
            raise HTTPException(400, "archive has no manifest.json at its root")
        with open(manifest_path) as f:
            try:
                manifest = plugin_service.PluginManifest.from_dict(json.load(f), root)
            except json.JSONDecodeError as exc:
                raise HTTPException(400, f"manifest.json is not valid JSON: {exc}")
            except PluginError as exc:
                raise HTTPException(400, str(exc))

        dest = os.path.join(plugin_service._plugins_root(), manifest.name)
        if os.path.exists(dest):
            raise HTTPException(409, f"plugin {manifest.name!r} is already installed")

        shutil.move(root, dest)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    _load_enabled(db)
    rows = _sync_db(db)
    row = rows.get(manifest.name)
    if row is None:
        raise HTTPException(500, "plugin installed but could not be recorded")
    logger.info("Plugin installed: %s v%s", manifest.name, manifest.version)
    return _serialize(row, registry.plugins.get(manifest.name))


@router.delete("/{name}", status_code=204)
def uninstall_plugin(
    name: str,
    db: Session = Depends(get_db),
    purge_data: bool = False,
    _admin=Depends(require_admin),
):
    plugin = registry.plugins.get(name)
    if plugin is None:
        raise HTTPException(404, f"plugin {name!r} is not installed")

    # A single leading underscore guards the internal _data directory.
    if name.startswith("_") or "/" in name or ".." in name:
        raise HTTPException(400, "invalid plugin name")

    shutil.rmtree(plugin.path, ignore_errors=True)
    if purge_data:
        shutil.rmtree(plugin_data_dir(name), ignore_errors=True)

    _load_enabled(db)
    _sync_db(db)
    logger.info("Plugin uninstalled: %s (data purged: %s)", name, purge_data)


# ── Archive safety ──────────────────────────────────────────────────────────

def _is_within(base: str, target: str) -> bool:
    base = os.path.realpath(base)
    target = os.path.realpath(target)
    return target == base or target.startswith(base + os.sep)


def _safe_extract_tar(tf: tarfile.TarFile, dest: str) -> None:
    for member in tf.getmembers():
        if member.issym() or member.islnk():
            raise HTTPException(400, f"archive contains a link: {member.name}")
        if not _is_within(dest, os.path.join(dest, member.name)):
            raise HTTPException(400, f"archive path escapes target dir: {member.name}")
    tf.extractall(dest)


def _safe_extract_zip(zf: zipfile.ZipFile, dest: str) -> None:
    for member in zf.namelist():
        normalised = os.path.normpath(member)
        if normalised.startswith(("/", "..")) or os.path.isabs(normalised):
            raise HTTPException(400, f"archive path escapes target dir: {member}")
        if not _is_within(dest, os.path.join(dest, normalised)):
            raise HTTPException(400, f"archive path escapes target dir: {member}")
    zf.extractall(dest)
