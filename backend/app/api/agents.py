import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
import json
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.chat import AgentRun
from ..schemas.chat import AgentTaskCreate, AgentRunOut
from ..services.agent_service import run_agent

router = APIRouter(prefix="/agents", tags=["agents"])


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

    try:
        result = await run_agent(
            task=data.task,
            model=data.model,
            tools=data.tools,
            max_steps=data.max_steps,
            on_step=on_step,
            persona_prompt=data.system_prompt,
        )
        agent_run.status = "completed"
        agent_run.result = result.get("result")
        agent_run.steps = result.get("steps", [])
        agent_run.error = result.get("error")
    except Exception as e:
        agent_run.status = "failed"
        agent_run.error = str(e)

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
    run_id = agent_run.id

    async def event_stream():
        steps = []

        async def on_step(step):
            steps.append(step)
            yield f"data: {json.dumps({'type': 'step', 'step': step})}\n\n"

        # Need a queue-based approach for proper SSE streaming
        queue = asyncio.Queue()

        async def on_step_q(step):
            steps.append(step)
            await queue.put(step)

        async def agent_task():
            try:
                result = await run_agent(
                    task=data.task,
                    model=data.model,
                    tools=data.tools,
                    max_steps=data.max_steps,
                    on_step=on_step_q,
                    persona_prompt=data.system_prompt,
                )
                await queue.put({"__done__": True, **result})
            except Exception as e:
                await queue.put({"__error__": str(e)})

        task = asyncio.create_task(agent_task())

        while True:
            item = await queue.get()
            if "__done__" in item:
                yield f"data: {json.dumps({'type': 'done', 'result': item.get('result'), 'error': item.get('error')})}\n\n"
                break
            elif "__error__" in item:
                yield f"data: {json.dumps({'type': 'error', 'error': item['__error__']})}\n\n"
                break
            else:
                yield f"data: {json.dumps({'type': 'step', 'step': item})}\n\n"

        await task

        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if run:
            run.status = "completed"
            run.steps = steps
            run.completed_at = datetime.now(timezone.utc)
            db.commit()

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
