"""RAG retrieval service: chunking + embedding + cosine similarity search."""
from __future__ import annotations

import math
import re
from typing import List, Tuple

from sqlalchemy.orm import Session

from ..models.knowledge import KBChunk, KBDocument, KnowledgeBase
from .ollama_service import ollama


_WS_RE = re.compile(r"\s+")


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Split text into roughly word-sized chunks with overlap.

    chunk_size and overlap are measured in words, not characters — easier to
    reason about for token budgets.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if overlap < 0 or overlap >= chunk_size:
        overlap = max(0, min(overlap, chunk_size - 1))

    text = _WS_RE.sub(" ", text).strip()
    if not text:
        return []

    words = text.split(" ")
    step = chunk_size - overlap
    chunks: List[str] = []
    i = 0
    while i < len(words):
        piece = words[i : i + chunk_size]
        chunks.append(" ".join(piece))
        if i + chunk_size >= len(words):
            break
        i += step
    return chunks


def cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


async def ingest_document(
    db: Session,
    kb: KnowledgeBase,
    document: KBDocument,
    raw_text: str,
) -> int:
    """Chunk, embed, and store a document. Returns number of chunks created."""
    document.status = "processing"
    db.commit()

    try:
        pieces = chunk_text(raw_text, kb.chunk_size, kb.chunk_overlap)
        if not pieces:
            document.status = "ready"
            document.chunks_count = 0
            db.commit()
            return 0

        # Embed sequentially. For large docs this is the slow part; acceptable for v1.
        for idx, piece in enumerate(pieces):
            vec = await ollama.embed(kb.embedding_model, piece)
            if not vec:
                raise RuntimeError(
                    f"empty embedding from model '{kb.embedding_model}' — is it pulled in Ollama?"
                )
            db.add(
                KBChunk(
                    kb_id=kb.id,
                    document_id=document.id,
                    order_idx=idx,
                    content=piece,
                    embedding=vec,
                    meta={"chunk_index": idx, "total": len(pieces)},
                )
            )

        document.chunks_count = len(pieces)
        document.status = "ready"
        document.error = None
        db.commit()
        return len(pieces)
    except Exception as e:
        # Roll back any chunks added for this document so a failed ingest
        # doesn't pollute search results, then record the failure.
        db.query(KBChunk).filter(KBChunk.document_id == document.id).delete()
        document.status = "failed"
        document.error = str(e)
        db.commit()
        raise


async def search(
    db: Session,
    kb: KnowledgeBase,
    query: str,
    top_k: int = 4,
) -> List[Tuple[KBChunk, float]]:
    """Embed query and return top-k chunks by cosine similarity."""
    qvec = await ollama.embed(kb.embedding_model, query)
    if not qvec:
        return []

    chunks = db.query(KBChunk).filter(KBChunk.kb_id == kb.id).all()
    scored = [(c, cosine(qvec, c.embedding or [])) for c in chunks]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


def format_context(matches: List[Tuple[KBChunk, float]]) -> str:
    """Render retrieved chunks as a context block for the prompt."""
    if not matches:
        return ""
    parts = []
    for i, (chunk, score) in enumerate(matches, 1):
        doc_name = chunk.document.filename if chunk.document else "unknown"
        parts.append(f"[{i}] (source: {doc_name}, score: {score:.3f})\n{chunk.content}")
    return "\n\n".join(parts)
