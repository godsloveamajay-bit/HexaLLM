from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import List
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.template import PromptTemplate

router = APIRouter(prefix="/templates", tags=["templates"])


class TemplateCreate(BaseModel):
    name: str
    content: str


class TemplateOut(BaseModel):
    id: int
    name: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=List[TemplateOut])
def list_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(PromptTemplate)
        .filter(PromptTemplate.user_id == current_user.id)
        .order_by(PromptTemplate.created_at.desc())
        .all()
    )


@router.post("", response_model=TemplateOut, status_code=201)
def create_template(
    data: TemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = PromptTemplate(user_id=current_user.id, name=data.name[:100], content=data.content)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t = (
        db.query(PromptTemplate)
        .filter(PromptTemplate.id == template_id, PromptTemplate.user_id == current_user.id)
        .first()
    )
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(t)
    db.commit()
