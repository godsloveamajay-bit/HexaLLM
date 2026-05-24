from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from ..core.database import Base


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    embedding_model = Column(String, nullable=False, default="nomic-embed-text")
    chunk_size = Column(Integer, default=500)
    chunk_overlap = Column(Integer, default=50)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="knowledge_bases")
    documents = relationship("KBDocument", back_populates="knowledge_base", cascade="all, delete-orphan")
    chunks = relationship("KBChunk", back_populates="knowledge_base", cascade="all, delete-orphan")


class KBDocument(Base):
    __tablename__ = "kb_documents"

    id = Column(Integer, primary_key=True, index=True)
    kb_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=False)
    filename = Column(String, nullable=False)
    source_path = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    size_bytes = Column(Integer, default=0)
    status = Column(String, default="pending")  # pending, processing, ready, failed
    error = Column(Text, nullable=True)
    chunks_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    knowledge_base = relationship("KnowledgeBase", back_populates="documents")
    chunks = relationship("KBChunk", back_populates="document", cascade="all, delete-orphan")


class KBChunk(Base):
    __tablename__ = "kb_chunks"

    id = Column(Integer, primary_key=True, index=True)
    kb_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("kb_documents.id"), nullable=False)
    order_idx = Column(Integer, default=0)
    content = Column(Text, nullable=False)
    embedding = Column(JSON, nullable=False)  # list[float]
    meta = Column(JSON, default=dict)  # {page, section, ...}
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    knowledge_base = relationship("KnowledgeBase", back_populates="chunks")
    document = relationship("KBDocument", back_populates="chunks")


Index("ix_kb_chunks_kb_doc", KBChunk.kb_id, KBChunk.document_id)
