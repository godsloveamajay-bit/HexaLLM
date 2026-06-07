import os
import shutil
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import SessionLocal, get_db
from ..core.security import get_current_user
from ..models.knowledge import KBChunk, KBDocument, KnowledgeBase
from ..models.user import User
from ..schemas.knowledge import (
    KBDocumentOut,
    KBQueryHit,
    KBQueryRequest,
    KBQueryResponse,
    KnowledgeBaseCreate,
    KnowledgeBaseDetail,
    KnowledgeBaseOut,
    KnowledgeBaseUpdate,
)
from ..services.document_loader import SUPPORTED_EXTS, load_document
from ..services.retrieval_service import ingest_document, search

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _kb_or_404(db: Session, kb_id: int, user: User) -> KnowledgeBase:
    kb = db.query(KnowledgeBase).filter(
        KnowledgeBase.id == kb_id, KnowledgeBase.user_id == user.id
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return kb


def _serialize_kb(db: Session, kb: KnowledgeBase) -> KnowledgeBaseOut:
    doc_count = db.query(func.count(KBDocument.id)).filter(KBDocument.kb_id == kb.id).scalar() or 0
    chunk_count = db.query(func.count(KBChunk.id)).filter(KBChunk.kb_id == kb.id).scalar() or 0
    out = KnowledgeBaseOut.model_validate(kb)
    out.document_count = doc_count
    out.chunk_count = chunk_count
    return out


@router.get("", response_model=List[KnowledgeBaseOut])
def list_knowledge_bases(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kbs = (
        db.query(KnowledgeBase)
        .filter(KnowledgeBase.user_id == current_user.id)
        .order_by(KnowledgeBase.updated_at.desc())
        .all()
    )
    return [_serialize_kb(db, kb) for kb in kbs]


@router.post("", response_model=KnowledgeBaseOut, status_code=201)
def create_knowledge_base(
    data: KnowledgeBaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # The embedding model is back-end plumbing; non-admins always use the
    # platform default rather than choosing a raw model.
    embedding_model = data.embedding_model if current_user.is_admin else "nomic-embed-text"
    kb = KnowledgeBase(
        user_id=current_user.id,
        name=data.name,
        description=data.description,
        embedding_model=embedding_model,
        chunk_size=data.chunk_size,
        chunk_overlap=data.chunk_overlap,
    )
    db.add(kb)
    db.commit()
    db.refresh(kb)
    return _serialize_kb(db, kb)


@router.get("/{kb_id}", response_model=KnowledgeBaseDetail)
def get_knowledge_base(
    kb_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kb = _kb_or_404(db, kb_id, current_user)
    base = _serialize_kb(db, kb)
    detail = KnowledgeBaseDetail(**base.model_dump(), documents=[])
    detail.documents = [KBDocumentOut.model_validate(d) for d in kb.documents]
    return detail


@router.patch("/{kb_id}", response_model=KnowledgeBaseOut)
def update_knowledge_base(
    kb_id: int,
    data: KnowledgeBaseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kb = _kb_or_404(db, kb_id, current_user)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(kb, field, value)
    db.commit()
    db.refresh(kb)
    return _serialize_kb(db, kb)


@router.delete("/{kb_id}", status_code=204)
def delete_knowledge_base(
    kb_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kb = _kb_or_404(db, kb_id, current_user)
    db.delete(kb)
    db.commit()


# ── Documents ────────────────────────────────────────────────────────────────


async def _process_upload(document_id: int, kb_id: int) -> None:
    """Background ingest: load file → chunk → embed → store. Owns its own DB session."""
    db = SessionLocal()
    try:
        document = db.query(KBDocument).filter(KBDocument.id == document_id).first()
        if not document:
            return
        kb = db.query(KnowledgeBase).filter(KnowledgeBase.id == kb_id).first()
        if not kb:
            document.status = "failed"
            document.error = "Knowledge base was deleted before ingest completed"
            db.commit()
            return
        try:
            raw = load_document(document.source_path)
        except Exception as e:
            document.status = "failed"
            document.error = f"Loader error: {e}"
            db.commit()
            return
        try:
            await ingest_document(db, kb, document, raw)
        except Exception:
            # ingest_document already records the error on the document
            return
    finally:
        db.close()


@router.post("/{kb_id}/documents", response_model=KBDocumentOut, status_code=201)
async def upload_document(
    kb_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kb = _kb_or_404(db, kb_id, current_user)

    ext = Path(file.filename or "").suffix.lower()
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(SUPPORTED_EXTS)}",
        )

    kb_dir = Path(settings.UPLOADS_DIR) / f"kb_{kb.id}"
    kb_dir.mkdir(parents=True, exist_ok=True)

    document = KBDocument(
        kb_id=kb.id,
        filename=file.filename,
        mime_type=file.content_type,
        status="pending",
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    dest = kb_dir / f"{document.id}_{file.filename}"
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)
    document.source_path = str(dest)
    document.size_bytes = os.path.getsize(dest)
    db.commit()
    db.refresh(document)

    background_tasks.add_task(_process_upload, document.id, kb.id)
    return KBDocumentOut.model_validate(document)


@router.get("/{kb_id}/documents", response_model=List[KBDocumentOut])
def list_documents(
    kb_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kb = _kb_or_404(db, kb_id, current_user)
    return [KBDocumentOut.model_validate(d) for d in kb.documents]


@router.delete("/{kb_id}/documents/{doc_id}", status_code=204)
def delete_document(
    kb_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kb = _kb_or_404(db, kb_id, current_user)
    document = db.query(KBDocument).filter(
        KBDocument.id == doc_id, KBDocument.kb_id == kb.id
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.source_path and os.path.exists(document.source_path):
        try:
            os.unlink(document.source_path)
        except OSError:
            pass
    db.delete(document)
    db.commit()


# ── Query ────────────────────────────────────────────────────────────────────


@router.post("/{kb_id}/query", response_model=KBQueryResponse)
async def query_knowledge_base(
    kb_id: int,
    body: KBQueryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kb = _kb_or_404(db, kb_id, current_user)
    matches = await search(db, kb, body.query, body.top_k)
    hits = [
        KBQueryHit(
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            document_filename=chunk.document.filename if chunk.document else "unknown",
            score=score,
            content=chunk.content,
            order_idx=chunk.order_idx,
        )
        for chunk, score in matches
    ]
    return KBQueryResponse(query=body.query, hits=hits)


# ── URL/Website Crawl ────────────────────────────────────────────────────────


class CrawlRequest(BaseModel):
    url: str
    max_pages: int = 3


async def _process_crawl(document_id: int, kb_id: int) -> None:
    from ..services.retrieval_service import ingest_document
    db = SessionLocal()
    try:
        document = db.query(KBDocument).filter(KBDocument.id == document_id).first()
        if not document:
            return
        kb = db.query(KnowledgeBase).filter(KnowledgeBase.id == kb_id).first()
        if not kb:
            return
        try:
            with open(document.source_path) as f:
                raw = f.read()
            await ingest_document(db, kb, document, raw)
        except Exception as e:
            document.status = "failed"
            document.error = str(e)
            db.commit()
    finally:
        db.close()


@router.post("/{kb_id}/crawl", response_model=KBDocumentOut, status_code=201)
async def crawl_url(
    kb_id: int,
    body: CrawlRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    kb = _kb_or_404(db, kb_id, current_user)

    try:
        import httpx
        from bs4 import BeautifulSoup

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(body.url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        title = soup.title.string.strip() if soup.title else body.url

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {e}")

    kb_dir = Path(settings.UPLOADS_DIR) / f"kb_{kb.id}"
    kb_dir.mkdir(parents=True, exist_ok=True)

    document = KBDocument(
        kb_id=kb.id,
        filename=f"{title[:80]}.txt",
        mime_type="text/plain",
        status="pending",
        source_path="",
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    dest = kb_dir / f"{document.id}_crawl.txt"
    dest.write_text(text, encoding="utf-8")
    document.source_path = str(dest)
    document.size_bytes = dest.stat().st_size
    db.commit()

    background_tasks.add_task(_process_crawl, document.id, kb.id)
    return KBDocumentOut.model_validate(document)
