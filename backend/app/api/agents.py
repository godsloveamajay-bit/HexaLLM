import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
import json
from ..core.database import get_db, SessionLocal
from ..core.security import get_current_user
from ..models.user import User
from ..models.chat import AgentRun
from ..models.mcp_server import MCPServer
from ..schemas.chat import AgentTaskCreate, AgentRunOut
from ..services.agent_service import run_agent
from ..services.mcp_service import MCPClient
from ..services.sandbox_service import Sandbox, DOCKER_AVAILABLE, DOCKER_IMAGE


def _resolve_mcp_clients(db: Session, server_ids: List[int], user_id: int):
    if not server_ids:
        return []
    servers = db.query(MCPServer).filter(
        MCPServer.id.in_(server_ids),
        MCPServer.user_id == user_id,
        MCPServer.is_active == True,
    ).all()
    clients = []
    for s in servers:
        client = MCPClient(s.url)
        client.tools_cache = s.tools_cache or []
        clients.append((s.name, client))
    return clients

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/sandbox/status")
def sandbox_status():
    return {
        "docker_available": DOCKER_AVAILABLE,
        "mode": "docker" if DOCKER_AVAILABLE else "subprocess",
        "image": DOCKER_IMAGE if DOCKER_AVAILABLE else None,
        "limits": {
            "memory": "256m",
            "cpus": "0.5",
            "pids": 64,
            "network": "none",
        } if DOCKER_AVAILABLE else None,
    }


@router.post("/run", response_model=AgentRunOut, status_code=201)
async def run_agent_task(
    data: AgentTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent_run = AgentRun(
        user_id=current_user.id,
        model_name=data.model,
        task=data.task,
        status="running",
        steps=[],
    )
    db.add(agent_run)
    db.commit()
    db.refresh(agent_run)

    async def on_step(step):
        agent_run.steps = list(agent_run.steps or []) + [step]
        db.commit()

    sandbox = Sandbox()
    try:
        mcp_clients = _resolve_mcp_clients(db, data.mcp_server_ids, current_user.id)
        result = await run_agent(
            task=data.task,
            model=data.model,
            tools=data.tools,
            max_steps=data.max_steps,
            on_step=on_step,
            persona_prompt=data.system_prompt,
            mcp_clients=mcp_clients,
            sandbox=sandbox,
        )
        agent_run.status = "completed"
        agent_run.result = result.get("result")
        agent_run.steps = result.get("steps", [])
        agent_run.error = result.get("error")
    except Exception as e:
        agent_run.status = "failed"
        agent_run.error = str(e)
    finally:
        sandbox.cleanup()

    agent_run.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(agent_run)
    return agent_run


@router.post("/run/stream")
async def run_agent_stream(
    data: AgentTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream agent steps as SSE events."""
    # Capture primitives now, while the request-scoped session is alive. The
    # generator below runs AFTER this handler returns (during streaming), by
    # which point `db`/`current_user` are detached — so it must use its own
    # session and these captured ids, never the request objects.
    user_id = current_user.id
    agent_run = AgentRun(
        user_id=user_id,
        model_name=data.model,
        task=data.task,
        status="running",
        steps=[],
    )
    db.add(agent_run)
    db.commit()
    db.refresh(agent_run)
    run_id = agent_run.id

    async def event_stream():
        steps = []
        queue: asyncio.Queue = asyncio.Queue()
        gen_db = SessionLocal()  # fresh session owned by this generator

        async def on_step_q(step):
            steps.append(step)
            await queue.put(step)

        mcp_clients = _resolve_mcp_clients(gen_db, data.mcp_server_ids, user_id)
        sandbox = Sandbox()

        async def agent_task():
            try:
                result = await run_agent(
                    task=data.task,
                    model=data.model,
                    tools=data.tools,
                    max_steps=data.max_steps,
                    on_step=on_step_q,
                    persona_prompt=data.system_prompt,
                    mcp_clients=mcp_clients,
                    sandbox=sandbox,
                )
                await queue.put({"__done__": True, **result})
            except Exception as e:
                await queue.put({"__error__": str(e)})
            finally:
                sandbox.cleanup()

        task = asyncio.create_task(agent_task())

        final_status, final_result, final_error = "completed", None, None
        while True:
            item = await queue.get()
            if "__done__" in item:
                final_result = item.get("result")
                final_error = item.get("error")
                if final_error:
                    final_status = "failed"
                yield f"data: {json.dumps({'type': 'done', 'result': final_result, 'error': final_error})}\n\n"
                break
            elif "__error__" in item:
                final_status, final_error = "failed", item["__error__"]
                yield f"data: {json.dumps({'type': 'error', 'error': final_error})}\n\n"
                break
            else:
                yield f"data: {json.dumps({'type': 'step', 'step': item})}\n\n"

        await task

        # Persist the outcome (result + error + steps) so it shows in history.
        try:
            run = gen_db.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = final_status
                run.result = final_result
                run.error = final_error
                run.steps = steps
                run.completed_at = datetime.now(timezone.utc)
                gen_db.commit()
        finally:
            gen_db.close()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/runs", response_model=List[AgentRunOut])
def list_agent_runs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(AgentRun).filter(AgentRun.user_id == current_user.id).order_by(AgentRun.created_at.desc()).limit(50).all()


@router.get("/runs/{run_id}", response_model=AgentRunOut)
def get_agent_run(run_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    run = db.query(AgentRun).filter(AgentRun.id == run_id, AgentRun.user_id == current_user.id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
