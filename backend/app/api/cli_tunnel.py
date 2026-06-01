"""
CLI Tunnel — lets the NebulaX web UI dispatch tasks to a connected
nebula-cli daemon running on a user's local machine.

Protocol (WebSocket, JSON messages):

  Server → CLI:
    {"type": "registered", "session_id": "..."}
    {"type": "run",  "task_id": "...", "task": "...", "model": "...", "tools": [...]}
    {"type": "ping"}

  CLI → Server:
    {"type": "connected", "hostname": "...", "cwd": "...", "platform": "..."}
    {"type": "step",  "task_id": "...", "name": "...", "input": "...", "output": "...", "thought": "..."}
    {"type": "done",  "task_id": "...", "result": "...", "steps": [...]}
    {"type": "error", "task_id": "...", "error": "..."}
    {"type": "pong"}
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User

router = APIRouter(tags=["cli-tunnel"])


# ── In-memory session registry ─────────────────────────────────────────────────
# user_id → {session_id → _CliSession}

class _CliSession:
    def __init__(self, ws: WebSocket, session_id: str):
        self.ws = ws
        self.session_id = session_id
        self.info: dict = {}
        self.connected_at = datetime.now(timezone.utc)
        self.task_queues: Dict[str, asyncio.Queue] = {}


_registry: Dict[int, Dict[str, _CliSession]] = {}


# ── WebSocket auth helper ──────────────────────────────────────────────────────

def _user_from_token(token: str, db: Session) -> Optional[User]:
    try:
        from ..core.config import settings
        from jose import jwt, JWTError
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = int(payload["sub"])
        return db.query(User).filter(User.id == user_id, User.is_active == True).first()
    except Exception:
        return None


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

@router.websocket("/ws/cli")
async def cli_websocket(
    ws: WebSocket,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    user = _user_from_token(token, db)
    if not user:
        await ws.close(code=4001, reason="Unauthorized")
        return

    await ws.accept()
    session_id = str(uuid.uuid4())[:8]
    session = _CliSession(ws, session_id)

    _registry.setdefault(user.id, {})[session_id] = session

    try:
        await ws.send_json({"type": "registered", "session_id": session_id})

        async for msg in ws.iter_json():
            msg_type = msg.get("type", "")

            if msg_type == "connected":
                session.info = {k: msg.get(k, "?") for k in ("hostname", "cwd", "platform")}

            elif msg_type in ("step", "done", "error", "tool_result"):
                task_id = msg.get("task_id")
                q = session.task_queues.get(task_id)
                if q:
                    await q.put(msg)
                    if msg_type in ("done", "error"):
                        session.task_queues.pop(task_id, None)

            elif msg_type == "pong":
                pass

    except WebSocketDisconnect:
        pass
    finally:
        _registry.get(user.id, {}).pop(session_id, None)
        if not _registry.get(user.id):
            _registry.pop(user.id, None)


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

@router.get("/cli/sessions")
def list_cli_sessions(current_user: User = Depends(get_current_user)):
    sessions = _registry.get(current_user.id, {})
    return [
        {
            "session_id": sid,
            "hostname":   s.info.get("hostname", "?"),
            "cwd":        s.info.get("cwd", "?"),
            "platform":   s.info.get("platform", "?"),
            "connected_at": s.connected_at.isoformat(),
        }
        for sid, s in sessions.items()
    ]


class CliRunRequest(BaseModel):
    task: str
    session_id: Optional[str] = None
    model: str = "llama3:8B"
    tools: List[str] = ["web_search", "code_exec", "bash_exec", "read_file", "write_file"]


@router.post("/cli/run")
async def run_on_cli(
    data: CliRunRequest,
    current_user: User = Depends(get_current_user),
):
    user_sessions = _registry.get(current_user.id, {})
    if not user_sessions:
        raise HTTPException(
            status_code=404,
            detail="No CLI connected. Run `nebula daemon` on your machine first.",
        )

    sid = data.session_id or next(iter(user_sessions))
    session = user_sessions.get(sid)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{sid}' not found.")

    task_id = str(uuid.uuid4())
    q: asyncio.Queue = asyncio.Queue()
    session.task_queues[task_id] = q

    await session.ws.send_json({
        "type":    "run",
        "task_id": task_id,
        "task":    data.task,
        "model":   data.model,
        "tools":   data.tools,
    })

    async def event_stream():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=300)
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'error', 'error': 'CLI timed out after 5 min'})}\n\n"
                    break
                yield f"data: {json.dumps(msg)}\n\n"
                if msg.get("type") in ("done", "error"):
                    break
        finally:
            session.task_queues.pop(task_id, None)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
