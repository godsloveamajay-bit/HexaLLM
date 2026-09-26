"""Plugin system: discovery, permission enforcement, and tool dispatch.

Design notes
------------
A plugin is a directory under ``settings.PLUGINS_DIR``::

    plugins/<name>/manifest.json
    plugins/<name>/plugin.py

``plugin.py`` must expose two module-level names:

* ``TOOLS`` — a list of ``{"name", "description", "input_schema"}`` dicts.
* ``run(tool_name: str, args: dict) -> str`` — the dispatcher.

**Loading a plugin executes its code**, so discovery is admin-gated and each
plugin is *disabled* by default until an admin enables it.

Two isolation modes, and the difference is not cosmetic:

``sandbox`` (default)
    The plugin runs as a fresh Python script in a subprocess, with its own
    working directory, a hard timeout, output capped, and the dangerous stdlib
    modules removed unless the manifest declares permission for them. This is
    the only mode that gives any real isolation.

``inprocess``
    The module is imported and ``run`` is awaited directly. Faster, but it has
    exactly the authority of the backend process — treat enabling this as
    running the plugin's author yourself. Reserved for first-party plugins.

The filesystem/network/secret permissions in a manifest are *enforced* in
sandbox mode by the generated harness, not merely documented.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from contextvars import ContextVar
from pathlib import PurePosixPath
from typing import Tuple
from typing import Any, Callable, Dict, List, Optional

from ..core.config import settings
from ..core.database import SessionLocal
from ..services.sandbox_service import Sandbox

logger = logging.getLogger(__name__)

PLUGIN_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,48}$")
TOOL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_]{1,63}$")

VALID_ISOLATION = {"sandbox", "inprocess"}


class PluginError(Exception):
    """Raised for anything wrong with a plugin's definition or invocation."""


class PluginRateLimited(PluginError):
    """Raised when a plugin or user exceeds its declared call quota."""

    def __init__(self, message: str, scope: str, retry_after: int):
        super().__init__(message)
        self.scope = scope        # "user" | "plugin"
        self.retry_after = retry_after


class PluginBudgetExceeded(PluginError):
    """Raised when a plugin exceeds a declared daily budget.

    ``kind`` is "calls" or "cost".
    """

    def __init__(self, message: str, kind: str, retry_after: int):
        super().__init__(message)
        self.kind = kind
        self.retry_after = retry_after


class PluginResult:
    """Optional richer return value for ``run()``.

    A plugin may return a plain string (the original contract) or one of these
    to also declare what the call cost::

        from app.services.plugin_service import PluginResult   # in-process only
        return PluginResult("done", cost_usd=0.002)

    ``cost_usd`` is **self-reported**. The host cannot verify it: a plugin
    calling a third-party API spends money the backend never sees. It exists so
    an operator can budget against declared spend, not to account for it.
    A sandboxed plugin with no ``network`` permission should report 0.
    """

    __slots__ = ("output", "cost_usd")

    def __init__(self, output: str, cost_usd: float = 0.0):
        self.output = output
        try:
            self.cost_usd = max(0.0, float(cost_usd or 0.0))
        except (TypeError, ValueError):
            self.cost_usd = 0.0

    def __str__(self):
        return self.output


@dataclass
class PluginBudget:
    """Daily spend/usage ceilings, plus per-call limits. 0 = unlimited."""

    per_day_calls: int = 0
    max_daily_cost_usd: float = 0.0
    max_output_bytes: int = 0
    max_latency_ms: int = 0

    @classmethod
    def from_dict(cls, raw: Optional[Dict[str, Any]]) -> "PluginBudget":
        raw = raw or {}

        def _int(key: str) -> int:
            val = raw.get(key, 0)
            try:
                val = int(val)
            except (TypeError, ValueError):
                raise PluginError(f"budget.{key} must be an integer")
            return max(0, val)

        cost = raw.get("max_daily_cost_usd", 0) or 0
        try:
            cost = max(0.0, float(cost))
        except (TypeError, ValueError):
            raise PluginError("budget.max_daily_cost_usd must be a number")

        return cls(
            per_day_calls=_int("per_day_calls"),
            max_daily_cost_usd=cost,
            max_output_bytes=_int("max_output_bytes"),
            max_latency_ms=_int("max_latency_ms"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "per_day_calls": self.per_day_calls,
            "max_daily_cost_usd": self.max_daily_cost_usd,
            "max_output_bytes": self.max_output_bytes,
            "max_latency_ms": self.max_latency_ms,
        }

    def is_empty(self) -> bool:
        return not (self.per_day_calls or self.max_daily_cost_usd
                    or self.max_output_bytes or self.max_latency_ms)


@dataclass
class PluginRateLimit:
    """Quotas over a rolling window. 0 (or absent) means unlimited."""

    per_user: int = 0
    per_plugin: int = 0
    period_seconds: int = 60

    @classmethod
    def from_dict(cls, raw: Optional[Dict[str, Any]]) -> "PluginRateLimit":
        raw = raw or {}

        def _int(key: str, default: int = 0) -> int:
            val = raw.get(key, default)
            try:
                val = int(val)
            except (TypeError, ValueError):
                raise PluginError(f"rate_limit.{key} must be an integer")
            return max(0, val)

        period = _int("period_seconds", 60)
        if period == 0:
            period = 60  # a zero-length window would divide by zero
        return cls(
            per_user=_int("per_user"),
            per_plugin=_int("per_plugin"),
            period_seconds=min(period, 86400),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "per_user": self.per_user,
            "per_plugin": self.per_plugin,
            "period_seconds": self.period_seconds,
        }


@dataclass
class PluginPermissions:
    """What a manifest declares. Every field is an allowlist; absent = none."""

    filesystem: List[str] = field(default_factory=list)
    network: List[str] = field(default_factory=list)
    secrets: List[str] = field(default_factory=list)
    subprocess: bool = False

    @classmethod
    def from_dict(cls, raw: Optional[Dict[str, Any]]) -> "PluginPermissions":
        raw = raw or {}

        def _str_list(key: str) -> List[str]:
            val = raw.get(key) or []
            if not isinstance(val, list):
                raise PluginError(f"permissions.{key} must be a list")
            return [str(v) for v in val]

        return cls(
            filesystem=_str_list("filesystem"),
            network=_str_list("network"),
            secrets=_str_list("secrets"),
            subprocess=bool(raw.get("subprocess", False)),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "filesystem": self.filesystem,
            "network": self.network,
            "secrets": self.secrets,
            "subprocess": self.subprocess,
        }


@dataclass
class PluginManifest:
    name: str
    version: str
    description: str = ""
    author: str = ""
    license: str = ""
    entry_point: str = "plugin.py"
    isolation: str = "sandbox"
    permissions: PluginPermissions = field(default_factory=PluginPermissions)
    rate_limit: PluginRateLimit = field(default_factory=PluginRateLimit)
    budget: PluginBudget = field(default_factory=PluginBudget)
    # Days of audit history to keep for *this* plugin. Overrides the global
    # PLUGIN_AUDIT_RETENTION_DAYS when set. 0 means "use the global setting";
    # a negative value pins the plugin's rows indefinitely.
    retention_days: Optional[int] = None
    tools: List[Dict[str, Any]] = field(default_factory=list)
    raw: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any], source_dir: str) -> "PluginManifest":
        if not isinstance(data, dict):
            raise PluginError("manifest must be a JSON object")

        name = str(data.get("name") or "").strip()
        if not PLUGIN_NAME_RE.match(name):
            raise PluginError(
                f"invalid plugin name {name!r}: use lowercase letters, digits, - and _"
            )

        isolation = str(data.get("isolation") or "sandbox").lower()
        if isolation not in VALID_ISOLATION:
            raise PluginError(
                f"unknown isolation {isolation!r}: expected one of {sorted(VALID_ISOLATION)}"
            )

        entry_point = str(data.get("entry_point") or "plugin.py")
        # Confine the entry point to the plugin's own directory.
        if os.path.isabs(entry_point) or ".." in PurePosixPath(entry_point).parts:
            raise PluginError(
                f"entry_point must be relative to the plugin directory: {entry_point!r}"
            )
        if not os.path.isfile(os.path.join(source_dir, entry_point)):
            raise PluginError(f"entry_point not found: {entry_point}")

        tools = data.get("tools") or []
        if not isinstance(tools, list) or not tools:
            raise PluginError("manifest must declare at least one tool")
        seen: set[str] = set()
        for spec in tools:
            if not isinstance(spec, dict):
                raise PluginError("each entry in tools must be an object")
            tname = str(spec.get("name") or "").strip()
            if not TOOL_NAME_RE.match(tname):
                raise PluginError(f"invalid tool name {tname!r}")
            if tname in seen:
                raise PluginError(f"duplicate tool name in manifest: {tname}")
            seen.add(tname)
            if not str(spec.get("description") or "").strip():
                raise PluginError(f"tool {tname} must have a description")

        return cls(
            name=name,
            version=str(data.get("version") or "0.0.0"),
            description=str(data.get("description") or ""),
            author=str(data.get("author") or ""),
            license=str(data.get("license") or ""),
            entry_point=entry_point,
            isolation=isolation,
            permissions=PluginPermissions.from_dict(data.get("permissions")),
            rate_limit=PluginRateLimit.from_dict(data.get("rate_limit")),
            budget=PluginBudget.from_dict(data.get("budget")),
            retention_days=_opt_int(data.get("retention_days"), "retention_days"),
            tools=tools,
            raw=data,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "license": self.license,
            "entry_point": self.entry_point,
            "isolation": self.isolation,
            "permissions": self.permissions.to_dict(),
            "rate_limit": self.rate_limit.to_dict(),
            "budget": self.budget.to_dict(),
            "retention_days": self.retention_days,
            "tools": self.tools,
        }


@dataclass
class LoadedPlugin:
    manifest: PluginManifest
    path: str
    enabled: bool = False
    error: Optional[str] = None


# ── Discovery ────────────────────────────────────────────────────────────────

def _plugins_root() -> str:
    root = settings.PLUGINS_DIR
    if not os.path.isabs(root):
        root = os.path.abspath(os.path.join(os.getcwd(), root))
    return root


def _opt_int(value: Any, field_name: str) -> Optional[int]:
    """Parse an optional integer, allowing -1 to mean "never expire"."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise PluginError(f"{field_name} must be an integer")


def plugin_data_dir(name: str) -> str:
    """Persistent per-plugin storage, exposed to the plugin as $HEXALLM_PLUGIN_DATA.

    Lives under the plugins root so a self-contained install is easy to back
    up or wipe, and is kept out of the plugin's own directory so plugin code
    can't be modified at runtime through its own data dir.
    """
    path = os.path.join(_plugins_root(), "_data", name)
    os.makedirs(path, exist_ok=True)
    return path


def discover() -> Dict[str, LoadedPlugin]:
    """Scan PLUGINS_DIR for plugin directories. Never raises."""
    found: Dict[str, LoadedPlugin] = {}
    root = _plugins_root()
    if not settings.PLUGINS_ENABLED or not os.path.isdir(root):
        return found

    for entry in sorted(os.listdir(root)):
        d = os.path.join(root, entry)
        if entry.startswith((".", "_")) or not os.path.isdir(d):
            continue
        manifest_path = os.path.join(d, "manifest.json")
        if not os.path.isfile(manifest_path):
            continue
        try:
            with open(manifest_path) as f:
                data = json.load(f)
            manifest = PluginManifest.from_dict(data, d)
            found[manifest.name] = LoadedPlugin(manifest=manifest, path=d)
        except Exception as exc:
            # A broken plugin must not stop the others from loading.
            found[entry] = LoadedPlugin(
                manifest=PluginManifest(name=entry, version="0.0.0"),
                path=d,
                enabled=False,
                error=str(exc),
            )
            logger.warning("Plugin %s failed validation: %s", entry, exc)
    return found


# ── Sandbox harness ──────────────────────────────────────────────────────────

def build_harness(plugin_dir: str, entry_point: str, manifest: PluginManifest,
                   data_dir: Optional[str] = None) -> str:
    """Generate the runner executed in the sandbox subprocess.

    The plugin module is loaded by path (not by name) so two plugins with the
    same module name can't shadow each other. Permissions are applied *before*
    the plugin code is imported, so a module can't capture the real socket
    module at import time and use it later.

    ``data_dir`` is a persistent, per-plugin directory, exported to the plugin
    as ``$HEXALLM_PLUGIN_DATA``. Declared relative ``filesystem`` permissions
    resolve inside it, so a plugin can keep state between calls while still
    being unable to touch the rest of the host.
    """
    perms = manifest.permissions
    allowed_hosts = json.dumps(perms.network)
    data_dir = os.path.abspath(data_dir) if data_dir else os.path.abspath(plugin_dir)
    allowed_paths = json.dumps(perms.filesystem)
    want_subprocess = perms.subprocess
    max_output = settings.PLUGIN_MAX_OUTPUT

    return f'''\
import importlib.util, json, os, sys

_ALLOWED_HOSTS = {allowed_hosts}
_ALLOWED_PATHS = {allowed_paths}
_WANT_SUBPROCESS = {want_subprocess}
_PLUGIN_DIR = {plugin_dir!r}
_DATA_DIR = {data_dir!r}
_ENTRY = os.path.join(_PLUGIN_DIR, {entry_point!r})
_MAX_OUT = {max_output}
_RESULT_PATH = os.path.join(_DATA_DIR, "_result.json")

os.makedirs(_DATA_DIR, exist_ok=True)
# The plugin finds its persistent storage here rather than hardcoding a path.
os.environ["HEXALLM_PLUGIN_DATA"] = _DATA_DIR


class _PluginBlocked(Exception):
    pass


def _deny(what):
    raise _PluginBlocked(
        f"{{what}} is not permitted for this plugin. "
        f"Declare it in the manifest permissions to use it."
    )


# ── Filesystem jail ────────────────────────────────────────────────────────
_real_open = open
_ROOTS = [_DATA_DIR] + [
    os.path.realpath(os.path.join(_DATA_DIR, p.lstrip("/")))
    for p in _ALLOWED_PATHS
]


def _in_allowed(path):
    try:
        resolved = os.path.realpath(str(path))
    except Exception:
        return False
    for root in _ROOTS:
        if resolved == root or resolved.startswith(root + os.sep):
            return True
    return False


def _guarded_open(file, mode="r", *a, **kw):
    if any(c in str(mode) for c in "wxa+"):
        if not _in_allowed(file):
            _deny(f"writing to {{file!r}}")
    else:
        if not _in_allowed(file):
            _deny(f"reading {{file!r}}")
    return _real_open(file, mode, *a, **kw)


import builtins
builtins.open = _guarded_open


# ── Network gate ───────────────────────────────────────────────────────────
if not _ALLOWED_HOSTS:
    for _mod in ("socket", "ssl", "http", "urllib", "urllib.request",
                 "urllib3", "requests", "httpx", "ftplib", "telnetlib",
                 "smtplib", "asyncio"):
        sys.modules[_mod] = None
else:
    # Hosts are declared: install a guard that rejects anything else.
    import socket as _socket

    _real_connect = _socket.socket.connect
    _real_connect_ex = _socket.socket.connect_ex

    def _host_allowed(address):
        try:
            host = address[0] if isinstance(address, tuple) else str(address)
        except Exception:
            return False
        host = str(host)
        return any(
            host == h or host.endswith("." + h.lstrip(".")) or h == "*"
            for h in _ALLOWED_HOSTS
        )

    def _guarded_connect(self, address, *a, **kw):
        if not _host_allowed(address):
            _deny(f"network access to {{address!r}}")
        return _real_connect(self, address, *a, **kw)

    def _guarded_connect_ex(self, address, *a, **kw):
        if not _host_allowed(address):
            _deny(f"network access to {{address!r}}")
        return _real_connect_ex(self, address, *a, **kw)

    _socket.socket.connect = _guarded_connect
    _socket.socket.connect_ex = _guarded_connect_ex


# ── Subprocess gate ────────────────────────────────────────────────────────
if not _WANT_SUBPROCESS:
    for _mod in ("subprocess", "commands"):
        sys.modules[_mod] = None


# ── Run ────────────────────────────────────────────────────────────────────
def _emit(payload):
    with _real_open(_RESULT_PATH, "w") as f:
        json.dump(payload, f)
    print("__hexallm_plugin_ok__")


try:
    _spec = importlib.util.spec_from_file_location("hexallm_plugin", _ENTRY)
    if _spec is None or _spec.loader is None:
        raise _PluginBlocked(f"cannot load {{_ENTRY}}")
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules["hexallm_plugin"] = _mod
    _spec.loader.exec_module(_mod)

    _run = getattr(_mod, "run", None)
    if not callable(_run):
        raise _PluginBlocked("plugin.py must define a callable run(tool_name, args)")

    # args/secrets arrive on stdin so nothing sensitive lands in argv.
    _stdin = sys.stdin.read()
    try:
        _payload = json.loads(_stdin or "{{}}")
    except ValueError:
        _payload = {{}}

    # Only the secrets the manifest declared are handed over, and only those
    # that resolved to a real value.
    for _k, _v in (_payload.get("secrets") or {{}}).items():
        os.environ[_k] = str(_v)

    _out = _run(_payload.get("tool", ""), _payload.get("args") or {{}})
    if hasattr(_out, "__await__"):
        import asyncio as _aio
        _out = _aio.run(_out)

    # A plugin may return a plain string, or a PluginResult carrying a
    # self-reported cost. Duck-typed so a sandboxed plugin doesn't need to
    # import anything from HexaLLM.
    _cost = 0.0
    if hasattr(_out, "output") and hasattr(_out, "cost_usd"):
        _cost = float(getattr(_out, "cost_usd", 0.0) or 0.0)
        _out = _out.output

    _text = "" if _out is None else str(_out)
    if len(_text) > _MAX_OUT:
        _text = _text[:_MAX_OUT] + f"\\n... [truncated at {{_MAX_OUT}} chars]"
    _emit({{"ok": True, "output": _text, "cost_usd": _cost}})

except Exception as _exc:
    _emit({{"ok": False,
           "error": f"{{type(_exc).__name__}}: {{_exc}}",
           "blocked": isinstance(_exc, _PluginBlocked)}})
'''


# ── Invocation ──────────────────────────────────────────────────────────────

async def _result_from_sandbox(plugin: LoadedPlugin, tool: str, args: Dict[str, Any],
                               secrets: Dict[str, str], timeout: int) -> Tuple[str, float]:
    data_dir = plugin_data_dir(plugin.manifest.name)
    harness = build_harness(plugin.path, plugin.manifest.entry_point, plugin.manifest, data_dir)
    sb = Sandbox()
    try:
        code_path = os.path.join(sb.workspace, "_plugin_runner.py")
        with open(code_path, "w") as f:
            f.write(harness)

        result_path = os.path.join(data_dir, "_result.json")
        if os.path.exists(result_path):
            os.remove(result_path)

        import subprocess as _sp

        cmd = ["python3", code_path]
        if sb._container_id:
            proc = await asyncio.create_subprocess_exec(
                "docker", "exec", "-i", sb._container_id, *cmd,
                stdin=_sp.PIPE, stdout=_sp.PIPE, stderr=_sp.PIPE,
            )
        else:
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=sb.workspace,
                stdin=_sp.PIPE, stdout=_sp.PIPE, stderr=_sp.PIPE,
            )

        stdin_payload = json.dumps({"tool": tool, "args": args, "secrets": secrets})
        try:
            out, err = await asyncio.wait_for(
                proc.communicate(stdin_payload.encode()), timeout=timeout
            )
        except asyncio.TimeoutError:
            proc.kill()
            raise PluginError(f"plugin timed out after {timeout}s")

        if os.path.exists(result_path):
            with open(result_path) as f:
                data = json.load(f)
            os.remove(result_path)
            if data.get("ok"):
                return str(data.get("output") or ""), float(data.get("cost_usd") or 0.0)
            msg = data.get("error") or "plugin failed"
            if data.get("blocked"):
                raise PluginError(f"{msg} (denied by plugin permissions)")
            raise PluginError(msg)

        # No result file: the harness died before it could report.
        stderr = (err.decode(errors="replace") if err else "").strip()
        raise PluginError(
            f"plugin exited without a result (rc={proc.returncode})"
            + (f": {stderr[-400:]}" if stderr else "")
        )
    finally:
        sb.cleanup()


async def _result_inprocess(plugin: LoadedPlugin, tool: str,
                            args: Dict[str, Any], secrets: Dict[str, str]) -> Tuple[str, float]:
    import importlib.util

    entry = os.path.join(plugin.path, plugin.manifest.entry_point)
    spec = importlib.util.spec_from_file_location(f"hexallm_plugin_{plugin.manifest.name}", entry)
    if spec is None or spec.loader is None:
        raise PluginError(f"cannot load {entry}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)

    run = getattr(mod, "run", None)
    if not callable(run):
        raise PluginError("plugin.py must define a callable run(tool_name, args)")

    result = run(tool, args)
    if hasattr(result, "__await__"):
        result = await result

    # Accept a PluginResult (or anything with .output/.cost_usd) as well as a
    # plain string.
    cost = 0.0
    if hasattr(result, "output") and hasattr(result, "cost_usd"):
        cost = max(0.0, float(getattr(result, "cost_usd", 0.0) or 0.0))
        result = result.output

    text = "" if result is None else str(result)
    if len(text) > settings.PLUGIN_MAX_OUTPUT:
        text = text[: settings.PLUGIN_MAX_OUTPUT] + "\n... [truncated]"
    return text, cost


class PluginRegistry:
    """Holds the discovered plugins and resolves tool names to their owners."""

    def __init__(self):
        self._plugins: Dict[str, LoadedPlugin] = {}
        self._tool_owner: Dict[str, str] = {}
        self._loaded_at: float = 0.0
        self._loaded: bool = False

    # ── lifecycle ────────────────────────────────────────────────────────────
    def refresh(self, enabled_names: Optional[Dict[str, bool]] = None) -> None:
        self._plugins = discover()
        if enabled_names:
            for name, on in enabled_names.items():
                if name in self._plugins:
                    self._plugins[name].enabled = bool(on)
        self._reindex()
        self._loaded_at = time.time()
        self._loaded = True
        enabled = [n for n, p in self._plugins.items() if p.enabled]
        logger.info("Plugins: %d discovered, %d enabled", len(self._plugins), len(enabled))

    def ensure_loaded(self) -> None:
        """Populate from the DB on first use.

        Without this, the registry is only filled as a side effect of someone
        calling the management API — so an agent run or a workflow tool node
        would silently see zero plugin tools.
        """
        if self._loaded:
            return
        try:
            from ..core.database import SessionLocal
            from ..models.plugin import PluginInstall

            db = SessionLocal()
            try:
                rows = db.query(PluginInstall).all()
                self.refresh(enabled_names={r.name: bool(r.is_enabled) for r in rows})
            finally:
                db.close()
        except Exception:
            # A missing table or DB must not break the agent; just no plugins.
            logger.exception("Plugin registry bootstrap failed; continuing without plugins")
            self._loaded = True

    def _reindex(self) -> None:
        self._tool_owner = {}
        for pname, plugin in self._plugins.items():
            if not plugin.enabled or plugin.error:
                continue
            for spec in plugin.manifest.tools:
                tname = spec["name"]
                if tname in self._tool_owner:
                    logger.warning(
                        "Tool %r is declared by both %s and %s; %s wins",
                        tname, self._tool_owner[tname], pname, self._tool_owner[tname],
                    )
                    continue
                self._tool_owner[tname] = pname

    def set_enabled(self, name: str, enabled: bool) -> None:
        if name in self._plugins:
            self._plugins[name].enabled = enabled
            self._reindex()

    # ── queries ──────────────────────────────────────────────────────────────
    @property
    def plugins(self) -> Dict[str, LoadedPlugin]:
        self.ensure_loaded()
        return self._plugins

    def tool_owner(self, tool_name: str) -> Optional[LoadedPlugin]:
        self.ensure_loaded()
        owner = self._tool_owner.get(tool_name)
        return self._plugins.get(owner) if owner else None

    def tool_descriptions(self) -> Dict[str, str]:
        """Tool name -> description, for the agent's prompt."""
        self.ensure_loaded()
        out: Dict[str, str] = {}
        for tname, owner in self._tool_owner.items():
            plugin = self._plugins[owner]
            for spec in plugin.manifest.tools:
                if spec["name"] == tname:
                    prefix = f"[{plugin.manifest.name} plugin] "
                    out[tname] = prefix + str(spec.get("description", ""))
        return out

    def tool_specs(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for tname, owner in sorted(self._tool_owner.items()):
            plugin = self._plugins[owner]
            for spec in plugin.manifest.tools:
                if spec["name"] == tname:
                    out.append({
                        "tool": tname,
                        "plugin": plugin.manifest.name,
                        "description": spec.get("description", ""),
                        "input_schema": spec.get("input_schema", {}),
                    })
        return out

    def tool_schema(self, tool_name: str) -> Dict[str, Any]:
        """The declared input schema for a tool, or {} if unknown."""
        self.ensure_loaded()
        owner = self._tool_owner.get(tool_name)
        if not owner:
            return {}
        for spec in self._plugins[owner].manifest.tools:
            if spec["name"] == tool_name:
                return spec.get("input_schema") or {}
        return {}

    def coerce_string_args(self, tool_name: str, raw: str) -> Dict[str, Any]:
        """Map a bare-string argument onto a tool's object schema.

        Models routinely call a structured tool with a plain string. Rather
        than fail, if the schema has exactly one required property we bind the
        string to it; otherwise we look for a conventional "input"/"text" key.
        Anything we can't map confidently stays under "input".
        """
        schema = self.tool_schema(tool_name)
        required = schema.get("required") or []
        props = schema.get("properties") or {}

        if len(required) == 1 and required[0] in props:
            return {required[0]: raw}
        for key in ("input", "text", "query", "q"):
            if key in props:
                return {key: raw}
        return {"input": raw}

    # ── invocation ───────────────────────────────────────────────────────────
    async def call(self, tool_name: str, args: Dict[str, Any],
                   secret_store: Optional[Callable[[List[str]], Dict[str, str]]] = None,
                   user_id: Optional[int] = None) -> str:
        """Invoke a plugin tool, enforcing quotas and writing an audit row.

        ``user_id`` attributes the call for rate limiting and the audit trail.
        It is optional: an unattributed call still consumes the plugin-wide
        quota, it just isn't charged to a user.
        """
        self.ensure_loaded()
        plugin = self.tool_owner(tool_name)
        if plugin is None:
            raise PluginError(f"no enabled plugin provides tool {tool_name!r}")
        if tool_name not in {s["name"] for s in plugin.manifest.tools}:
            raise PluginError(f"plugin {plugin.manifest.name} does not declare {tool_name!r}")

        if user_id is None:
            user_id = current_actor()

        manifest = plugin.manifest
        budget = manifest.budget
        safe_args, was_redacted = redact_args(args or {}, manifest.permissions.secrets)

        # Quotas first: a refused call is recorded, but it must not consume a
        # slot in the window it was refused for.
        try:
            check_rate_limit(plugin, user_id)
            check_daily_budget(plugin)
        except PluginRateLimited as limited:
            record_call(
                manifest.name, tool_name, user_id, "rate_limited", 0,
                isolation=manifest.isolation, args=safe_args,
                error=str(limited), args_redacted=was_redacted,
            )
            raise
        except PluginBudgetExceeded as over:
            record_call(
                manifest.name, tool_name, user_id, "budget_exceeded", 0,
                isolation=manifest.isolation, args=safe_args,
                error=str(over), args_redacted=was_redacted,
            )
            raise

        secrets: Dict[str, str] = {}
        if manifest.permissions.secrets:
            wanted = set(manifest.permissions.secrets)
            resolver = secret_store or _env_secret_store
            secrets = {k: v for k, v in (resolver(wanted) or {}).items() if k in wanted}

        # The manifest may tighten the ceiling but never raise it.
        timeout = min(
            settings.PLUGIN_MAX_TIMEOUT,
            int(manifest.raw.get("timeout") or settings.PLUGIN_MAX_TIMEOUT),
        )
        if budget.max_latency_ms:
            timeout = min(timeout, max(1, budget.max_latency_ms // 1000) or 1)

        started = time.time()
        try:
            if manifest.isolation == "inprocess":
                out, cost = await _result_inprocess(plugin, tool_name, args, secrets)
            else:
                out, cost = await _result_from_sandbox(plugin, tool_name, args, secrets, timeout)
        except PluginError as exc:
            latency = int((time.time() - started) * 1000)
            # A permission denial is the sandbox doing its job — a distinct
            # status so the audit view can show attempted escapes.
            status = "blocked" if "denied by plugin permissions" in str(exc) else "error"
            record_call(
                manifest.name, tool_name, user_id, status, latency,
                isolation=manifest.isolation, args=safe_args,
                error=str(exc), args_redacted=was_redacted,
            )
            raise

        latency = int((time.time() - started) * 1000)
        out_bytes = len(out.encode("utf-8", errors="replace"))

        # A plugin that overruns its declared per-call latency is reported as
        # an error rather than silently accepted: the work happened, but the
        # budget is blown and the operator should see it.
        if budget.max_latency_ms and latency > budget.max_latency_ms:
            msg = (
                f"{manifest.name}: call took {latency}ms, over the declared "
                f"budget of {budget.max_latency_ms}ms"
            )
            record_call(
                manifest.name, tool_name, user_id, "error", latency,
                isolation=manifest.isolation, args=safe_args,
                output=out, cost_usd=cost, output_bytes=out_bytes,
                error=msg, args_redacted=was_redacted,
            )
            raise PluginBudgetExceeded(msg, kind="latency", retry_after=60)

        if budget.max_output_bytes and out_bytes > budget.max_output_bytes:
            msg = (
                f"{manifest.name}: returned {out_bytes} bytes, over the declared "
                f"budget of {budget.max_output_bytes} bytes"
            )
            record_call(
                manifest.name, tool_name, user_id, "error", latency,
                isolation=manifest.isolation, args=safe_args,
                output=out, cost_usd=cost, output_bytes=out_bytes,
                error=msg, args_redacted=was_redacted,
            )
            raise PluginBudgetExceeded(msg, kind="output", retry_after=60)

        record_call(
            manifest.name, tool_name, user_id, "ok", latency,
            isolation=manifest.isolation, args=safe_args,
            output=out, args_redacted=was_redacted,
            cost_usd=cost, output_bytes=out_bytes,
        )
        return out


def _env_secret_store(wanted: set) -> Dict[str, str]:
    return {name: os.environ[name] for name in wanted if name in os.environ}


# ── Rate limiting + audit ────────────────────────────────────────────────────

# Plugin tool calls happen deep inside agents and background workflow tasks,
# where threading a user id through every layer would be invasive. The current
# actor is carried in a contextvar instead, which propagates correctly across
# awaits within a task. An explicit user_id argument always wins.
_actor_ctx: ContextVar[Optional[int]] = ContextVar("hexallm_plugin_actor", default=None)


def current_actor() -> Optional[int]:
    return _actor_ctx.get()


class actor_scope:
    """Bind the acting user for plugin calls made inside this block.

    Used as a context manager so the previous value is always restored, even if
    the block raises.
    """

    def __init__(self, user_id: Optional[int]):
        self._user_id = user_id
        self._token = None

    def __enter__(self):
        self._token = _actor_ctx.set(self._user_id)
        return self

    def __exit__(self, *exc):
        if self._token is not None:
            _actor_ctx.reset(self._token)
        return False


# How much of an arg / output payload is kept for the audit trail.
AUDIT_PREVIEW_CHARS = 2000
# Statuses that still consume quota. Only a successful call is "free".
_QUOTA_STATUSES = ("ok", "error", "blocked")


def _preview(value: Any, limit: int = AUDIT_PREVIEW_CHARS) -> str:
    try:
        text = value if isinstance(value, str) else json.dumps(value, default=str)
    except Exception:
        text = str(value)
    if len(text) > limit:
        return text[:limit] + f"... [truncated, {len(text)} chars]"
    return text


# Argument keys whose values are masked in the audit trail regardless of what
# the manifest declares. Deliberately specific: a blanket "key"/"value" match
# would redact ordinary data and make the audit view useless.
SECRETISH_KEYS = (
    "token", "secret", "password", "passwd", "credential",
    "api_key", "apikey", "authorization", "auth",
)


def redact_args(args: Dict[str, Any], secrets: List[str]) -> Tuple[Dict[str, Any], bool]:
    """Mask values whose key looks like it carries a credential.

    Only the key *names* are known to the host, never the values, so this is
    best-effort — it stops an obviously-named token from being written to the
    audit table in plaintext.
    """
    if not args:
        return {}, False
    declared = {s.lower() for s in secrets}
    out: Dict[str, Any] = {}
    redacted = False
    for key, value in args.items():
        lowered = str(key).lower()
        if lowered in declared or any(marker in lowered for marker in SECRETISH_KEYS):
            out[key] = "***redacted***"
            redacted = True
        else:
            out[key] = value
    return out, redacted


def check_rate_limit(plugin: LoadedPlugin, user_id: Optional[int]) -> None:
    """Raise PluginRateLimited if this caller is over quota.

    Counts rows in ``plugin_call_logs`` rather than keeping counters in memory,
    so a limit survives a restart and cannot be sidestepped by crashing the
    plugin on purpose.
    """
    limits = plugin.manifest.rate_limit
    if not limits.per_user and not limits.per_plugin:
        return

    since = datetime.now(timezone.utc) - timedelta(seconds=limits.period_seconds)
    from ..models.plugin import PluginCallLog

    db = SessionLocal()
    try:
        base = db.query(PluginCallLog).filter(
            PluginCallLog.plugin_name == plugin.manifest.name,
            PluginCallLog.created_at >= since,
            PluginCallLog.status.in_(_QUOTA_STATUSES),
        )
        retry_after = max(1, limits.period_seconds)

        if limits.per_user and user_id is not None:
            used = base.filter(PluginCallLog.user_id == user_id).count()
            if used >= limits.per_user:
                raise PluginRateLimited(
                    f"{plugin.manifest.name}: rate limit reached for this user "
                    f"({used}/{limits.per_user} calls per {limits.period_seconds}s). "
                    f"Try again in {retry_after}s.",
                    scope="user",
                    retry_after=retry_after,
                )

        if limits.per_plugin:
            used = base.count()
            if used >= limits.per_plugin:
                raise PluginRateLimited(
                    f"{plugin.manifest.name}: plugin-wide rate limit reached "
                    f"({used}/{limits.per_plugin} calls per {limits.period_seconds}s). "
                    f"Try again in {retry_after}s.",
                    scope="plugin",
                    retry_after=retry_after,
                )
    finally:
        db.close()


def _seconds_until_rolling_day(since: datetime) -> int:
    """Seconds until the oldest in-window row ages out of the 24h window."""
    elapsed = (datetime.now(timezone.utc) - since).total_seconds()
    return max(1, int(86400 - elapsed))


def check_daily_budget(plugin: LoadedPlugin) -> None:
    """Raise PluginBudgetExceeded if the plugin is over a declared daily cap.

    Daily windows are what stop a runaway loop from spending all night; the
    per-second ``rate_limit`` only bounds burst rate.
    """
    budget = plugin.manifest.budget
    if not (budget.per_day_calls or budget.max_daily_cost_usd):
        return

    since = datetime.now(timezone.utc) - timedelta(days=1)
    from sqlalchemy import func

    from ..models.plugin import PluginCallLog

    db = SessionLocal()
    try:
        base = db.query(PluginCallLog).filter(
            PluginCallLog.plugin_name == plugin.manifest.name,
            PluginCallLog.created_at >= since,
            PluginCallLog.status.in_(_QUOTA_STATUSES),
        )

        if budget.per_day_calls:
            used = base.count()
            if used >= budget.per_day_calls:
                raise PluginBudgetExceeded(
                    f"{plugin.manifest.name}: daily call budget spent "
                    f"({used}/{budget.per_day_calls} per 24h).",
                    kind="calls",
                    retry_after=_seconds_until_rolling_day(since),
                )

        if budget.max_daily_cost_usd:
            spent = float(
                base.with_entities(
                    func.coalesce(func.sum(PluginCallLog.cost_usd), 0.0)
                ).scalar() or 0.0
            )
            if spent >= budget.max_daily_cost_usd:
                raise PluginBudgetExceeded(
                    f"{plugin.manifest.name}: daily cost budget spent "
                    f"(${spent:.4f} of ${budget.max_daily_cost_usd:.2f} per 24h, "
                    f"as reported by the plugin).",
                    kind="cost",
                    retry_after=_seconds_until_rolling_day(since),
                )
    finally:
        db.close()


def record_call(
    plugin_name: str,
    tool_name: str,
    user_id: Optional[int],
    status: str,
    latency_ms: int,
    isolation: Optional[str] = None,
    args: Optional[Dict[str, Any]] = None,
    output: Optional[str] = None,
    error: Optional[str] = None,
    args_redacted: bool = False,
    cost_usd: float = 0.0,
    output_bytes: int = 0,
) -> None:
    """Append one audit row. Never raises — logging must not break a call."""
    from ..models.plugin import PluginCallLog

    db = SessionLocal()
    try:
        db.add(PluginCallLog(
            plugin_name=plugin_name,
            tool_name=tool_name,
            user_id=user_id,
            status=status,
            latency_ms=latency_ms,
            cost_usd=float(cost_usd or 0.0),
            output_bytes=int(output_bytes or 0),
            isolation=isolation,
            args_preview=_preview(args) if args is not None else None,
            output_preview=_preview(output) if output is not None else None,
            error=_preview(error, 2000) if error else None,
            args_redacted=bool(args_redacted),
        ))
        db.commit()
    except Exception:
        logger.exception("Failed to write plugin_call_logs row")
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


def effective_retention_days(plugin_name: Optional[str]) -> Optional[int]:
    """Days to keep rows for this plugin.

    A plugin's own ``retention_days`` wins over the global setting, in either
    direction. A negative value means "never expire for this plugin"; 0 or
    absent means fall back to the global value.
    """
    global_days = settings.PLUGIN_AUDIT_RETENTION_DAYS
    if not plugin_name:
        return global_days
    plugin = registry.plugins.get(plugin_name)
    declared = plugin.manifest.retention_days if plugin and not plugin.error else None
    if declared is None:
        return global_days
    return declared


def prune_audit(retention_days: Optional[int] = None, batch_size: int = 2000) -> int:
    """Trim the audit trail. Returns the number of rows removed.

    Three independent rules, all optional:

    * **age** — drop rows older than the effective window for their plugin
      (that plugin's ``retention_days``, else ``PLUGIN_AUDIT_RETENTION_DAYS``).
    * **row count** — keep the newest ``PLUGIN_AUDIT_MAX_ROWS`` overall.
    * **size** — keep the newest rows that fit ``PLUGIN_AUDIT_MAX_MB``.

    Batched with a commit between batches: a single unbounded DELETE on SQLite
    holds a write lock for the whole table scan, which would stall live plugin
    calls on a busy install. Ordering by id keeps it to an indexed range scan.
    """
    registry.ensure_loaded()
    override = retention_days
    global_days = settings.PLUGIN_AUDIT_RETENTION_DAYS if override is None else override
    max_rows = max(0, int(settings.PLUGIN_AUDIT_MAX_ROWS or 0))
    max_mb = float(settings.PLUGIN_AUDIT_MAX_MB or 0)

    from sqlalchemy import func

    from ..models.plugin import PluginCallLog

    # Collect candidate ids oldest-first, then delete from that end.
    candidates: List[int] = []

    if global_days != 0:
        # Per-plugin age windows: group by plugin and compare each row's age
        # against that plugin's own window.
        windows: Dict[str, Optional[int]] = {}
        db = SessionLocal()
        try:
            names = [n for (n,) in db.query(PluginCallLog.plugin_name).distinct().all()]
            for name in names:
                windows[name] = effective_retention_days(name)
            if override is not None:
                for name in windows:
                    windows[name] = override

            for name, days in windows.items():
                if days is None or days < 0:
                    continue          # never expires
                if days == 0:
                    continue          # 0 = use global, which is 0 here = keep
                cutoff = datetime.now(timezone.utc) - timedelta(days=days)
                candidates.extend(
                    row_id for (row_id,) in db.query(PluginCallLog.id)
                    .filter(PluginCallLog.plugin_name == name,
                            PluginCallLog.created_at < cutoff)
                    .all()
                )
        finally:
            db.close()

    # Row-count cap: everything beyond the newest max_rows is expendable.
    if max_rows:
        db = SessionLocal()
        try:
            total = db.query(PluginCallLog.id).count()
            if total > max_rows:
                surplus = total - max_rows
                oldest = [
                    row_id for (row_id,) in db.query(PluginCallLog.id)
                    .order_by(PluginCallLog.id).limit(surplus).all()
                ]
                candidates.extend(oldest)
        finally:
            db.close()

    # Size cap: walk from newest backwards, accumulating estimated row size
    # until the budget is spent, then everything older than that goes.
    if max_mb:
        budget_bytes = int(max_mb * 1024 * 1024)
        db = SessionLocal()
        try:
            rows = db.query(
                PluginCallLog.id,
                func.coalesce(func.length(PluginCallLog.args_preview), 0)
                + func.coalesce(func.length(PluginCallLog.output_preview), 0)
                + func.coalesce(func.length(PluginCallLog.error), 0),
            ).order_by(PluginCallLog.id.desc()).all()
            used = 0
            for row_id, size in rows:
                used += int(size or 0)
                if used > budget_bytes:
                    candidates.append(row_id)
        finally:
            db.close()

    if not candidates:
        return 0

    # Unique, and delete oldest first so batches stay contiguous.
    targets = sorted(set(candidates))
    deleted = 0
    for i in range(0, len(targets), batch_size):
        chunk = targets[i: i + batch_size]
        db = SessionLocal()
        try:
            db.query(PluginCallLog).filter(PluginCallLog.id.in_(chunk)).delete(
                synchronize_session=False
            )
            db.commit()
            deleted += len(chunk)
        except Exception:
            logger.exception("Plugin audit prune failed; will retry next cycle")
            try:
                db.rollback()
            except Exception:
                pass
            break
        finally:
            db.close()

    if deleted:
        logger.info("Plugin audit prune: removed %d rows", deleted)
    return deleted


async def audit_prune_loop(stop_event: asyncio.Event) -> None:
    """Background task: prune on a fixed interval until asked to stop.

    Sleeps first so a fresh process doesn't immediately contend with live
    traffic, and prunes at most once per interval even if the loop is delayed.
    """
    interval = max(5, settings.PLUGIN_AUDIT_PRUNE_INTERVAL_MINUTES) * 60
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
            return  # stop_event was set
        except asyncio.TimeoutError:
            pass
        try:
            await asyncio.to_thread(prune_audit)
        except Exception:
            logger.exception("Plugin audit prune cycle failed")


def start_audit_pruner() -> Optional[asyncio.Task]:
    """Start the prune task if retention is enabled. Returns the task, if any."""
    if settings.PLUGIN_AUDIT_RETENTION_DAYS <= 0:
        logger.info("Plugin audit retention disabled — trail is kept forever")
        return None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    stop = asyncio.Event()
    task = loop.create_task(audit_prune_loop(stop))
    # Keep a reference so the task isn't garbage collected mid-run.
    _PRUNE_STATE["stop"] = stop
    logger.info(
        "Plugin audit pruner started: every %d min, retention %d days",
        settings.PLUGIN_AUDIT_PRUNE_INTERVAL_MINUTES,
        settings.PLUGIN_AUDIT_RETENTION_DAYS,
    )
    return task


def stop_audit_pruner() -> None:
    stop = _PRUNE_STATE.get("stop")
    if stop is not None:
        stop.set()
        _PRUNE_STATE["stop"] = None


# Process-wide registry. The API layer and the agent both import this.
registry = PluginRegistry()

# Holds the pruner's stop event between start and stop.
_PRUNE_STATE: Dict[str, Any] = {}
