"""Dev-site-only endpoints: system telemetry, request analytics, live logs.

Admin-gated; used by the dev portal (dev.hexallm.co.uk) pages.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import func, text

from ..core.database import SessionLocal, get_db
from ..core.security import require_admin, get_current_user
from ..models.chat import RequestLog
from ..models.user import User
from ..core.config import settings
from jose import jwt

router = APIRouter(tags=["dev"])

# ──────────────────────────────────────────────────────────────────────────────
# WebSocket: system monitor push
# ──────────────────────────────────────────────────────────────────────────────

class _SystemBroadcaster:
    def __init__(self):
        self._clients: Set[WebSocket] = set()
        self._task: Optional[asyncio.Task] = None

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.add(ws)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._broadcast_loop())

    def disconnect(self, ws: WebSocket):
        self._clients.discard(ws)

    async def _broadcast_loop(self):
        while self._clients:
            data = await _gather_system_snapshot()
            dead = []
            for ws in self._clients:
                try:
                    await ws.send_json(data)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self._clients.discard(ws)
            await asyncio.sleep(3)

_system_broadcaster = _SystemBroadcaster()


def _user_from_token(token: str, db: Session) -> Optional[User]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = int(payload["sub"])
        return db.query(User).filter(User.id == user_id, User.is_active).first()
    except Exception:
        return None


@router.websocket("/ws/system")
async def system_websocket(ws: WebSocket, token: str = Query(...)):
    """Push system stats every ~3s. Auth via token query param."""
    db_gen = get_db()
    db: Session = next(db_gen)
    try:
        user = _user_from_token(token, db)
    except Exception:
        await ws.close(code=4001, reason="Unauthorized")
        return
    if not user or not user.is_admin:
        await ws.close(code=4003, reason="Admin required")
        return
    try:
        await _system_broadcaster.connect(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
    finally:
        _system_broadcaster.disconnect(ws)
        try:
            next(db_gen)
        except StopIteration:
            pass

SERVICES = ["hexallm-backend", "hexallm-vllm", "ollama", "hexallm-tunnel", "hexallm-dev"]

GPU_QUERY = (
    "index,name,memory.total,memory.used,memory.free,utilization.gpu,"
    "utilization.memory,temperature.gpu,power.draw,power.limit"
)


def _run(cmd: List[str], timeout: float = 5.0) -> Optional[str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if proc.returncode == 0:
            return proc.stdout.strip()
    except Exception:
        pass
    return None


def _host_stats() -> Dict[str, Any]:
    stats: Dict[str, Any] = {}
    try:
        import psutil

        vm = psutil.virtual_memory()
        stats["cpu_percent"] = psutil.cpu_percent(interval=0.3)
        stats["cpu_count"] = psutil.cpu_count()
        stats["load_avg"] = list(os.getloadavg())
        stats["mem"] = {"total": vm.total, "used": vm.used, "available": vm.available, "percent": vm.percent}
        stats["disk"] = {"total": psutil.disk_usage("/").total, "used": psutil.disk_usage("/").used, "percent": psutil.disk_usage("/").percent}
        stats["uptime_sec"] = round(time.time() - psutil.boot_time())
        stats["hostname"] = os.uname().nodename
        stats["processes"] = [
            {
                "pid": p.info["pid"],
                "name": p.info["name"],
                "cpu_percent": round(p.info["cpu_percent"] or 0, 1),
                "mem_mb": round((p.info["memory_info"].rss or 0) / 1024 / 1024),
                "cmd": " ".join((p.info["cmdline"] or [])[:4]),
            }
            for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info", "cmdline"])
            if p.info["name"]
            and any(k in " ".join(p.info["cmdline"] or []) for k in ("vllm", "ollama", "uvicorn", "vite"))
            and p.info["name"] not in ("psutil", "python3", "systemd")
        ][:14]
    except Exception as exc:  # pragma: no cover
        stats["error"] = str(exc)
    return stats


def _gpu_stats() -> List[Dict[str, Any]]:
    out = _run(["/usr/lib/wsl/lib/nvidia-smi", "--query-gpu=" + GPU_QUERY, "--format=csv,noheader,nounits"])
    if not out:
        out = _run(["nvidia-smi", "--query-gpu=" + GPU_QUERY, "--format=csv,noheader,nounits"])
    if not out:
        return []
    gpus: List[Dict[str, Any]] = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 10:
            continue
        try:
            def _num(v: str) -> float:
                v = v.strip().split()[0]
                return float(v) if v not in ("[N/A]", "N/A") else 0.0

            gpus.append(
                {
                    "index": int(parts[0]),
                    "name": parts[1],
                    "mem_total_mb": int(parts[2].split()[0]),
                    "mem_used_mb": int(parts[3].split()[0]),
                    "mem_free_mb": int(parts[4].split()[0]),
                    "util_percent": _num(parts[5]),
                    "mem_util_percent": _num(parts[6]),
                    "temp_c": _num(parts[7]),
                    "power_w": _num(parts[8]),
                    "power_limit_w": _num(parts[9]),
                }
            )
        except (ValueError, IndexError):
            continue
    return gpus


async def _service_state(unit: str) -> Dict[str, Any]:
    active = _run(["systemctl", "is-active", unit]) == "active"
    state: Dict[str, Any] = {"unit": unit, "active": active}
    if active:
        try:
            out = _run(["systemctl", "show", unit, "-p", "ActiveEnterTimestamp", "-p", "MainPID"])
            for line in (out or "").splitlines():
                if "=" in line:
                    key, _, val = line.partition("=")
                    if key == "ActiveEnterTimestamp" and val:
                        try:
                            state["since"] = datetime.strptime(val, "%a %Y-%m-%d %H:%M:%S %Z")
                        except ValueError:
                            pass
                    elif key == "MainPID":
                        state["pid"] = val
        except Exception:
            pass
    return state


async def _ollama_health() -> Optional[Dict[str, Any]]:
    try:
        import httpx

        async with httpx.AsyncClient(timeout=4) as client:
            tags = await client.get("http://localhost:11434/api/tags")
            if tags.status_code != 200:
                return {"ok": False, "detail": f"http {tags.status_code}"}
            data = tags.json()
            models = [m.get("name", "?") for m in data.get("models", [])]
            return {"ok": True, "models": models}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


async def _vllm_health() -> Optional[Dict[str, Any]]:
    try:
        import httpx

        async with httpx.AsyncClient(timeout=4) as client:
            health = await client.get("http://localhost:8001/health")
            model = await client.get("http://localhost:8001/v1/models")
            return {
                "ok": health.status_code == 200,
                "status": health.status_code,
                "model": model.json()["data"][0]["id"] if model.status_code == 200 else None,
            }
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


async def _gather_system_snapshot() -> Dict[str, Any]:
    """Shared by HTTP and WebSocket endpoints."""
    results = await asyncio.gather(
        *([_service_state(u) for u in SERVICES]),
        _ollama_health(),
        _vllm_health(),
        return_exceptions=True,
    )
    services = results[: len(SERVICES)]
    ollama, vllm = results[len(SERVICES) :]
    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "host": _host_stats(),
        "gpu": _gpu_stats(),
        "services": [s for s in services if isinstance(s, dict)],
        "ollama": ollama if isinstance(ollama, dict) else {"ok": False, "detail": "unreachable"},
        "vllm": vllm if isinstance(vllm, dict) else {"ok": False, "detail": "unreachable"},
    }


@router.get("/dev/system")
async def dev_system(_admin=Depends(require_admin)) -> Dict[str, Any]:
    return await _gather_system_snapshot()


@router.get("/dev/analytics")
async def dev_analytics(
    hours: int = Query(24, ge=1, le=168),
    _admin=Depends(require_admin),
) -> Dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    db = SessionLocal()
    try:
        total = db.query(func.count(RequestLog.id)).filter(RequestLog.created_at >= since).scalar() or 0
        errors = (
            db.query(func.count(RequestLog.id))
            .filter(RequestLog.created_at >= since, RequestLog.status_code >= 400)
            .scalar()
            or 0
        )
        tok = (
            db.query(func.coalesce(func.sum(RequestLog.prompt_tokens), 0) + func.coalesce(func.sum(RequestLog.completion_tokens), 0))
            .filter(RequestLog.created_at >= since)
            .scalar()
            or 0
        )
        lat = db.query(func.avg(RequestLog.latency_ms)).filter(RequestLog.created_at >= since).scalar()
        lat_ok = db.query(func.avg(RequestLog.latency_ms)).filter(RequestLog.created_at >= since, RequestLog.status_code < 400).scalar()

        rows = (
            db.query(
                RequestLog.model_name,
                func.count(RequestLog.id),
                func.sum(RequestLog.prompt_tokens + RequestLog.completion_tokens),
                func.avg(RequestLog.latency_ms),
                func.count(RequestLog.id).filter(RequestLog.status_code >= 400),
            )
            .filter(RequestLog.created_at >= since)
            .group_by(RequestLog.model_name)
            .order_by(func.count(RequestLog.id).desc())
            .limit(10)
            .all()
        )
        per_model = [
            {
                "model": r[0] or "n/a",
                "requests": r[1],
                "tokens": int(r[2] or 0),
                "avg_latency_ms": round(r[3], 1) if r[3] else None,
                "errors": r[4],
            }
            for r in rows
        ]

        endpoints = (
            db.query(RequestLog.endpoint, func.count(RequestLog.id))
            .filter(RequestLog.created_at >= since)
            .group_by(RequestLog.endpoint)
            .order_by(func.count(RequestLog.id).desc())
            .limit(10)
            .all()
        )

        hourly = db.execute(
            text(
                "SELECT strftime('%H', created_at) AS h, COUNT(*) AS n, "
                "SUM(prompt_tokens + completion_tokens) AS tokens, "
                "SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errs "
                "FROM request_logs WHERE created_at >= :since GROUP BY h ORDER BY h"
            ),
            {"since": since},
        ).fetchall()
        hourly_rows = [
            {"hour": f"{int(r[0]):02d}:00", "requests": r[1], "tokens": int(r[2] or 0), "errors": int(r[3] or 0)}
            for r in hourly
        ]
        if not hourly_rows:
            hourly_rows = [{"hour": f"{h:02d}:00", "requests": 0, "tokens": 0, "errors": 0} for h in range(24)]

        return {
            "hours": hours,
            "totals": {
                "requests": total,
                "errors": errors,
                "error_rate": round(errors / total * 100, 2) if total else 0.0,
                "tokens": int(tok),
                "avg_latency_ms": round(lat, 1) if lat else None,
                "avg_ok_latency_ms": round(lat_ok, 1) if lat_ok else None,
            },
            "per_model": per_model,
            "endpoints": [{"endpoint": e[0], "requests": e[1]} for e in endpoints],
            "hourly": hourly_rows,
        }
    finally:
        db.close()


@router.get("/dev/logs")
async def dev_logs(
    unit: str = Query("hexallm-backend"),
    lines: int = Query(300, ge=10, le=2000),
    q: str = Query("", max_length=100),
    _admin=Depends(require_admin),
) -> Dict[str, Any]:
    if unit not in SERVICES:
        return {"unit": unit, "error": "unknown unit"}
    out = _run(["journalctl", "-u", unit, "-n", str(lines), "--no-pager", "-o", "short-iso"])
    if out is None:
        return {"unit": unit, "error": "journalctl unavailable"}
    entries = [ln for ln in out.splitlines() if ln.strip()]
    if q:
        entries = [ln for ln in entries if q.lower() in ln.lower()]
    return {"unit": unit, "lines": len(entries), "entries": entries[-lines:]}