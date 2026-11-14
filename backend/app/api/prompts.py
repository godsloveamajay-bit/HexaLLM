"""Prompt Library API - Save, share, and reuse prompts."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, JSON
from sqlalchemy.orm import Session, relationship

from ..core.database import Base, get_db
from ..core.security import get_current_user
from ..models.user import User

router = APIRouter(prefix="/prompts", tags=["prompts"])


class Prompt(Base):
    __tablename__ = "prompts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    variables = Column(JSON, nullable=True)  # Template variables
    tags = Column(JSON, nullable=True)  # List of tags
    is_public = Column(Boolean, default=False)
    is_system = Column(Boolean, default=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    use_count = Column(Integer, default=0)

    owner = relationship("User", back_populates="prompts")



class PromptVersion(Base):
    __tablename__ = "prompt_versions"

    id = Column(Integer, primary_key=True, index=True)
    prompt_id = Column(Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    variables = Column(JSON, nullable=True)
    tags = Column(JSON, nullable=True)
    is_public = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    prompt = relationship("Prompt", back_populates="versions")


Prompt.versions = relationship("PromptVersion", back_populates="prompt", cascade="all, delete-orphan", order_by="PromptVersion.version_number")

# Add to User model
User.prompts = relationship("Prompt", back_populates="owner", cascade="all, delete-orphan")


class PromptCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    content: str = Field(..., min_length=1)
    variables: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None
    is_public: bool = False


class PromptUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    content: Optional[str] = None
    variables: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None
    is_public: Optional[bool] = None


class PromptResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    content: str
    variables: Optional[Dict[str, Any]]
    tags: List[str]
    is_public: bool
    is_system: bool
    owner_id: int
    owner_name: str
    created_at: datetime
    updated_at: datetime
    use_count: int

    class Config:
        from_attributes = True



class PromptVersionResponse(BaseModel):
    id: int
    prompt_id: int
    version_number: int
    title: str
    description: Optional[str]
    content: str
    variables: Optional[Dict[str, Any]]
    tags: List[str]
    is_public: bool
    created_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


class PromptVersionListResponse(BaseModel):
    versions: List[PromptVersionResponse]
    total: int


class PromptListResponse(BaseModel):
    prompts: List[PromptResponse]
    total: int
    page: int
    page_size: int


class PromptUseRequest(BaseModel):
    variables: Optional[Dict[str, str]] = None



def _snapshot_prompt(prompt: Prompt, db: Session, user_id: int) -> PromptVersion:
    last = db.query(PromptVersion).filter(PromptVersion.prompt_id == prompt.id).order_by(PromptVersion.version_number.desc()).first()
    number = (last.version_number if last else 0) + 1
    version = PromptVersion(
        prompt_id=prompt.id,
        version_number=number,
        title=prompt.title,
        description=prompt.description,
        content=prompt.content,
        variables=prompt.variables or {},
        tags=prompt.tags or [],
        is_public=prompt.is_public,
        created_by=user_id,
    )
    db.add(version)
    return version


@router.post("", response_model=PromptResponse)
async def create_prompt(
    prompt: PromptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new prompt."""
    db_prompt = Prompt(
        title=prompt.title,
        description=prompt.description,
        content=prompt.content,
        variables=prompt.variables or {},
        tags=prompt.tags or [],
        is_public=prompt.is_public,
        owner_id=current_user.id,
    )
    db.add(db_prompt)
    db.flush()
    _snapshot_prompt(db_prompt, db, current_user.id)
    db.commit()
    db.refresh(db_prompt)
    return _to_response(db_prompt, current_user.username)


@router.get("", response_model=PromptListResponse)
async def list_prompts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    tags: Optional[List[str]] = Query(None),
    is_public: Optional[bool] = None,
    mine_only: bool = False,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """List prompts with filtering."""
    query = db.query(Prompt)

    if mine_only and current_user:
        query = query.filter(Prompt.owner_id == current_user.id)
    elif current_user:
        # Show own + public
        query = query.filter((Prompt.owner_id == current_user.id) | (Prompt.is_public == True))
    else:
        query = query.filter(Prompt.is_public == True)

    if search:
        query = query.filter(
            Prompt.title.ilike(f"%{search}%") | Prompt.content.ilike(f"%{search}%")
        )

    if tags:
        for tag in tags:
            query = query.filter(Prompt.tags.contains([tag]))

    if is_public is not None:
        query = query.filter(Prompt.is_public == is_public)

    total = query.count()
    prompts = query.order_by(Prompt.updated_at.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    return PromptListResponse(
        prompts=[_to_response(p, p.owner.username) for p in prompts],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{prompt_id}", response_model=PromptResponse)
async def get_prompt(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Get a prompt by ID."""
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(404, "Prompt not found")

    # Check access
    if not prompt.is_public and (not current_user or prompt.owner_id != current_user.id):
        raise HTTPException(403, "Not authorized to view this prompt")

    return _to_response(prompt, prompt.owner.username)


@router.patch("/{prompt_id}", response_model=PromptResponse)
async def update_prompt(
    prompt_id: int,
    update: PromptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a prompt."""
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(404, "Prompt not found")

    if prompt.owner_id != current_user.id:
        raise HTTPException(403, "Not authorized to update this prompt")

    update_data = update.model_dump(exclude_unset=True)
    changed = any(update_data.get(f) is not None for f in ("title", "description", "content", "variables", "tags", "is_public"))
    if changed:
        _snapshot_prompt(prompt, db, current_user.id)
    for field, value in update_data.items():
        setattr(prompt, field, value)

    prompt.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(prompt)
    return _to_response(prompt, current_user.username)


@router.delete("/{prompt_id}")
async def delete_prompt(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a prompt."""
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(404, "Prompt not found")

    if prompt.owner_id != current_user.id:
        raise HTTPException(403, "Not authorized to delete this prompt")

    db.delete(prompt)
    db.commit()
    return {"message": "Prompt deleted"}


@router.post("/{prompt_id}/use", response_model=Dict[str, str])
async def use_prompt(
    prompt_id: int,
    use_request: PromptUseRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Use a prompt - substitute variables and return rendered content."""
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(404, "Prompt not found")

    if not prompt.is_public and (not current_user or prompt.owner_id != current_user.id):
        raise HTTPException(403, "Not authorized to use this prompt")

    # Render template with variables
    content = prompt.content
    variables = use_request.variables or {}

    # Simple template substitution
    for key, value in variables.items():
        content = content.replace(f"{{{{{key}}}}}", value)

    # Check for unused variables
    import re
    unused = re.findall(r'\{\{(\w+)\}\}', content)
    if unused:
        return {
            "content": content,
            "warning": f"Unresolved variables: {', '.join(unused)}"
        }

    # Increment use count
    prompt.use_count += 1
    db.commit()

    return {"content": content}



@router.get("/{prompt_id}/versions", response_model=PromptVersionListResponse)
async def list_prompt_versions(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(404, "Prompt not found")
    if not prompt.is_public and (not current_user or prompt.owner_id != current_user.id):
        raise HTTPException(403, "Not authorized to view this prompt")
    versions = db.query(PromptVersion).filter(PromptVersion.prompt_id == prompt_id).order_by(PromptVersion.version_number.desc()).all()
    return PromptVersionListResponse(versions=versions, total=len(versions))


@router.post("/{prompt_id}/versions", response_model=PromptVersionResponse, status_code=201)
async def create_prompt_version(
    prompt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(404, "Prompt not found")
    if prompt.owner_id != current_user.id:
        raise HTTPException(403, "Not authorized")
    version = _snapshot_prompt(prompt, db, current_user.id)
    db.commit()
    db.refresh(version)
    return version


@router.post("/{prompt_id}/versions/{version_id}/restore", response_model=PromptResponse)
async def restore_prompt_version(
    prompt_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id).first()
    if not prompt:
        raise HTTPException(404, "Prompt not found")
    if prompt.owner_id != current_user.id:
        raise HTTPException(403, "Not authorized")
    version = db.query(PromptVersion).filter(
        PromptVersion.id == version_id, PromptVersion.prompt_id == prompt_id
    ).first()
    if not version:
        raise HTTPException(404, "Version not found")
    _snapshot_prompt(prompt, db, current_user.id)
    prompt.title = version.title
    prompt.description = version.description
    prompt.content = version.content
    prompt.variables = version.variables or {}
    prompt.tags = version.tags or []
    prompt.is_public = version.is_public
    prompt.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(prompt)
    return _to_response(prompt, current_user.username)


def _to_response(prompt: Prompt, owner_name: str) -> PromptResponse:
    return PromptResponse(
        id=prompt.id,
        title=prompt.title,
        description=prompt.description,
        content=prompt.content,
        variables=prompt.variables or {},
        tags=prompt.tags or [],
        is_public=prompt.is_public,
        is_system=prompt.is_system,
        owner_id=prompt.owner_id,
        owner_name=owner_name,
        created_at=prompt.created_at,
        updated_at=prompt.updated_at,
        use_count=prompt.use_count,
    )
