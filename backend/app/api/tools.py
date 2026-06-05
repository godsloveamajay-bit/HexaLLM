from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.tool import GeneratedTool
from ..services.tool_service import generate_tool, run_generated_tool, validate_code
from ..services.sandbox_service import Sandbox, DOCKER_AVAILABLE

router = APIRouter(prefix="/tools", tags=["tools"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class ToolOut(BaseModel):
    id: int
    name: str
    description: str
    input_description: str = ""
    code: str
    prompt: str = ""
    status: str
    enabled: bool
    run_count: int
    last_error: Optional[str] = None
    created_at: datetime
    approved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GenerateRequest(BaseModel):
    prompt: str
    model: str = "llama3:8B"


class ToolUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    input_description: Optional[str] = None
    code: Optional[str] = None
    enabled: Optional[bool] = None


class TestRequest(BaseModel):
    input: str = ""


# ── Helpers ─────────────────────────────────────────────────────────────────

def _get_owned(db: Session, tool_id: int, user_id: int) -> GeneratedTool:
    tool = db.query(GeneratedTool).filter(
        GeneratedTool.id == tool_id, GeneratedTool.user_id == user_id
    ).first()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return tool


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("", response_model=List[ToolOut])
def list_tools(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(GeneratedTool).filter(
        GeneratedTool.user_id == current_user.id
    ).order_by(GeneratedTool.created_at.desc()).all()


@router.post("/generate", response_model=ToolOut, status_code=201)
async def generate(
    data: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ask the LLM to write a tool. Saved as `pending` for human review —
    nothing runs until you approve it."""
    if not data.prompt.strip():
        raise HTTPException(status_code=400, detail="Describe what the tool should do.")

    existing = [
        t.name for t in db.query(GeneratedTool.name).filter(
            GeneratedTool.user_id == current_user.id
        ).all()
    ]
    gen = await generate_tool(data.model, data.prompt, existing)
    if gen.get("error"):
        raise HTTPException(status_code=422, detail=f"Could not generate a valid tool: {gen['error']}")

    # Ensure name uniqueness for this user.
    name = gen["name"]
    taken = set(existing)
    if name in taken:
        i = 2
        while f"{name}_{i}" in taken:
            i += 1
        name = f"{name}_{i}"

    tool = GeneratedTool(
        user_id=current_user.id,
        name=name,
        description=gen["description"],
        input_description=gen["input_description"],
        code=gen["code"],
        prompt=data.prompt.strip(),
        status="pending",
        enabled=True,
    )
    db.add(tool)
    db.commit()
    db.refresh(tool)
    return tool


@router.patch("/{tool_id}", response_model=ToolOut)
def update_tool(
    tool_id: int,
    data: ToolUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tool = _get_owned(db, tool_id, current_user.id)
    if data.code is not None:
        err = validate_code(data.code)
        if err:
            raise HTTPException(status_code=422, detail=err)
        tool.code = data.code
    if data.name is not None:
        tool.name = data.name
    if data.description is not None:
        tool.description = data.description
    if data.input_description is not None:
        tool.input_description = data.input_description
    if data.enabled is not None:
        tool.enabled = data.enabled
    db.commit()
    db.refresh(tool)
    return tool


@router.post("/{tool_id}/approve", response_model=ToolOut)
def approve_tool(
    tool_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tool = _get_owned(db, tool_id, current_user.id)
    err = validate_code(tool.code)
    if err:
        raise HTTPException(status_code=422, detail=f"Cannot approve — {err}")
    tool.status = "approved"
    tool.enabled = True
    tool.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(tool)
    return tool


@router.post("/{tool_id}/reject", response_model=ToolOut)
def reject_tool(
    tool_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tool = _get_owned(db, tool_id, current_user.id)
    tool.status = "rejected"
    tool.enabled = False
    db.commit()
    db.refresh(tool)
    return tool


@router.post("/{tool_id}/test")
async def test_tool(
    tool_id: int,
    data: TestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run the tool once in a fresh sandbox so a human can verify it before
    (or after) approving. Allowed at any status — this is the review step."""
    tool = _get_owned(db, tool_id, current_user.id)
    sandbox = Sandbox()
    try:
        output = await run_generated_tool(tool.code, data.input, sandbox)
    finally:
        sandbox.cleanup()
    tool.run_count = (tool.run_count or 0) + 1
    failed = output.lower().startswith("tool error") or "traceback" in output.lower()
    tool.last_error = output if failed else None
    db.commit()
    return {"output": output, "sandbox": "docker" if DOCKER_AVAILABLE else "subprocess"}


@router.delete("/{tool_id}", status_code=204)
def delete_tool(
    tool_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tool = _get_owned(db, tool_id, current_user.id)
    db.delete(tool)
    db.commit()
