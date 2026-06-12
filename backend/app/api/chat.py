import asyncio
import base64
import io
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import AsyncIterator, Dict, List, Optional, Tuple
from ..core.database import get_db
from ..core.security import get_current_user, get_optional_user
from ..models.user import User
from ..models.chat import ChatSession, ChatMessage, RequestLog
from ..models.knowledge import KnowledgeBase
from ..schemas.chat import (
    ChatRequest, ChatSessionCreate, ChatSessionOut, ChatMessageOut,
)
from ..services.ollama_service import ollama
from ..services.retrieval_service import search as kb_search, format_context
from ..services import model_router
from ..services import web_search as web_search_svc
from ..core import personality as personality_engine

router = APIRouter(prefix="/chat", tags=["chat"])

# ── Guest (unauthenticated) chat ──────────────────────────────────────────
# Visitors can try the chat before signing up: unlimited messages, but a soft
# per-IP daily *token* budget, with all account-bound features (history, memory,
# KB, attachments, CLI, media gen) disabled. Usage is tallied in-memory (single
# uvicorn process) and resets at UTC midnight — a deliberately lightweight gate,
# not a hard security boundary. Tokens are charged after each reply, so the
# message that crosses the budget still completes; the next one is blocked.
GUEST_DAILY_TOKENS = int(os.getenv("GUEST_DAILY_TOKENS", "5000"))
GUEST_DEFAULT_MODEL = os.getenv("GUEST_DEFAULT_MODEL", "nebulax:balanced")

# Context window / output budget. Ollama defaults to a tiny 2048-token context,
# which truncates long prompts and — most visibly — reasoning models' chain-of-
# thought ("runs out of space to think"). Give chat a roomier window, and even
# more room plus a higher output cap for reasoning models. Env-overridable.
CHAT_NUM_CTX = int(os.getenv("CHAT_NUM_CTX", "8192"))
REASON_NUM_CTX = int(os.getenv("CHAT_REASON_NUM_CTX", "16384"))
REASON_MIN_PREDICT = int(os.getenv("CHAT_REASON_MAX_TOKENS", "8192"))

# Web search grounding. CPU prefill on this box is ~2 tok/s, so the sources we
# inject dominate latency — a big context = minutes of "reading" before the first
# answer token. Keep the injected set small, route synthesis to a fast small model
# (extractive Q&A doesn't need a big one), and cap the answer length. All env-tunable.
WEB_MAX_RESULTS = int(os.getenv("WEB_SEARCH_MAX_RESULTS", "3"))
WEB_MAX_PREDICT = int(os.getenv("WEB_SEARCH_MAX_TOKENS", "600"))
WEB_FAST_MODEL = os.getenv("WEB_SEARCH_MODEL", "")  # "" → pick the router's fast model
_guest_usage: Dict[str, Tuple[str, int]] = {}  # ip -> (utc_date, tokens_used_today)


def _client_ip(request: Request) -> str:
    """Real client IP, honoring the nginx/cloudflared X-Forwarded-For header."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _guest_tokens_remaining(ip: str) -> int:
    """Tokens left in this IP's budget today (does not charge anything)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day, used = _guest_usage.get(ip, (today, 0))
    if day != today:
        used = 0
    return max(0, GUEST_DAILY_TOKENS - used)


def _guest_charge_tokens(ip: str, tokens: int) -> int:
    """Charge tokens against today's guest budget; returns tokens remaining."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day, used = _guest_usage.get(ip, (today, 0))
    if day != today:
        used = 0
    used += max(0, tokens)
    _guest_usage[ip] = (today, used)
    return max(0, GUEST_DAILY_TOKENS - used)


async def _stream_with_keepalive(agen, interval: float = 20.0):
    """Iterate an async generator, emitting a keepalive sentinel during long gaps.

    A cold model load on this CPU-only box can take minutes before the first
    token. Cloudflare returns 524 if the origin sends nothing for ~100s, so we
    interleave keepalives to hold the connection open until the first real token
    arrives. Yields ("chunk", value) for real items and ("ping", None) otherwise.
    """
    queue: asyncio.Queue = asyncio.Queue()
    _DONE = object()

    async def _pump():
        try:
            async for item in agen:
                await queue.put(("chunk", item))
        except Exception as exc:  # propagate to the consumer
            await queue.put(("error", exc))
        finally:
            await queue.put(("done", _DONE))

    task = asyncio.create_task(_pump())
    try:
        while True:
            try:
                kind, value = await asyncio.wait_for(queue.get(), timeout=interval)
            except asyncio.TimeoutError:
                yield ("ping", None)
                continue
            if kind == "done":
                return
            if kind == "error":
                raise value
            yield ("chunk", value)
    finally:
        task.cancel()
        try:
            await task
        except BaseException:
            pass


def _sse_data(value: str) -> str:
    """SSE-encode a token while preserving newlines.

    A naive ``data: {value}\\n\\n`` breaks whenever ``value`` contains a newline:
    the blank line terminates the event early and the remainder is dropped by the
    client parser, so multi-line answers and chain-of-thought collapse onto one
    line. SSE allows multi-line payloads as repeated ``data:`` lines, and the
    frontend rejoins them with ``\\n`` — so emit one ``data:`` line per text line.
    """
    return "".join(f"data: {line}\n" for line in value.split("\n")) + "\n"


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
    # Strip reasoning-model <think>…</think> first — its stray braces and example
    # JSON derail the parser and bury the real tool call (deepseek-r1, qwen3).
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL | re.IGNORECASE)
    if "</think>" in text:
        text = text.rsplit("</think>", 1)[-1]
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
        yield _sse_data(collected['text'])
        return

    tool_list = "\n".join(f"  {k}: {v}" for k, v in _CLI_TOOLS.items())
    augmented_system = (system_prompt or "") + _CLI_TOOLS_PROMPT.format(tools=tool_list)

    # Reasoning models must answer the JSON tool protocol directly — let them
    # reason for minutes per step on this CPU box and the chain-of-thought also
    # pollutes the JSON. think=False keeps each step fast and parseable.
    agent_think = False if model_router.is_reasoning_model(model) else None

    agent_messages = list(messages)
    final_text = ""
    fix_prompt = (
        "Your reply was not valid JSON. Reply with ONLY a JSON object:\n"
        '{"thought": "...", "tool": "<tool or done>", "input": "..."}'
    )

    for _ in range(max_steps):
        raw = ""
        async for chunk in ollama.chat_stream(model, agent_messages, augmented_system, temperature=0.1, think=agent_think):
            raw += chunk

        parsed = _extract_json_chat(raw)
        if not parsed:
            fix_msgs = agent_messages + [
                {"role": "assistant", "content": raw or "(empty)"},
                {"role": "user",      "content": fix_prompt},
            ]
            raw2 = ""
            async for chunk in ollama.chat_stream(model, fix_msgs, augmented_system, temperature=0.1, think=agent_think):
                raw2 += chunk
            parsed = _extract_json_chat(raw2)
            if not parsed:
                final_text = f"(Model returned malformed response: {raw[:200]})"
                yield _sse_data(final_text)
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
                yield _sse_data(final_text[i:i + chunk_size])
            collected["text"] = final_text
            return

        if tool_name not in _CLI_TOOLS:
            output = f"Unknown tool '{tool_name}'. Available: {', '.join(_CLI_TOOLS)}"
        else:
            output = await _dispatch_cli_tool(cli_session, tool_name, tool_input)

        step_obj = {
            "name":    tool_name,
            "input":   tool_input,
            "output":  output,
            "thought": thought,
        }
        collected.setdefault("steps", []).append(step_obj)
        yield f"event: step\ndata: {json.dumps(step_obj)}\n\n"

        agent_messages.append({"role": "user", "content": f"Tool result:\n{output}"})

    final_text = "Reached maximum steps without completing the task."
    yield _sse_data(final_text)
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
        req.temperature if req.temperature is not None else decision.temperature,
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
    request: Request,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    # Unauthenticated visitors get a limited trial: a soft per-IP daily cap and
    # no access to account-bound features. Strip those from the request so the
    # rest of the handler can stay user-agnostic.
    is_guest = current_user is None
    guest_ip: Optional[str] = None
    guest_remaining: Optional[int] = None
    if is_guest:
        guest_ip = _client_ip(request)
        guest_remaining = _guest_tokens_remaining(guest_ip)
        if guest_remaining <= 0:
            raise HTTPException(
                status_code=429,
                detail="You've used up today's free guest tokens. "
                       "Sign in or create a free account to keep chatting.",
            )
        req.session_id = None
        req.system_prompt = None
        req.knowledge_base_id = None
        req.cli_session_id = None
        req.web_search = False
        req.attachment_base64 = req.attachment_type = req.attachment_name = None
        # Don't let a guest hand-pick an arbitrary/expensive direct model.
        if not model_router.is_variant(req.model):
            req.model = GUEST_DEFAULT_MODEL

    if not is_guest:
        from ..services.billing_enforcement import check_chat_limit
        check_chat_limit(db, current_user, client_ip=_client_ip(request))

    session = None
    if req.session_id and not is_guest:
        session = db.query(ChatSession).filter(
            ChatSession.id == req.session_id, ChatSession.user_id == current_user.id
        ).first()

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    images = _resolve_attachment(req, messages)
    start = time.time()

    # Route nebulax:* variants → concrete Ollama model + variant params.
    eff_model, variant_prompt, eff_temp, eff_ctx, eff_max, route_meta = await _apply_router(req)

    # Web-grounded answers are extractive synthesis from sources we inject, so a
    # small fast model handles them well — and on this CPU box (prefill ~2 tok/s)
    # it roughly halves the wait. Route web search to the fast model (unless an
    # image is attached, which needs the vision model). eff_ctx is reset so it's
    # recomputed for the new model below.
    web_active = bool(req.web_search) and not is_guest and not images
    if web_active:
        _avail = [m.get("name", "") for m in await ollama.list_models()]
        _fast = WEB_FAST_MODEL or model_router.fast_model_for(_avail)
        if _fast and _fast != eff_model:
            eff_model = _fast
            eff_ctx = None
            route_meta = {**(route_meta or {"variant": req.model}), "web_model": _fast}

    # Personal AI prefs: cap response length when the request didn't ask for a
    # specific one (the web UI doesn't), so the user's "max response length"
    # setting applies. API clients that pass max_tokens still win.
    if not is_guest and current_user.ai_max_tokens and req.max_tokens is None:
        eff_max = current_user.ai_max_tokens

    # If the request carries an image but the routed model can't see, switch to a
    # pulled vision model — so any department transparently handles images.
    if images and not model_router.is_vision_model(eff_model):
        _avail = [m.get("name", "") for m in await ollama.list_models()]
        _vis = model_router.vision_model_for(_avail)
        if _vis:
            eff_model = _vis
            route_meta = {**(route_meta or {"variant": req.model}), "vision_switch": _vis}

    # Suppress chain-of-thought for trivial greetings/acknowledgements sent to a
    # reasoning model, so "hi" answers instantly instead of reasoning for minutes.
    # None for substantive queries / non-reasoning models (model's default).
    _last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    eff_think = model_router.should_think(eff_model, _last_user)
    # Personal AI pref: "reasoning off" suppresses chain-of-thought on reasoning
    # models (deepseek-r1/qwen3). Non-reasoning models are left untouched (passing
    # think=False to them errors). ai_reasoning None/True = default behaviour.
    if not is_guest and current_user.ai_reasoning is False and model_router.is_reasoning_model(eff_model):
        eff_think = False

    # Decide chain-of-thought per the CPU reality (skip if already forced off by a
    # trivial msg / the user's reasoning pref). Force it ON only for the small fast
    # reasoner (deepseek-r1:1.5b → NebulaX Think), where <think> streams in seconds.
    # SUPPRESS it on heavy reasoners (qwen3:14B behind Balanced, larger deepseeks):
    # a forced pass there takes minutes to the first token and can burn the whole
    # budget thinking — the "warming forever, no answer" the user hit.
    if eff_think is None and model_router.is_reasoning_model(eff_model):
        eff_think = model_router.is_fast_reasoner(eff_model)

    # Give the model a usable context window (Ollama's 2048 default truncates long
    # prompts and reasoning chains). Reasoning turns get extra room + a higher
    # output cap so the chain-of-thought isn't cut off. A variant that pins its
    # own num_ctx (eff_ctx already set) is left untouched.
    _reasoning_active = eff_think is True and model_router.is_reasoning_model(eff_model)
    if eff_ctx is None:
        eff_ctx = REASON_NUM_CTX if _reasoning_active else CHAT_NUM_CTX
    if _reasoning_active and req.max_tokens is None and (eff_max is None or eff_max < REASON_MIN_PREDICT):
        # Don't let a low response cap (verbosity / "max response length") truncate
        # the thinking — it counts against the output budget. Explicit API max_tokens still wins.
        eff_max = REASON_MIN_PREDICT

    # Bound web-search answers so generation can't run for minutes on this slow box.
    # (Explicit API max_tokens still wins.)
    if web_active and req.max_tokens is None and (eff_max is None or eff_max > WEB_MAX_PREDICT):
        eff_max = WEB_MAX_PREDICT

    # In-chat text-to-image / text-to-video: "generate an image/video of …" works
    # in ANY chat. Skip when an image is attached (that's a vision query) or during
    # a CLI agent run. Video is checked first so "video of …" doesn't match image.
    img_prompt = None
    vid_prompt = None
    if not images and not req.cli_session_id and not is_guest:
        vid_prompt = model_router.detect_video_request(_last_user)
        if not vid_prompt:
            img_prompt = model_router.detect_image_request(_last_user)

    user_supplied_prompt = req.system_prompt

    base_system_prompt = model_router.merge_system_prompt(variant_prompt, user_supplied_prompt)
    # Personal AI preferences (Settings → AI Assistant): the user's custom
    # instructions apply to every one of their chats. Guests have no account.
    if not is_guest and (current_user.ai_instructions or "").strip():
        ci = current_user.ai_instructions.strip()
        base_system_prompt = (base_system_prompt or "") + f"\n\n[User's custom instructions — follow these]\n{ci}"
    # Inject user memories if the session has memory enabled (or always for now).
    # Guests have no account, so no memory.
    from ..models.memory import UserMemory
    user_memories = [] if is_guest else db.query(UserMemory).filter(
        UserMemory.user_id == current_user.id
    ).order_by(UserMemory.created_at.desc()).limit(20).all()
    if user_memories:
        mem_block = "\n".join(f"- {m.content}" for m in user_memories)
        memory_section = f"\n\n[User Memory — things you know about this user]\n{mem_block}"
        base_system_prompt = (base_system_prompt or "") + memory_section

    eff_top_p: Optional[float] = None
    if not is_guest:
        eff_traits = req.personality if req.personality is not None else current_user.ai_personality
        pspec = personality_engine.compose(eff_traits)
        if pspec["active"]:
            if pspec["system_fragment"]:
                base_system_prompt = (base_system_prompt or "") + "\n\n" + pspec["system_fragment"]
            if pspec["temperature"] is not None:
                eff_temp = pspec["temperature"]
            eff_top_p = pspec["top_p"]
            if pspec["max_tokens"] and req.max_tokens is None:
                eff_max = pspec["max_tokens"]

    # Build a derived request so _retrieve_kb_context sees the merged prompt.
    req_for_kb = req.model_copy(update={"system_prompt": base_system_prompt})
    system_prompt, citations = await _retrieve_kb_context(db, current_user, req_for_kb)

    if req.stream:
        async def generate():
            full_response = ""
            usage_info: Dict = {}
            try:
                if is_guest:
                    yield f"event: guest\ndata: {json.dumps({'remaining': guest_remaining, 'limit': GUEST_DAILY_TOKENS})}\n\n"
                if route_meta:
                    yield f"event: route\ndata: {json.dumps(route_meta)}\n\n"
                if citations:
                    yield f"event: citations\ndata: {json.dumps(citations)}\n\n"

                collected: Dict = {}
                if vid_prompt:
                    # Text-to-video short-circuit: stream a status note, generate
                    # via Pollinations, then stream the clip as a one-line markdown
                    # data URL (rendered as a <video> on the client). No newlines —
                    # the SSE framing splits on \n\n.
                    from .video import generate_video_data_url, VideoNotConfigured
                    status = f"🎬 Generating a video of *{vid_prompt}*… (this can take a minute) "
                    full_response += status
                    yield _sse_data(status)
                    try:
                        result = await generate_video_data_url(vid_prompt)
                        chunk = f"![{vid_prompt}]({result['data_url']})"
                    except VideoNotConfigured as exc:
                        chunk = f"⚠️ {exc}"
                    except Exception as exc:
                        chunk = f"⚠️ Video generation failed: {exc}"
                    full_response += chunk
                    yield _sse_data(chunk)
                elif img_prompt:
                    # Text-to-image short-circuit: stream a status note, generate
                    # via Pollinations, then stream the image as a one-line markdown
                    # data URL (no newlines — the SSE framing splits on \n\n).
                    from .image import generate_image_data_url
                    status = f"🎨 Generating an image of *{img_prompt}*… "
                    full_response += status
                    yield _sse_data(status)
                    try:
                        result = await generate_image_data_url(img_prompt)
                        chunk = f"![{img_prompt}]({result['data_url']})"
                    except Exception as exc:
                        chunk = f"⚠️ Image generation failed: {exc}"
                    full_response += chunk
                    yield _sse_data(chunk)
                elif req.cli_session_id:
                    # The ReAct loop runs the LLM on this (slow, CPU-only) server and
                    # emits nothing during each generation. Without keepalives,
                    # Cloudflare 524s the stream after ~100s and the agent appears to
                    # "do nothing" — so interleave pings like the normal chat path.
                    cli_agen = _cli_agent_stream(
                        messages=messages,
                        system_prompt=system_prompt,
                        model=eff_model,
                        cli_session_id=req.cli_session_id,
                        user_id=current_user.id,
                        collected=collected,
                    )
                    async for kind, value in _stream_with_keepalive(cli_agen, interval=15.0):
                        if kind == "ping":
                            yield ": keepalive\n\n"
                        else:
                            yield value
                    full_response = collected.get("text", "")
                else:
                    # Web search grounding: search the web for the user's question,
                    # inject the results into the system prompt, and surface them as
                    # citations. Emits a "searching" status so the UI can say so.
                    sys_for_llm = system_prompt
                    if req.web_search and _last_user.strip():
                        yield f"event: searching\ndata: {json.dumps({'query': _last_user[:120]})}\n\n"
                        try:
                            web_results = await web_search_svc.search_web(_last_user, max_results=WEB_MAX_RESULTS)
                        except Exception:
                            web_results = []
                        if web_results:
                            block = web_search_svc.format_context(web_results)
                            sys_for_llm = f"{system_prompt}\n\n{block}" if system_prompt else block
                            web_cites = [
                                {"index": i + 1, "chunk_id": f"web-{i}",
                                 "document_filename": (r["title"] or r["url"])[:80],
                                 "snippet": r["snippet"][:240], "url": r["url"]}
                                for i, r in enumerate(web_results)
                            ]
                            yield f"event: citations\ndata: {json.dumps(web_cites)}\n\n"
                            # Sources are now in the prompt; the model must "read" them
                            # (prefill) before answering — slow on CPU. Tell the UI so it
                            # can show a "Reading sources…" status instead of looking hung.
                            yield f"event: reading\ndata: {json.dumps({'sources': len(web_cites)})}\n\n"
                        else:
                            # Search ran but found nothing — tell the model that
                            # explicitly so it doesn't fall back to "I can't browse".
                            note = ("(A live web search was run for this question but returned no "
                                    "usable results. Answer from what you know and tell the user you "
                                    "couldn't retrieve current web sources — do not claim a knowledge cutoff.)")
                            sys_for_llm = f"{system_prompt}\n\n{note}" if system_prompt else note
                    # Warn the UI if the model must cold-load (slow on this CPU-only
                    # box) and keep the connection alive past Cloudflare's ~100s 524
                    # window until the first token arrives. For web search we already
                    # show a "Reading sources… (timer)" status, so skip the warming
                    # banner there (it would otherwise mask that more useful label).
                    if not web_active and not await ollama.is_loaded(eff_model):
                        # Report the user-facing model (the variant the user picked),
                        # not the concrete base — raw model names are admin-only.
                        yield f"event: warming\ndata: {json.dumps({'model': req.model})}\n\n"
                    # Signal a reasoning turn up front so the UI can show the Thought
                    # bubble immediately — on CPU the first <think> token can be 1-2 min
                    # away (prefill), and waiting for it left the drawer hidden.
                    if not web_active and _reasoning_active:
                        yield f"event: reasoning\ndata: {json.dumps({'active': True})}\n\n"
                    agen = ollama.chat_stream(
                        eff_model, messages, sys_for_llm, eff_temp, eff_max, eff_ctx,
                        images=images, usage=usage_info, think=eff_think, top_p=eff_top_p,
                        extra_options=req.ollama_options,
                    )
                    async for kind, value in _stream_with_keepalive(agen):
                        if kind == "ping":
                            yield ": keepalive\n\n"
                        else:
                            full_response += value
                            yield _sse_data(value)
            finally:
                latency = int((time.time() - start) * 1000)
                prompt_tok = usage_info.get("prompt_tokens", 0)
                completion_tok = usage_info.get("completion_tokens", 0)
                if session:
                    if req.regenerate:
                        # Re-rolling the last answer: the user turn is already saved,
                        # so drop the previous assistant message instead of appending
                        # the user message again (which duplicated it in history).
                        prev = db.query(ChatMessage).filter(
                            ChatMessage.session_id == session.id,
                            ChatMessage.role == "assistant",
                        ).order_by(ChatMessage.id.desc()).first()
                        if prev:
                            db.delete(prev)
                    else:
                        last_user_msg = next((m for m in reversed(req.messages) if m.role == "user"), None)
                        if last_user_msg:
                            db.add(ChatMessage(session_id=session.id, role="user", content=last_user_msg.content))
                    db.add(ChatMessage(
                        session_id=session.id, role="assistant", content=full_response,
                        latency_ms=latency,
                        tokens_used=(prompt_tok + completion_tok) or None,
                        steps=(collected.get("steps") or None),
                    ))
                    session.updated_at = datetime.now(timezone.utc)
                    db.commit()
                if not is_guest:
                    log_request(db, current_user.id, "/chat/completions", "POST", 200,
                                model_name=req.model, latency_ms=latency,
                                prompt_tokens=prompt_tok, completion_tokens=completion_tok)
                if is_guest and guest_ip:
                    # New local (not the closure var) — assigning guest_remaining
                    # inside generate() would shadow the earlier read above.
                    rem = _guest_charge_tokens(guest_ip, prompt_tok + completion_tok)
                    yield f"event: guest\ndata: {json.dumps({'remaining': rem, 'limit': GUEST_DAILY_TOKENS})}\n\n"
                if usage_info:
                    yield f"event: usage\ndata: {json.dumps({'prompt_tokens': prompt_tok, 'completion_tokens': completion_tok, 'latency_ms': latency})}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Content-Encoding": "identity", "Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Non-streaming
    full_response = ""
    if vid_prompt:
        from .video import generate_video_data_url, VideoNotConfigured
        try:
            result = await generate_video_data_url(vid_prompt)
            full_response = f"🎬 Generating a video of *{vid_prompt}*… ![{vid_prompt}]({result['data_url']})"
        except VideoNotConfigured as exc:
            full_response = f"⚠️ {exc}"
        except Exception as exc:
            full_response = f"⚠️ Video generation failed: {exc}"
    elif img_prompt:
        from .image import generate_image_data_url
        try:
            result = await generate_image_data_url(img_prompt)
            full_response = f"🎨 Generating an image of *{img_prompt}*… ![{img_prompt}]({result['data_url']})"
        except Exception as exc:
            full_response = f"⚠️ Image generation failed: {exc}"
    else:
        ns_usage: Dict = {}
        async for chunk in ollama.chat_stream(eff_model, messages, system_prompt, eff_temp, eff_max, eff_ctx, think=eff_think, usage=ns_usage, top_p=eff_top_p, extra_options=req.ollama_options):
            full_response += chunk
        if is_guest and guest_ip:
            guest_remaining = _guest_charge_tokens(
                guest_ip, ns_usage.get("prompt_tokens", 0) + ns_usage.get("completion_tokens", 0)
            )

    latency = int((time.time() - start) * 1000)
    if not is_guest:
        log_request(db, current_user.id, "/chat/completions", "POST", 200, model_name=req.model, latency_ms=latency)
    return {
        "content": full_response,
        "model": req.model,
        "latency_ms": latency,
        "citations": citations,
        "route": route_meta,
        "guest_remaining": guest_remaining,
    }


@router.get("/sessions", response_model=List[ChatSessionOut])
def list_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(ChatSession).filter(ChatSession.user_id == current_user.id).order_by(ChatSession.updated_at.desc()).all()


def _snippet(content: str, query: str, radius: int = 60) -> str:
    """Return a short excerpt of `content` centred on the first match of `query`."""
    lo = content.lower().find(query.lower())
    if lo < 0:
        return content[: radius * 2].strip()
    start = max(0, lo - radius)
    end = min(len(content), lo + len(query) + radius)
    out = content[start:end].strip()
    if start > 0:
        out = "…" + out
    if end < len(content):
        out = out + "…"
    return out


@router.get("/sessions/search")
def search_sessions(
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Full-text-ish search across the current user's chats — matches both the
    session title and message content, returning a snippet for each hit."""
    q = (q or "").strip()
    if len(q) < 2:
        return []

    like = f"%{q}%"
    # Sessions whose title OR any message content matches.
    rows = (
        db.query(ChatMessage, ChatSession)
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .filter(
            ChatSession.user_id == current_user.id,
            ChatMessage.content.ilike(like),
        )
        .order_by(ChatSession.updated_at.desc(), ChatMessage.id.asc())
        .limit(400)
        .all()
    )

    results: Dict[int, dict] = {}
    for msg, sess in rows:
        entry = results.get(sess.id)
        if entry is None:
            results[sess.id] = {
                "id": sess.id,
                "title": sess.title,
                "model_name": sess.model_name,
                "updated_at": sess.updated_at,
                "match_count": 1,
                "snippet": _snippet(msg.content, q),
                "role": msg.role,
            }
        else:
            entry["match_count"] += 1

    # Also surface title-only matches (no message body hit).
    title_hits = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == current_user.id, ChatSession.title.ilike(like))
        .order_by(ChatSession.updated_at.desc())
        .limit(100)
        .all()
    )
    for sess in title_hits:
        if sess.id not in results:
            results[sess.id] = {
                "id": sess.id,
                "title": sess.title,
                "model_name": sess.model_name,
                "updated_at": sess.updated_at,
                "match_count": 0,
                "snippet": "",
                "role": None,
            }

    return sorted(results.values(), key=lambda r: r["updated_at"], reverse=True)


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

    # Titles are throwaway — always use a small fast model (never make deepseek
    # reason about a 5-word title). Falls back to any available model.
    candidate = model_router.fast_model_for(list(available)) or next(iter(available))

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


@router.post("/greeting")
async def generate_greeting(
    request: Request,
    current_user: Optional[User] = Depends(get_optional_user),
):
    prompt = (
        "Generate exactly one short welcome greeting for the AI assistant NebulaX. "
        "One sentence only. Warm, unique, creative. Vary it each time. "
        "Do not include multiple options or any extra text — just the single greeting."
    )

    try:
        greeting = await ollama.generate(
            model="llama3.2:3b",
            prompt=prompt,
            temperature=0.8,
        )
        greeting = greeting.strip().strip('"').strip("'")
        # Take only the first sentence if the model still gives multiple
        idx = greeting.find('.')
        if idx != -1:
            greeting = greeting[:idx+1]
        greeting = greeting.strip()
        if not greeting:
            greeting = "What can I help with?"
    except Exception:
        greeting = "What can I help with?"

    return {"greeting": greeting}
