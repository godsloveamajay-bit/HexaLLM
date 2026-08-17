from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.security import get_current_user, generate_api_key
from ..models.user import User, APIKey
from ..models.workspace import Workspace, WorkspaceItem
from ..schemas.workspace import (
    WorkspaceCreate, WorkspaceUpdate, WorkspaceOut,
    WorkspaceItemCreate, WorkspaceItemUpdate, WorkspaceItemOut,
)
from ..schemas.auth import APIKeyCreate, APIKeyOut

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

MAX_ITEMS_PER_WORKSPACE = 100
MAX_KEYS_PER_WORKSPACE = 10


def _get_owned(db: Session, user: User, workspace_id: int) -> Workspace:
    ws = db.query(Workspace).filter(Workspace.id == workspace_id, Workspace.user_id == user.id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


def _ws_out(db: Session, ws: Workspace) -> WorkspaceOut:
    out = WorkspaceOut.model_validate(ws)
    out.item_count = db.query(WorkspaceItem).filter(WorkspaceItem.workspace_id == ws.id).count()
    out.key_count = db.query(APIKey).filter(APIKey.workspace_id == ws.id).count()
    return out


# ── Workspaces ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ws = db.query(Workspace).filter(Workspace.user_id == current_user.id).order_by(Workspace.created_at).all()
    return [_ws_out(db, w) for w in ws]


@router.post("", response_model=WorkspaceOut, status_code=201)
def create_workspace(data: WorkspaceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if db.query(Workspace).filter(Workspace.user_id == current_user.id).count() >= 20:
        raise HTTPException(status_code=400, detail="Workspace limit reached (20)")
    ws = Workspace(user_id=current_user.id, name=data.name, description=data.description)
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return _ws_out(db, ws)


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(workspace_id: int, data: WorkspaceUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ws = _get_owned(db, current_user, workspace_id)
    if data.name is not None:
        ws.name = data.name
    if data.description is not None:
        ws.description = data.description
    db.commit()
    db.refresh(ws)
    return _ws_out(db, ws)


@router.delete("/{workspace_id}", status_code=204)
def delete_workspace(workspace_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ws = _get_owned(db, current_user, workspace_id)
    keys = db.query(APIKey).filter(APIKey.workspace_id == ws.id).all()
    for k in keys:
        db.delete(k)
    db.delete(ws)
    db.commit()


# ── Items (presets / requests) ────────────────────────────────────────────────

@router.get("/{workspace_id}/items", response_model=list[WorkspaceItemOut])
def list_items(workspace_id: int, kind: str = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_owned(db, current_user, workspace_id)
    q = db.query(WorkspaceItem).filter(WorkspaceItem.workspace_id == workspace_id)
    if kind:
        q = q.filter(WorkspaceItem.kind == kind)
    return q.order_by(WorkspaceItem.created_at).all()


@router.post("/{workspace_id}/items", response_model=WorkspaceItemOut, status_code=201)
def create_item(workspace_id: int, data: WorkspaceItemCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_owned(db, current_user, workspace_id)
    count = db.query(WorkspaceItem).filter(WorkspaceItem.workspace_id == workspace_id).count()
    if count >= MAX_ITEMS_PER_WORKSPACE:
        raise HTTPException(status_code=400, detail=f"Item limit reached ({MAX_ITEMS_PER_WORKSPACE})")
    item = WorkspaceItem(workspace_id=workspace_id, kind=data.kind, name=data.name, payload=data.payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{workspace_id}/items/{item_id}", response_model=WorkspaceItemOut)
def update_item(workspace_id: int, item_id: int, data: WorkspaceItemUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_owned(db, current_user, workspace_id)
    item = db.query(WorkspaceItem).filter(WorkspaceItem.id == item_id, WorkspaceItem.workspace_id == workspace_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if data.name is not None:
        item.name = data.name
    if data.payload is not None:
        item.payload = data.payload
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{workspace_id}/items/{item_id}", status_code=204)
def delete_item(workspace_id: int, item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_owned(db, current_user, workspace_id)
    item = db.query(WorkspaceItem).filter(WorkspaceItem.id == item_id, WorkspaceItem.workspace_id == workspace_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()


# ── Workspace-scoped API keys ─────────────────────────────────────────────────

def _key_out(db: Session, key: APIKey) -> APIKeyOut:
    out = APIKeyOut.model_validate(key)
    from ..models.persona import SavedPersona
    if key.persona_id:
        persona = db.query(SavedPersona).filter(SavedPersona.id == key.persona_id).first()
        out.persona_name = persona.name if persona else None
    return out


@router.get("/{workspace_id}/keys", response_model=list[APIKeyOut])
def list_keys(workspace_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_owned(db, current_user, workspace_id)
    keys = db.query(APIKey).filter(APIKey.workspace_id == workspace_id).order_by(APIKey.created_at.desc()).all()
    return [_key_out(db, k) for k in keys]


@router.post("/{workspace_id}/keys", response_model=APIKeyOut, status_code=201)
def create_key(workspace_id: int, data: APIKeyCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _get_owned(db, current_user, workspace_id)
    count = db.query(APIKey).filter(APIKey.workspace_id == workspace_id).count()
    if count >= MAX_KEYS_PER_WORKSPACE:
        raise HTTPException(status_code=400, detail=f"Key limit reached ({MAX_KEYS_PER_WORKSPACE})")

    from ..models.persona import SavedPersona
    from ..services import model_router

    persona_id = None
    model_name = data.model
    if model_name and not current_user.is_admin and not model_router.is_variant(model_name):
        raise HTTPException(status_code=400, detail="Choose a HexaLLM model to bind this key to.")
    if data.persona_id is not None:
        persona = db.query(SavedPersona).filter(
            SavedPersona.id == data.persona_id, SavedPersona.user_id == current_user.id
        ).first()
        if not persona:
            raise HTTPException(status_code=404, detail="Persona not found")
        persona_id = persona.id
        model_name = persona.base_model

    key = APIKey(
        user_id=current_user.id,
        workspace_id=workspace_id,
        name=data.name,
        key=generate_api_key(),
        persona_id=persona_id,
        model_name=model_name,
        temperature=data.temperature,
        top_p=data.top_p,
        max_tokens=data.max_tokens,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return _key_out(db, key)
