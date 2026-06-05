from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.persona import SavedPersona

router = APIRouter(prefix="/personas", tags=["personas"])


class PersonaCreate(BaseModel):
    name: str
    description: Optional[str] = None
    emoji: str = "🤖"
    base_model: str
    system_prompt: Optional[str] = None
    tools: List[str] = []
    knowledge_base_id: Optional[int] = None
    use_memory: bool = False
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    personality: Optional[Dict[str, int]] = None
    is_public: bool = False


class PersonaUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    emoji: Optional[str] = None
    base_model: Optional[str] = None
    system_prompt: Optional[str] = None
    tools: Optional[List[str]] = None
    knowledge_base_id: Optional[int] = None
    use_memory: Optional[bool] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    personality: Optional[Dict[str, int]] = None
    is_public: Optional[bool] = None


class PersonaOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    emoji: str
    base_model: str
    system_prompt: Optional[str]
    tools: List[str]
    knowledge_base_id: Optional[int]
    use_memory: bool
    temperature: float
    max_tokens: Optional[int]
    personality: Optional[Dict[str, int]] = None
    is_public: bool
    is_favorite: bool = False
    uses: int
    last_used_at: Optional[str] = None
    owner_username: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True


def _serialize(persona: SavedPersona, include_owner: bool = False) -> PersonaOut:
    return PersonaOut(
        id=persona.id,
        name=persona.name,
        description=persona.description,
        emoji=persona.emoji or "🤖",
        base_model=persona.base_model,
        system_prompt=persona.system_prompt,
        tools=persona.tools or [],
        knowledge_base_id=persona.knowledge_base_id,
        use_memory=persona.use_memory,
        temperature=persona.temperature,
        max_tokens=persona.max_tokens,
        personality=persona.personality,
        is_public=persona.is_public,
        is_favorite=bool(persona.is_favorite),
        uses=persona.uses,
        last_used_at=persona.last_used_at.isoformat() if persona.last_used_at else None,
        owner_username=persona.user.username if include_owner and persona.user else None,
        created_at=persona.created_at.isoformat(),
    )


@router.get("", response_model=List[PersonaOut])
def list_personas(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return [_serialize(p) for p in db.query(SavedPersona).filter(
        SavedPersona.user_id == current_user.id
    ).order_by(SavedPersona.is_favorite.desc(), SavedPersona.updated_at.desc()).all()]


@router.get("/community", response_model=List[PersonaOut])
def list_community_personas(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return [_serialize(p, include_owner=True) for p in db.query(SavedPersona).filter(
        SavedPersona.is_public == True
    ).order_by(SavedPersona.uses.desc()).limit(50).all()]


@router.post("", response_model=PersonaOut, status_code=201)
def create_persona(
    data: PersonaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    persona = SavedPersona(user_id=current_user.id, **data.model_dump())
    db.add(persona)
    db.commit()
    db.refresh(persona)
    return _serialize(persona)


@router.patch("/{persona_id}", response_model=PersonaOut)
def update_persona(
    persona_id: int,
    data: PersonaUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    persona = db.query(SavedPersona).filter(
        SavedPersona.id == persona_id, SavedPersona.user_id == current_user.id
    ).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(persona, k, v)
    persona.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(persona)
    return _serialize(persona)


@router.post("/{persona_id}/use", status_code=204)
def record_use(
    persona_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bump usage stats when a persona is applied in chat."""
    persona = db.query(SavedPersona).filter(
        SavedPersona.id == persona_id, SavedPersona.user_id == current_user.id
    ).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    persona.uses = (persona.uses or 0) + 1
    persona.last_used_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/{persona_id}/favorite", response_model=PersonaOut)
def toggle_favorite(
    persona_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    persona = db.query(SavedPersona).filter(
        SavedPersona.id == persona_id, SavedPersona.user_id == current_user.id
    ).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    persona.is_favorite = not bool(persona.is_favorite)
    db.commit()
    db.refresh(persona)
    return _serialize(persona)


@router.delete("/{persona_id}", status_code=204)
def delete_persona(
    persona_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    persona = db.query(SavedPersona).filter(
        SavedPersona.id == persona_id, SavedPersona.user_id == current_user.id
    ).first()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    db.delete(persona)
    db.commit()


@router.post("/{persona_id}/fork", response_model=PersonaOut, status_code=201)
def fork_persona(
    persona_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    original = db.query(SavedPersona).filter(
        SavedPersona.id == persona_id, SavedPersona.is_public == True
    ).first()
    if not original:
        raise HTTPException(status_code=404, detail="Persona not found or not public")
    original.uses += 1
    forked = SavedPersona(
        user_id=current_user.id,
        name=f"{original.name} (fork)",
        description=original.description,
        emoji=original.emoji,
        base_model=original.base_model,
        system_prompt=original.system_prompt,
        tools=list(original.tools or []),
        use_memory=original.use_memory,
        temperature=original.temperature,
        max_tokens=original.max_tokens,
        personality=original.personality,
        is_public=False,
    )
    db.add(forked)
    db.commit()
    db.refresh(forked)
    return _serialize(forked)
