from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class KnowledgeBaseCreate(BaseModel):
    name: str
    description: Optional[str] = None
    embedding_model: str = "nomic-embed-text"
    chunk_size: int = Field(default=500, ge=50, le=4000)
    chunk_overlap: int = Field(default=50, ge=0, le=500)


class KnowledgeBaseUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    chunk_size: Optional[int] = Field(default=None, ge=50, le=4000)
    chunk_overlap: Optional[int] = Field(default=None, ge=0, le=500)


class KBDocumentOut(BaseModel):
    id: int
    kb_id: int
    filename: str
    mime_type: Optional[str]
    size_bytes: int
    status: str
    error: Optional[str]
    chunks_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class KnowledgeBaseOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    embedding_model: str
    chunk_size: int
    chunk_overlap: int
    created_at: datetime
    updated_at: datetime
    document_count: int = 0
    chunk_count: int = 0

    class Config:
        from_attributes = True


class KnowledgeBaseDetail(KnowledgeBaseOut):
    documents: List[KBDocumentOut] = []


class KBQueryRequest(BaseModel):
    query: str
    top_k: int = Field(default=4, ge=1, le=20)


class KBQueryHit(BaseModel):
    chunk_id: int
    document_id: int
    document_filename: str
    score: float
    content: str
    order_idx: int


class KBQueryResponse(BaseModel):
    query: str
    hits: List[KBQueryHit]
