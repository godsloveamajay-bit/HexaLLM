"""Task execution for admin operational commands.

Whitelisted systemctl actions only — no arbitrary shell access.
"""
from __future__ import annotations

import subprocess
import time
from typing import Any, Dict

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from ..core.database import SessionLocal, get_db
from ..core.security import get_current_user, get_optional_user, require_admin
from ..models.user import User

router = APIRouter(tags=["tasks"])

# ── Whitelisted actions ───────────────────────────────────────────────────────

ACTIONS = {
    "restart_vllm":      {"cmd": ["systemctl", "restart", "hexallm-vllm"],     "desc": "Restart vLLM engine"},
    "restart_ollama":    {"cmd": ["systemctl", "restart", "ollama"],          "desc": "Restart Ollama daemon"},
    "restart_backend":   {"cmd": ["systemctl", "restart", "hexallm-backend"],   "desc": "Restart FastAPI backend"},
    "logs_purge":        {"cmd": ["journalctl", "--vacuum-time=1d"],            "desc": "Purge journals older than 1 day"},
    "status_snapshot":   {"cmd": None,                                                              "desc": "Return status of all services + system stats (read-only)"},
}


def _run_cmd(cmd: list, timeout: float = 15.0) -> Dict[str, Any]:
    """Run a whitelisted command and return output."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {
            "exit_code": result.returncode,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "executed": " ".join(cmd),
        }
    except subprocess.TimeoutExpired:
        return {"exit_code": -1, "stdout": "", "stderr": "command timed out", "executed": " ".join(cmd)}
    except Exception as exc:  # pragma: no cover
        return {"exit_code": -1, "stdout": "", "stderr": f"error: {exc}", "executed": " ".join(cmd)}


# ── endpoint: execute a whitelisted command ──────────────────────────────────

@router.post("/execute", response_model=Dict[str, Any])
async def task_execute(
    action: str = Query(..., pattern="|".join(ACTIONS.keys())),
    _admin=Depends(require_admin),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Execute a whitelisted admin command via systemctl/journalctl."""
    if action not in ACTIONS:
        raise HTTPException(status_code=400, detail="unknown action")

    info = ACTIONS[action]
    if info["cmd"] is None:
        # status_snapshot is special; return system snapshot
        from ..api.dev import _gather_system_snapshot
        return await _gather_system_snapshot()

    result = _run_cmd(info["cmd"])
    result["description"] = info["desc"]
    return result

# ── endpoint: read-only snapshot of all services + system ─────────────────────

@router.get("/snapshot", response_model=Dict[str, Any])
async def task_snapshot(_admin=Depends(require_admin), db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Return status of all managed services + system telemetry (read-only)."""
    from ..api.dev import _gather_system_snapshot
    return await _gather_system_snapshot()
