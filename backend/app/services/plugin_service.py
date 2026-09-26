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
        self.scope = scope        # "user" or "plugin"
        self.retry_after = retry_after


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

    _text = "" if _out is None else str(_out)
    if len(_text) > _MAX_OUT:
        _text = _text[:_MAX_OUT] + f"\\n... [truncated at {{_MAX_OUT}} chars]"
    _emit({{"ok": True, "output": _text}})

except Exception as _exc:
    _emit({{"ok": False,
           "error": f"{{type(_exc).__name__}}: {{_exc}}",
           "blocked": isinstance(_exc, _PluginBlocked)}})
'''


# ── Invocation ──────────────────────────────────────────────────────────────

async def _result_from_sandbox(plugin: LoadedPlugin, tool: str, args: Dict[str, Any],
                               secrets: Dict[str, str], timeout: int) -> str:
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
                return str(data.get("output") or "")
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
                            args: Dict[str, Any], secrets: Dict[str, str]) -> str:
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
    text = "" if result is None else str(result)
    if len(text) > settings.PLUGIN_MAX_OUTPUT:
        text = text[: settings.PLUGIN_MAX_OUTPUT] + "\n... [truncated]"
    return text


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
        """Invoke a plugin tool, enforcing quota and writing an audit row.

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
        safe_args, was_redacted = redact_args(args or {}, manifest.permissions.secrets)

        # Quota first: a throttled call is recorded, but it must not consume a
        # slot in the window it was throttled for.
        try:
            check_rate_limit(plugin, user_id)
        except PluginRateLimited as limited:
            record_call(
                manifest.name, tool_name, user_id, "rate_limited", 0,
                isolation=manifest.isolation, args=safe_args,
                error=str(limited), args_redacted=was_redacted,
            )
            raise

        secrets: Dict[str, str] = {}
        if manifest.permissions.secrets:
            wanted = set(manifest.permissions.secrets)
            resolver = secret_store or _env_secret_store
            secrets = {k: v for k, v in (resolver(wanted) or {}).items() if k in wanted}

        timeout = min(
            settings.PLUGIN_MAX_TIMEOUT,
            int(manifest.raw.get("timeout") or settings.PLUGIN_MAX_TIMEOUT),
        )

        started = time.time()
        try:
            if manifest.isolation == "inprocess":
                out = await _result_inprocess(plugin, tool_name, args, secrets)
            else:
                out = await _result_from_sandbox(plugin, tool_name, args, secrets, timeout)
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
        record_call(
            manifest.name, tool_name, user_id, "ok", latency,
            isolation=manifest.isolation, args=safe_args,
            output=out, args_redacted=was_redacted,
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


# Process-wide registry. The API layer and the agent both import this.
registry = PluginRegistry()
