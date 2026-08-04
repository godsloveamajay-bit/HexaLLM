import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
import json
from ..core.database import get_db, SessionLocal
from ..core.security import get_current_user
from ..models.user import User
from ..models.chat import AgentRun, RequestLog
from ..models.mcp_server import MCPServer
from ..models.tool import GeneratedTool
from ..schemas.chat import AgentTaskCreate, AgentRunOut
from ..services.agent_service import run_agent
from ..services.mcp_service import MCPClient
from ..services.tool_service import run_generated_tool
from ..services.sandbox_service import Sandbox, DOCKER_AVAILABLE, DOCKER_IMAGE
from ..services.ollama_service import ollama
from ..services import model_router


async def _resolve_agent_model(model: str, task: str) -> str:
    """Resolve a HexaLLM variant selection to a concrete Ollama model so the
    agent loop can run it. Non-variant ids pass through unchanged."""
    if not model_router.is_variant(model):
        return model
    try:
        available = [m["name"] for m in await ollama.list_models()]
    except Exception:
        available = []
    return model_router.concrete_for(model, task, available)


def _build_dynamic_tools(db: Session, user_id: int, tool_ids: List[int], sandbox):
    """Load the user's approved+enabled generated tools and wrap each as a
    sandboxed callable the agent loop can dispatch to."""
    if not tool_ids:
        return {}
    tools = db.query(GeneratedTool).filter(
        GeneratedTool.id.in_(tool_ids),
        GeneratedTool.user_id == user_id,
        GeneratedTool.status == "approved",
        GeneratedTool.enabled == True,  # noqa: E712
    ).all()
    out = {}
    for t in tools:
        async def _f(inp, _code=t.code):
            return await run_generated_tool(_code, inp, sandbox)
        desc = t.description
        if t.input_description:
            desc = f"{desc} Input: {t.input_description}"
        out[t.name] = {"description": desc, "func": _f}
    return out


def _resolve_mcp_clients(db: Session, server_ids: List[int], user_id: int):
    if not server_ids:
        return []
    servers = db.query(MCPServer).filter(
        MCPServer.id.in_(server_ids),
        MCPServer.user_id == user_id,
        MCPServer.is_active,
    ).all()
    clients = []
    for s in servers:
        client = MCPClient(s.url)
        client.tools_cache = s.tools_cache or []
        clients.append((s.name, client))
    return clients

def _log_agent_usage(db: Session, user_id: int, model: str, usage: dict,
                     latency_ms: int, status_code: int = 200):
    """Record an agent run in the platform usage ledger (RequestLog) so its
    token spend rolls up into Analytics alongside chat usage."""
    db.add(RequestLog(
        user_id=user_id,
        endpoint="/agents/run",
        method="POST",
        status_code=status_code,
        model_name=model,
        prompt_tokens=int((usage or {}).get("prompt_tokens", 0) or 0),
        completion_tokens=int((usage or {}).get("completion_tokens", 0) or 0),
        latency_ms=latency_ms,
    ))


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
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ..services.billing_enforcement import check_agent_limit
    check_agent_limit(db, current_user, client_ip=request.client.host if request.client else None)

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
    started = datetime.now(timezone.utc)
    usage = {}
    try:
        mcp_clients = _resolve_mcp_clients(db, data.mcp_server_ids, current_user.id)
        dynamic_tools = _build_dynamic_tools(db, current_user.id, data.generated_tool_ids, sandbox)
        eff_model = await _resolve_agent_model(data.model, data.task)
        result = await run_agent(
            task=data.task,
            model=eff_model,
            tools=data.tools,
            max_steps=data.max_steps,
            on_step=on_step,
            persona_prompt=data.system_prompt,
            mcp_clients=mcp_clients,
            sandbox=sandbox,
            dynamic_tools=dynamic_tools,
            subagent_model=data.subagent_model,
            subagent_max_depth=data.subagent_max_depth,
        )
        agent_run.status = "completed"
        agent_run.result = result.get("result")
        agent_run.steps = result.get("steps", [])
        agent_run.error = result.get("error")
        usage = result.get("usage") or {}
        agent_run.prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
        agent_run.completion_tokens = int(usage.get("completion_tokens", 0) or 0)
    except Exception as e:
        agent_run.status = "failed"
        agent_run.error = str(e)
    finally:
        sandbox.cleanup()

    agent_run.completed_at = datetime.now(timezone.utc)
    latency_ms = int((agent_run.completed_at - started).total_seconds() * 1000)
    _log_agent_usage(db, current_user.id, data.model, usage, latency_ms,
                     status_code=200 if agent_run.status == "completed" else 500)
    db.commit()
    db.refresh(agent_run)
    return agent_run


@router.post("/run/stream")
async def run_agent_stream(
    data: AgentTaskCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream agent steps as SSE events."""
    # Capture primitives now, while the request-scoped session is alive. The
    # generator below runs AFTER this handler returns (during streaming), by
    # which point `db`/`current_user` are detached — so it must use its own
    # session and these captured ids, never the request objects.
    user_id = current_user.id
    from ..services.billing_enforcement import check_agent_limit
    check_agent_limit(db, current_user, client_ip=request.client.host if request.client else None)
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
        dynamic_tools = _build_dynamic_tools(gen_db, user_id, data.generated_tool_ids, sandbox)

        async def agent_task():
            try:
                eff_model = await _resolve_agent_model(data.model, data.task)
                result = await run_agent(
                    task=data.task,
                    model=eff_model,
                    tools=data.tools,
                    max_steps=data.max_steps,
                    on_step=on_step_q,
                    persona_prompt=data.system_prompt,
                    mcp_clients=mcp_clients,
                    sandbox=sandbox,
                    dynamic_tools=dynamic_tools,
                    subagent_model=data.subagent_model,
                    subagent_max_depth=data.subagent_max_depth,
                )
                await queue.put({"__done__": True, **result})
            except Exception as e:
                await queue.put({"__error__": str(e)})
            finally:
                sandbox.cleanup()

        task = asyncio.create_task(agent_task())
        started = datetime.now(timezone.utc)

        final_status, final_result, final_error = "completed", None, None
        final_usage: dict = {}
        while True:
            item = await queue.get()
            if "__done__" in item:
                final_result = item.get("result")
                final_error = item.get("error")
                final_usage = item.get("usage") or {}
                # Only a hard failure when there's no usable answer at all — a
                # synthesized "step limit" answer still counts as completed.
                if final_error and not final_result:
                    final_status = "failed"
                total_tok = int(final_usage.get("prompt_tokens", 0) or 0) + int(final_usage.get("completion_tokens", 0) or 0)
                yield f"data: {json.dumps({'type': 'done', 'result': final_result, 'error': final_error, 'tokens': total_tok})}\n\n"
                break
            elif "__error__" in item:
                final_status, final_error = "failed", item["__error__"]
                yield f"data: {json.dumps({'type': 'error', 'error': final_error})}\n\n"
                break
            else:
                yield f"data: {json.dumps({'type': 'step', 'step': item})}\n\n"

        await task

        # Persist the outcome (result + error + steps + token usage) for history.
        try:
            run = gen_db.query(AgentRun).filter(AgentRun.id == run_id).first()
            if run:
                run.status = final_status
                run.result = final_result
                run.error = final_error
                run.steps = steps
                run.prompt_tokens = int(final_usage.get("prompt_tokens", 0) or 0)
                run.completion_tokens = int(final_usage.get("completion_tokens", 0) or 0)
                run.completed_at = datetime.now(timezone.utc)
                latency_ms = int((run.completed_at - started).total_seconds() * 1000)
                _log_agent_usage(gen_db, user_id, data.model, final_usage, latency_ms,
                                 status_code=200 if final_status != "failed" else 500)
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
