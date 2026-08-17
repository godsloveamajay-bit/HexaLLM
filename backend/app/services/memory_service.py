"""Automatic long-term memory.

Extracts durable facts about a user from conversations and stores them as
UserMemory rows (source="auto") with duplicate-skip and a per-user cap, so the
chat system-prompt injection stays fresh without growing without bound.
"""
import json
import re
from typing import List, Optional

from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..models.memory import UserMemory

AUTO_CAP = 80          # max auto memories kept per user
EXTRACT_LIMIT = 8      # max facts per extraction pass
MIN_FACT_LEN = 8
MAX_FACT_LEN = 400
MIN_CONVO_CHARS = 80   # skip tiny exchanges — nothing worth remembering

_SYSTEM_PROMPT = (
    "Extract a short list of important, specific facts about the user from this conversation. "
    "Each fact should be one sentence. Only include facts worth remembering long-term "
    "(preferences, goals, context about who they are or what they're working on). "
    "Never include sensitive data such as passwords, tokens or financial details. "
    'Output ONLY a JSON array of strings, e.g. ["User prefers Python.", "User is building a fintech app."] '
    "If there is nothing worth remembering, output []."
)


def _parse_facts(raw: str) -> List[str]:
    try:
        facts = json.loads(raw.strip())
        if isinstance(facts, list):
            return [f for f in facts if isinstance(f, str)]
    except Exception:
        pass
    m = re.search(r"\[.*?\]", raw, re.DOTALL)
    if m:
        try:
            facts = json.loads(m.group())
            if isinstance(facts, list):
                return [f for f in facts if isinstance(f, str)]
        except Exception:
            pass
    return []


def _clean_fact(fact: str) -> Optional[str]:
    f = " ".join(fact.split()).strip().strip("\"'")
    if len(f) < MIN_FACT_LEN or len(f) > MAX_FACT_LEN:
        return None
    return f


def _is_duplicate(existing: List[str], fact: str) -> bool:
    fl = fact.lower()
    for e in existing:
        el = e.lower()
        if fl == el:
            return True
        if len(fl) >= 20 and (fl in el or el in fl):
            return True
    return False


async def extract_and_store(
    db: Session,
    user_id: int,
    messages: List[dict],
    session_id: Optional[int] = None,
    fast_model: Optional[str] = None,
) -> List[str]:
    """Extract durable facts from a conversation and persist them (source="auto").

    Deduplicates against existing memories and caps total auto memories per user
    (oldest evicted). Returns the list of facts actually saved.
    """
    conversation = "\n".join(
        f"{m.get('role', '?').upper()}: {m.get('content', '')}" for m in messages[-20:]
    )
    if len(conversation) < MIN_CONVO_CHARS:
        return []

    if fast_model is None:
        from .ollama_service import ollama
        from . import model_router
        avail = [m["name"] for m in await ollama.list_models()]
        fast_model = model_router.fast_model_for(avail) or "qwen2.5:7b"

    raw = ""
    async for chunk in ollama.chat_stream(
        fast_model,
        [{"role": "user", "content": f"Conversation:\n{conversation}"}],
        system_prompt=_SYSTEM_PROMPT,
        temperature=0.1,
    ):
        raw += chunk

    existing = [m.content for m in db.query(UserMemory).filter(UserMemory.user_id == user_id).all()]
    auto_count = db.query(UserMemory).filter(
        UserMemory.user_id == user_id, UserMemory.source == "auto"
    ).count()

    saved: List[str] = []
    for fact in _parse_facts(raw)[:EXTRACT_LIMIT]:
        f = _clean_fact(fact)
        if not f or _is_duplicate(existing, f):
            continue
        if auto_count >= AUTO_CAP:
            oldest = (
                db.query(UserMemory)
                .filter(UserMemory.user_id == user_id, UserMemory.source == "auto")
                .order_by(UserMemory.created_at.asc(), UserMemory.id.asc())
                .first()
            )
            if oldest:
                db.delete(oldest)
            auto_count -= 1
        db.add(UserMemory(user_id=user_id, content=f, source="auto", session_id=session_id))
        existing.append(f)
        auto_count += 1
        saved.append(f)
    db.commit()
    return saved


async def run_auto_extract(user_id: int, messages: List[dict], session_id: Optional[int]) -> List[str]:
    """Background entry point — owns its own DB session, because request-scoped
    sessions are closed by the time the streaming response finishes."""
    db = SessionLocal()
    try:
        return await extract_and_store(db, user_id, messages, session_id)
    except Exception:
        db.rollback()
        return []
    finally:
        db.close()
