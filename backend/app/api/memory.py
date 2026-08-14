from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.memory import UserMemory
from ..models.knowledge import KnowledgeBase, KBDocument, KBChunk
from ..services.ollama_service import ollama
from ..services.retrieval_service import cosine

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
    created_at: datetime

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


# ── Memory-Graph Visualizer ──────────────────────────────────────────────────

def _semantic_edges(embeddings: dict, threshold: float, top_k: int = 4) -> List[dict]:
    """Compute undirected similarity edges between embedded nodes. Keeps the
    top-k strongest links per node above `threshold` so the graph stays sparse.
    Uses numpy if available (fast matrix product), else a pure-Python fallback."""
    ids = list(embeddings.keys())
    n = len(ids)
    if n < 2:
        return []

    pairs: dict = {}  # (a,b) sorted -> weight

    try:
        import numpy as np
        mat = np.array([embeddings[i] for i in ids], dtype="float32")
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        mat = mat / norms
        sims = mat @ mat.T
        np.fill_diagonal(sims, -1.0)
        for i in range(n):
            row = sims[i]
            order = np.argsort(row)[::-1][:top_k]
            for j in order:
                s = float(row[j])
                if s < threshold:
                    break
                key = tuple(sorted((ids[i], ids[int(j)])))
                if key[0] != key[1] and (key not in pairs or pairs[key] < s):
                    pairs[key] = s
    except Exception:
        # Pure-Python fallback (capped by the caller's node budget).
        for i in range(n):
            sims = []
            for j in range(n):
                if i == j:
                    continue
                s = cosine(embeddings[ids[i]], embeddings[ids[j]])
                if s >= threshold:
                    sims.append((ids[j], s))
            sims.sort(key=lambda x: x[1], reverse=True)
            for tgt, s in sims[:top_k]:
                key = tuple(sorted((ids[i], tgt)))
                if key not in pairs or pairs[key] < s:
                    pairs[key] = s

    return [
        {"source": a, "target": b, "type": "semantic", "weight": round(w, 3)}
        for (a, b), w in pairs.items()
    ]


@router.get("/graph")
async def memory_graph(
    threshold: float = 0.78,
    max_nodes: int = 240,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A graph of how the AI stores and connects knowledge: KnowledgeBase →
    Document → Chunk containment, semantic similarity links derived from the
    chunk embeddings, and your saved memories embedded and linked in."""
    threshold = max(0.0, min(1.0, threshold))
    nodes: List[dict] = []
    edges: List[dict] = []
    embeddings: dict = {}  # node_id -> vector (for semantic edges)

    kbs = db.query(KnowledgeBase).filter(KnowledgeBase.user_id == current_user.id).all()
    embed_model = kbs[0].embedding_model if kbs else "nomic-embed-text"

    chunk_budget = max_nodes
    for kb in kbs:
        nodes.append({"id": f"kb-{kb.id}", "type": "kb", "label": kb.name,
                      "detail": kb.description or ""})
        docs = db.query(KBDocument).filter(KBDocument.kb_id == kb.id).all()
        doc_ids = set()
        for doc in docs:
            doc_ids.add(doc.id)
            nodes.append({"id": f"doc-{doc.id}", "type": "document", "label": doc.filename,
                          "detail": f"{doc.chunks_count} chunks · {doc.status}"})
            edges.append({"source": f"kb-{kb.id}", "target": f"doc-{doc.id}", "type": "contains"})

        chunks = db.query(KBChunk).filter(KBChunk.kb_id == kb.id).order_by(KBChunk.id).all()
        for ch in chunks:
            if chunk_budget <= 0:
                break
            cid = f"chunk-{ch.id}"
            nodes.append({"id": cid, "type": "chunk",
                          "label": (ch.content or "")[:48],
                          "detail": (ch.content or "")[:280]})
            if ch.document_id in doc_ids:
                edges.append({"source": f"doc-{ch.document_id}", "target": cid, "type": "contains"})
            else:
                edges.append({"source": f"kb-{kb.id}", "target": cid, "type": "contains"})
            if ch.embedding:
                embeddings[cid] = ch.embedding
            chunk_budget -= 1

    # Saved memories — embed on the fly (best effort) so they link into the graph.
    mems = db.query(UserMemory).filter(
        UserMemory.user_id == current_user.id
    ).order_by(UserMemory.created_at.desc()).limit(60).all()
    for m in mems:
        mid = f"mem-{m.id}"
        nodes.append({"id": mid, "type": "memory",
                      "label": (m.content or "")[:48],
                      "detail": (m.content or "")[:280],
                      "source_kind": m.source})
        try:
            vec = await ollama.embed(embed_model, m.content)
            if vec:
                embeddings[mid] = vec
        except Exception:
            pass

    edges.extend(_semantic_edges(embeddings, threshold))

    stats = {
        "kbs": len(kbs),
        "documents": sum(1 for n in nodes if n["type"] == "document"),
        "chunks": sum(1 for n in nodes if n["type"] == "chunk"),
        "memories": sum(1 for n in nodes if n["type"] == "memory"),
        "semantic_edges": sum(1 for e in edges if e["type"] == "semantic"),
        "embed_model": embed_model,
        "threshold": threshold,
    }
    return {"nodes": nodes, "edges": edges, "stats": stats}


@router.post("/extract")
async def extract_memories(
    data: AutoExtractRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ask the LLM to extract memorable facts from a conversation.

    Shared with the automatic pipeline (memory_service) so manual and auto
    extraction behave identically (dedup + caps)."""
    from ..services.memory_service import extract_and_store
    messages = [{"role": m["role"], "content": m["content"]} for m in data.messages[-20:]]
    saved = await extract_and_store(db, current_user.id, messages)
    return {"extracted": saved}
