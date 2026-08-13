from datetime import datetime
from typing import Dict, Optional
from pydantic import BaseModel, Field


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)


class WorkspaceOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    item_count: int = 0
    key_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceItemCreate(BaseModel):
    kind: str = Field(pattern="^(playground|request)$")
    name: str = Field(min_length=1, max_length=120)
    payload: Dict = Field(default_factory=dict)


class WorkspaceItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    payload: Optional[Dict] = None


class WorkspaceItemOut(BaseModel):
    id: int
    workspace_id: int
    kind: str
    name: str
    payload: Dict
    created_at: datetime

    model_config = {"from_attributes": True}
