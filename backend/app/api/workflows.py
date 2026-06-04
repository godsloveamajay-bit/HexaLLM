from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.workflow import Workflow
from ..models.chat import AgentRun, RequestLog
from ..services.agent_service import run_agent

router = APIRouter(prefix="/workflows", tags=["workflows"])


class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    task: str
    model: str
    tools: List[str] = []
    system_prompt: Optional[str] = None
    max_steps: int = 10
    schedule: Optional[str] = None  # "manual" | cron string
    is_active: bool = True


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    task: Optional[str] = None
    model: Optional[str] = None
    tools: Optional[List[str]] = None
    system_prompt: Optional[str] = None
    max_steps: Optional[int] = None
    schedule: Optional[str] = None
    is_active: Optional[bool] = None


class WorkflowOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    task: str
    model: str
    tools: List[str]
    system_prompt: Optional[str]
    max_steps: int
    schedule: Optional[str]
    is_active: bool
    run_count: int
    last_run_at: Optional[str]
    last_result: Optional[str]
    last_error: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


def _serialize(wf: Workflow) -> WorkflowOut:
    return WorkflowOut(
        id=wf.id,
        name=wf.name,
        description=wf.description,
        task=wf.task,
        model=wf.model,
        tools=wf.tools or [],
        system_prompt=wf.system_prompt,
        max_steps=wf.max_steps,
        schedule=wf.schedule,
        is_active=wf.is_active,
        run_count=wf.run_count,
        last_run_at=wf.last_run_at.isoformat() if wf.last_run_at else None,
        last_result=wf.last_result,
        last_error=wf.last_error,
        created_at=wf.created_at.isoformat(),
    )


@router.get("", response_model=List[WorkflowOut])
def list_workflows(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return [_serialize(w) for w in db.query(Workflow).filter(
        Workflow.user_id == current_user.id
    ).order_by(Workflow.updated_at.desc()).all()]


@router.post("", response_model=WorkflowOut, status_code=201)
def create_workflow(
    data: WorkflowCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = Workflow(user_id=current_user.id, **data.model_dump())
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return _serialize(wf)


@router.patch("/{wf_id}", response_model=WorkflowOut)
def update_workflow(
    wf_id: int,
    data: WorkflowUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == wf_id, Workflow.user_id == current_user.id).first()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(wf, k, v)
    wf.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(wf)
    return _serialize(wf)


@router.delete("/{wf_id}", status_code=204)
def delete_workflow(
    wf_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == wf_id, Workflow.user_id == current_user.id).first()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    db.delete(wf)
    db.commit()


async def _run_workflow_bg(workflow_id: int, user_id: int):
    from ..core.database import SessionLocal
    db = SessionLocal()
    try:
        wf = db.query(Workflow).filter(Workflow.id == workflow_id, Workflow.user_id == user_id).first()
        if not wf:
            return
        result = await run_agent(
            task=wf.task,
            model=wf.model,
            tools=wf.tools or [],
            max_steps=wf.max_steps,
            persona_prompt=wf.system_prompt,
        )
        wf.last_result = result.get("result")
        wf.last_error = result.get("error")
        wf.run_count = (wf.run_count or 0) + 1
        wf.last_run_at = datetime.now(timezone.utc)
        usage = result.get("usage") or {}
        db.add(RequestLog(
            user_id=user_id,
            endpoint="/workflows/run",
            method="POST",
            status_code=200 if result.get("result") else 500,
            model_name=wf.model,
            prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
            completion_tokens=int(usage.get("completion_tokens", 0) or 0),
        ))
        db.commit()
    except Exception as e:
        wf = db.query(Workflow).filter(Workflow.id == workflow_id).first()
        if wf:
            wf.last_error = str(e)
            wf.last_run_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


@router.post("/{wf_id}/run", response_model=WorkflowOut)
async def trigger_workflow(
    wf_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wf = db.query(Workflow).filter(Workflow.id == wf_id, Workflow.user_id == current_user.id).first()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    background_tasks.add_task(_run_workflow_bg, wf.id, current_user.id)
    return _serialize(wf)
