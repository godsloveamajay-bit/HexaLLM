import asyncio
import base64
import io
import json
import re
import time
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import AsyncIterator, Dict, List, Optional, Tuple
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.chat import ChatSession, ChatMessage, RequestLog
from ..models.knowledge import KnowledgeBase, KBChunk
from ..schemas.chat import (
    ChatRequest, ChatSessionCreate, ChatSessionOut, ChatMessageOut,
)
from ..services.ollama_service import ollama
from ..services.retrieval_service import search as kb_search, format_context
from ..services import model_router

router = APIRouter(prefix="/chat", tags=["chat"])


# ── CLI-backed tool descriptions ───────────────────────────────────────────────

_CLI_TOOLS = {
    "run_command":  "Run a shell command and return stdout+stderr. Input: command string.",
    "bash_exec":    "Run a bash command. Input: bash command string.",
    "read_file":    "Read a file's contents. Input: file path.",
    "write_file":   'Create or overwrite a file. Input: JSON {"path": "...", "content": "..."}',
    "patch_file":   'Replace text in a file. Input: JSON {"path": "...", "old": "...", "new": "..."}',
    "list_files":   'List a directory. Input: path (default ".").',
    "search_files": 'Search for text in files. Input: JSON {"pattern": "...", "path": "."}',
}

_CLI_TOOLS_PROMPT = """\

---
You have live terminal access to the user's machine via nebula-cli.
Use these tools when the user asks you to run commands, read/write files, or interact with their system.
Only use tools when genuinely needed — answer simple questions directly.

Available tools:
{tools}

STRICT FORMAT — every reply must be ONLY a valid JSON object, no markdown fences:
  Use a tool: {{"thought": "<brief reasoning>", "tool": "<name>", "input": "<input>"}}
  Final reply:{{"thought": "<brief reasoning>", "tool": "done",   "input": "<your response>"}}
---"""


def _extract_json_chat(text: str) -> Optional[dict]:
    """Pull a JSON object out of model output using 3 fallback strategies."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    stripped = re.sub(r"```(?:json)?\s*|\s*```", "", text).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    if start != -1:
        depth, in_str, esc = 0, False, False
        for i, ch in enumerate(text[start:], start):
            if esc:
                esc = False
                continue
            if ch == "\\" and in_str:
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start: i + 1])
                    except json.JSONDecodeError:
                        break
    return None


async def _dispatch_cli_tool(
    session,
    tool_name: str,
    tool_input: str,
    timeout: float = 60.0,
) -> str:
    """Send a single tool call to the CLI daemon and await its result."""
    task_id = str(uuid.uuid4())
    q: asyncio.Queue = asyncio.Queue()
    session.task_queues[task_id] = q
    try:
        await session.ws.send_json({
            "type":    "run_tool",
            "task_id": task_id,
            "tool":    tool_name,
            "input":   tool_input,
        })
        msg = await asyncio.wait_for(q.get(), timeout=timeout)
        return msg.get("output", "(no output)")
    except asyncio.TimeoutError:
        return f"Tool '{tool_name}' timed out after {timeout:.0f}s"
    except Exception as exc:
        return f"Tool dispatch error: {exc}"
    finally:
        session.task_queues.pop(task_id, None)


async def _cli_agent_stream(
    messages: List[Dict],
    system_prompt: str,
    model: str,
    cli_session_id: str,
    user_id: int,
    collected: Dict,
    max_steps: int = 15,
) -> AsyncIterator[str]:
    """
    ReAct loop that runs LLM reasoning locally but dispatches every tool call
    to the connected CLI daemon.  Yields SSE-formatted strings:
      event: step  (tool call + output)
      data: token  (final answer streamed char-by-char style)
    """
    from .cli_tunnel import _registry

    user_sessions = _registry.get(user_id, {})
    cli_session = user_sessions.get(cli_session_id)
    if not cli_session:
        collected["text"] = "(CLI session not found or disconnected)"
        yield f"data: {collected['text']}\n\n"
        return

    tool_list = "\n".join(f"  {k}: {v}" for k, v in _CLI_TOOLS.items())
    augmented_system = (system_prompt or "") + _CLI_TOOLS_PROMPT.format(tools=tool_list)

    agent_messages = list(messages)
    final_text = ""
    fix_prompt = (
        "Your reply was not valid JSON. Reply with ONLY a JSON object:\n"
        '{"thought": "...", "tool": "<tool or done>", "input": "..."}'
    )

    for _ in range(max_steps):
        raw = ""
        async for chunk in ollama.chat_stream(model, agent_messages, augmented_system, temperature=0.1):
            raw += chunk

        parsed = _extract_json_chat(raw)
        if not parsed:
            fix_msgs = agent_messages + [
                {"role": "assistant", "content": raw or "(empty)"},
                {"role": "user",      "content": fix_prompt},
            ]
            raw2 = ""
            async for chunk in ollama.chat_stream(model, fix_msgs, augmented_system, temperature=0.1):
                raw2 += chunk
            parsed = _extract_json_chat(raw2)
            if not parsed:
                final_text = f"(Model returned malformed response: {raw[:200]})"
                yield f"data: {final_text}\n\n"
                collected["text"] = final_text
                return

        agent_messages.append({"role": "assistant", "content": raw})
        tool_name  = parsed.get("tool", "")
        tool_input = str(parsed.get("input", ""))
        thought    = parsed.get("thought", "")

        if tool_name == "done":
            final_text = tool_input
            # stream the answer in reasonable chunks
            chunk_size = max(4, len(final_text) // 80)
            for i in range(0, len(final_text), chunk_size):
                yield f"data: {final_text[i:i + chunk_size]}\n\n"
            collected["text"] = final_text
            return

        if tool_name not in _CLI_TOOLS:
            output = f"Unknown tool '{tool_name}'. Available: {', '.join(_CLI_TOOLS)}"
        else:
            output = await _dispatch_cli_tool(cli_session, tool_name, tool_input)

        step_payload = json.dumps({
            "name":    tool_name,
            "input":   tool_input,
            "output":  output,
            "thought": thought,
        })
        yield f"event: step\ndata: {step_payload}\n\n"

        agent_messages.append({"role": "user", "content": f"Tool result:\n{output}"})

    final_text = "Reached maximum steps without completing the task."
    yield f"data: {final_text}\n\n"
    collected["text"] = final_text


def log_request(db: Session, user_id: int, endpoint: str, method: str, status_code: int,
                model_name: str = None, prompt_tokens: int = 0, completion_tokens: int = 0,
                latency_ms: int = None, ip: str = None):
    log = RequestLog(
        user_id=user_id,
        endpoint=endpoint,
        method=method,
        status_code=status_code,
        model_name=model_name,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency_ms,
        ip_address=ip,
    )
    db.add(log)
    db.commit()


async def _retrieve_kb_context(
    db: Session, user: User, req: ChatRequest
) -> Tuple[str, list]:
    """Return (augmented_system_prompt, citation_payload).

    If no KB requested, returns the original system_prompt unchanged and an empty list.
    """
    if not req.knowledge_base_id:
        return req.system_prompt or "", []

    kb = db.query(KnowledgeBase).filter(
        KnowledgeBase.id == req.knowledge_base_id,
        KnowledgeBase.user_id == user.id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")

    last_user_msg = next((m for m in reversed(req.messages) if m.role == "user"), None)
    if not last_user_msg:
        return req.system_prompt or "", []

    matches = await kb_search(db, kb, last_user_msg.content, req.top_k)
    if not matches:
        return req.system_prompt or "", []

    context_block = format_context(matches)
    rag_prompt = (
        "You are a helpful assistant. Use the following retrieved context to "
        "answer the user's question. Cite sources using [1], [2], ... when "
        "relevant. If the context does not contain the answer, say so.\n\n"
        f"--- CONTEXT ---\n{context_block}\n--- END CONTEXT ---"
    )
    augmented = f"{req.system_prompt}\n\n{rag_prompt}" if req.system_prompt else rag_prompt

    citations = [
        {
            "index": i + 1,
            "chunk_id": chunk.id,
            "document_id": chunk.document_id,
            "document_filename": chunk.document.filename if chunk.document else "unknown",
            "score": round(score, 4),
            "snippet": chunk.content[:240],
        }
        for i, (chunk, score) in enumerate(matches)
    ]
    return augmented, citations


async def _apply_router(req: ChatRequest):
    """If req.model is a nebulax:* variant, resolve it. Returns
    (effective_model, variant_system_prompt, temperature, num_ctx, num_predict, route_meta).
    For non-variant models, returns the request values unchanged with route_meta=None.
    """
    if not model_router.is_variant(req.model):
        return req.model, "", req.temperature, None, req.max_tokens, None

    last_user_msg = next((m for m in reversed(req.messages) if m.role == "user"), None)
    user_text = last_user_msg.content if last_user_msg else ""

    available = await ollama.list_models()
    available_names = [m["name"] for m in available]

    try:
        decision = model_router.route(req.model, user_text, available_names)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return (
        decision.chosen_model,
        decision.system_prompt,
        decision.temperature,
        decision.num_ctx,
        decision.num_predict if req.max_tokens is None else req.max_tokens,
        {
            "variant": decision.variant_id,
            "chosen_model": decision.chosen_model,
            "reason": decision.reason,
        },
    )


def _resolve_attachment(req: ChatRequest, messages: List[Dict]) -> List[str]:
    """Extract attachment from request. Mutates messages in-place for text/pdf.
    Returns list of base64 image strings for multimodal, or empty list."""
    if not req.attachment_base64 or not req.attachment_type:
        return []

    raw_b64 = req.attachment_base64
    if "," in raw_b64:
        raw_b64 = raw_b64.split(",", 1)[1]

    if req.attachment_type == "image":
        return [raw_b64]

    # Text or PDF: decode and prepend to last user message
    try:
        raw_bytes = base64.b64decode(raw_b64)
        if req.attachment_type == "pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw_bytes))
            text = "\n".join(p.extract_text() or "" for p in reader.pages)
        else:
            text = raw_bytes.decode("utf-8", errors="replace")
        name = req.attachment_name or "document"
        for i in range(len(messages) - 1, -1, -1):
            if messages[i].get("role") == "user":
                messages[i] = {
                    **messages[i],
                    "content": f"[Attached: {name}]\n\n{text[:8000]}\n\n---\n\n{messages[i]['content']}",
                }
                break
    except Exception:
        pass
    return []


@router.post("/completions")
async def chat_completions(
    req: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = None
    if req.session_id:
        session = db.query(ChatSession).filter(
            ChatSession.id == req.session_id, ChatSession.user_id == current_user.id
        ).first()

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    images = _resolve_attachment(req, messages)
    start = time.time()

    # Route nebulax:* variants → concrete Ollama model + variant params.
    eff_model, variant_prompt, eff_temp, eff_ctx, eff_max, route_meta = await _apply_router(req)

    # User-supplied system_prompt is honored only for variants that opt in
    # (currently nebulax:custom) and for raw Ollama model calls. Other
    # NebulaX variants enforce their branded voice.
    user_supplied_prompt = req.system_prompt
    if model_router.is_variant(req.model) and not model_router.allows_user_prompt(req.model):
        user_supplied_prompt = None

    base_system_prompt = model_router.merge_system_prompt(variant_prompt, user_supplied_prompt)
    # Inject user memories if the session has memory enabled (or always for now)
    from ..models.memory import UserMemory
    user_memories = db.query(UserMemory).filter(
        UserMemory.user_id == current_user.id
    ).order_by(UserMemory.created_at.desc()).limit(20).all()
    if user_memories:
        mem_block = "\n".join(f"- {m.content}" for m in user_memories)
        memory_section = f"\n\n[User Memory — things you know about this user]\n{mem_block}"
        base_system_prompt = (base_system_prompt or "") + memory_section

    # Build a derived request so _retrieve_kb_context sees the merged prompt.
    req_for_kb = req.model_copy(update={"system_prompt": base_system_prompt})
    system_prompt, citations = await _retrieve_kb_context(db, current_user, req_for_kb)

    if req.stream:
        async def generate():
            full_response = ""
            usage_info: Dict = {}
            try:
                if route_meta:
                    yield f"event: route\ndata: {json.dumps(route_meta)}\n\n"
                if citations:
                    yield f"event: citations\ndata: {json.dumps(citations)}\n\n"

                if req.cli_session_id:
                    collected: Dict = {}
                    async for sse_chunk in _cli_agent_stream(
                        messages=messages,
                        system_prompt=system_prompt,
                        model=eff_model,
                        cli_session_id=req.cli_session_id,
                        user_id=current_user.id,
                        collected=collected,
                    ):
                        yield sse_chunk
                    full_response = collected.get("text", "")
                else:
                    async for chunk in ollama.chat_stream(
                        eff_model, messages, system_prompt, eff_temp, eff_max, eff_ctx,
                        images=images, usage=usage_info,
                    ):
                        full_response += chunk
                        yield f"data: {chunk}\n\n"
            finally:
                latency = int((time.time() - start) * 1000)
                prompt_tok = usage_info.get("prompt_tokens", 0)
                completion_tok = usage_info.get("completion_tokens", 0)
                if session:
                    last_user_msg = next((m for m in reversed(req.messages) if m.role == "user"), None)
                    if last_user_msg:
                        db.add(ChatMessage(session_id=session.id, role="user", content=last_user_msg.content))
                    db.add(ChatMessage(
                        session_id=session.id, role="assistant", content=full_response,
                        latency_ms=latency,
                        tokens_used=(prompt_tok + completion_tok) or None,
                    ))
                    session.updated_at = datetime.now(timezone.utc)
                    db.commit()
                log_request(db, current_user.id, "/chat/completions", "POST", 200,
                            model_name=req.model, latency_ms=latency,
                            prompt_tokens=prompt_tok, completion_tokens=completion_tok)
                if usage_info:
                    yield f"event: usage\ndata: {json.dumps({'prompt_tokens': prompt_tok, 'completion_tokens': completion_tok, 'latency_ms': latency})}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    # Non-streaming
    full_response = ""
    async for chunk in ollama.chat_stream(eff_model, messages, system_prompt, eff_temp, eff_max, eff_ctx):
        full_response += chunk

    latency = int((time.time() - start) * 1000)
    log_request(db, current_user.id, "/chat/completions", "POST", 200, model_name=req.model, latency_ms=latency)
    return {
        "content": full_response,
        "model": req.model,
        "latency_ms": latency,
        "citations": citations,
        "route": route_meta,
    }


@router.get("/sessions", response_model=List[ChatSessionOut])
def list_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ChatSession).filter(ChatSession.user_id == current_user.id).order_by(ChatSession.updated_at.desc()).all()


@router.post("/sessions", response_model=ChatSessionOut, status_code=201)
def create_session(
    data: ChatSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = ChatSession(
        user_id=current_user.id,
        title=data.title or "New Chat",
        model_name=data.model_name,
        system_prompt=data.system_prompt,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.post("/sessions/{session_id}/rename", response_model=ChatSessionOut)
async def rename_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ask the current model to generate a short title from the first user message."""
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    first_user = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id, ChatMessage.role == "user"
    ).order_by(ChatMessage.id).first()
    if not first_user:
        raise HTTPException(status_code=400, detail="No messages yet")

    available = {m["name"] for m in await ollama.list_models()}
    if not available:
        raise HTTPException(status_code=503, detail="Ollama unavailable")

    # Prefer the session's saved model; fall back to any available model.
    candidate = session.model_name if session.model_name in available else next(iter(available))
    if model_router.is_variant(candidate):
        try:
            decision = model_router.route(candidate, first_user.content, list(available))
            candidate = decision.chosen_model
        except RuntimeError:
            candidate = next(iter(available))

    try:
        title = await ollama.generate_title(candidate, first_user.content)
    except Exception:
        title = first_user.content[:60]

    title = title[:80] or "New Chat"
    session.title = title
    db.commit()
    db.refresh(session)
    return session


@router.patch("/sessions/{session_id}", response_model=ChatSessionOut)
def update_session(
    session_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if "title" in data:
        session.title = str(data["title"])[:80]
    if "model_name" in data:
        session.model_name = str(data["model_name"])[:200]
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageOut])
def get_messages(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.messages


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()


@router.post("/sessions/{session_id}/share")
def share_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id, ChatSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.share_token:
        session.share_token = str(uuid.uuid4())
        db.commit()
    return {"token": session.share_token}


@router.get("/share/{token}")
def get_shared_session(token: str, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.share_token == token).first()
    if not session:
        raise HTTPException(status_code=404, detail="Share not found")
    return {
        "title": session.title,
        "model_name": session.model_name,
        "messages": [
            {"role": m.role, "content": m.content}
            for m in session.messages
        ],
    }
