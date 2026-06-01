from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.memory import UserMemory
from ..services.ollama_service import ollama

router = APIRouter(prefix="/memory", tags=["memory"])


class MemoryCreate(BaseModel):
    content: str
    source: str = "manual"
    session_id: Optional[int] = None


class MemoryOut(BaseModel):
    id: int
    content: str
    source: str
    session_id: Optional[int]
    created_at: str

    class Config:
        from_attributes = True

    def model_post_init(self, __context):
        if hasattr(self, 'created_at') and not isinstance(self.created_at, str):
            object.__setattr__(self, 'created_at', self.created_at.isoformat())


class AutoExtractRequest(BaseModel):
    messages: List[dict]
    model: str = "llama3:8B"


@router.get("", response_model=List[MemoryOut])
def list_memories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(UserMemory).filter(
        UserMemory.user_id == current_user.id
    ).order_by(UserMemory.created_at.desc()).all()


@router.post("", response_model=MemoryOut, status_code=201)
def create_memory(
    data: MemoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mem = UserMemory(
        user_id=current_user.id,
        content=data.content,
        source=data.source,
        session_id=data.session_id,
    )
    db.add(mem)
    db.commit()
    db.refresh(mem)
    return mem


@router.delete("/{memory_id}", status_code=204)
def delete_memory(
    memory_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mem = db.query(UserMemory).filter(
        UserMemory.id == memory_id, UserMemory.user_id == current_user.id
    ).first()
    if not mem:
        raise HTTPException(status_code=404, detail="Memory not found")
    db.delete(mem)
    db.commit()


@router.delete("", status_code=204)
def clear_all_memories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(UserMemory).filter(UserMemory.user_id == current_user.id).delete()
    db.commit()


@router.post("/extract")
async def extract_memories(
    data: AutoExtractRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ask the LLM to extract memorable facts from a conversation."""
    conversation = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in data.messages[-20:]
    )
    system = (
        "Extract a short list of important, specific facts about the user from this conversation. "
        "Each fact should be one sentence. Only include facts worth remembering long-term "
        "(preferences, goals, context about who they are or what they're working on). "
        "Output ONLY a JSON array of strings, e.g. [\"User prefers Python.\", \"User is building a fintech app.\"] "
        "If there is nothing worth remembering, output []."
    )
    msgs = [{"role": "user", "content": f"Conversation:\n{conversation}"}]
    raw = ""
    async for chunk in ollama.chat_stream(data.model, msgs, system_prompt=system, temperature=0.1):
        raw += chunk

    import json, re
    try:
        facts = json.loads(raw.strip())
    except Exception:
        m = re.search(r'\[.*?\]', raw, re.DOTALL)
        if m:
            try:
                facts = json.loads(m.group())
            except Exception:
                facts = []
        else:
            facts = []

    saved = []
    for fact in facts[:10]:
        if isinstance(fact, str) and fact.strip():
            mem = UserMemory(user_id=current_user.id, content=fact.strip(), source="auto")
            db.add(mem)
            saved.append(fact.strip())
    db.commit()
    return {"extracted": saved}
