import asyncio
import base64
import io
import json
import os
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
from ..models.model import AIModel
from ..models.chat import ChatSession, ChatMessage, RequestLog
from ..schemas.chat import (
    ChatRequest, ChatSessionCreate, ChatSessionOut, ChatMessageOut, ImageIntentIn,
)
from ..services.ollama_service import ollama
from ..services import model_router
from ..services import web_search as web_search_svc
from ..core import personality as personality_engine

router = APIRouter(prefix="/chat", tags=["chat"])

# ── Guest (unauthenticated) chat ──────────────────────────────────────────
# Visitors can try the chat before signing up: unlimited messages, but a soft
# per-IP daily *token* budget, with all account-bound features (history, memory,
# attachments, media gen) disabled. Usage is tallied in-memory (single
# uvicorn process) and resets at UTC midnight — a deliberately lightweight gate,
# not a hard security boundary. Tokens are charged after each reply, so the
# message that crosses the budget still completes; the next one is blocked.
GUEST_DAILY_TOKENS = int(os.getenv("GUEST_DAILY_TOKENS", "5000"))
GUEST_DEFAULT_MODEL = os.getenv("GUEST_DEFAULT_MODEL", "hex-5.1-prime")

# Context window / output budget. Ollama defaults to a tiny 2048-token context,
# which truncates long prompts and — most visibly — reasoning models' chain-of-
# thought ("runs out of space to think"). Give chat a roomier window, and even
# more room plus a higher output cap for reasoning models. Env-overridable.
CHAT_NUM_CTX = int(os.getenv("CHAT_NUM_CTX", "8192"))
REASON_NUM_CTX = int(os.getenv("CHAT_REASON_NUM_CTX", "16384"))
REASON_MIN_PREDICT = int(os.getenv("CHAT_REASON_MAX_TOKENS", "8192"))

# ── Web search grounding ─────────────────────────────────────────────────────
# CPU prefill on this box is ~2 tok/s, so the sources we inject dominate
# latency — a big context = minutes of "reading" before the first answer token.
# Keep the injected set small, route synthesis to a fast small model (extractive
# Q&A doesn't need a big one), and cap the answer length. All env-tunable.
WEB_MAX_RESULTS = int(os.getenv("WEB_SEARCH_MAX_RESULTS", "3"))
WEB_MAX_PREDICT = int(os.getenv("WEB_SEARCH_MAX_TOKENS", "600"))
WEB_FAST_MODEL = os.getenv("WEB_SEARCH_MODEL", "")  # "" → pick the router's fast model
_guest_usage: Dict[str, Tuple[str, int]] = {}  # ip -> (utc_date, tokens_used_today)


def _client_ip(request: Request) -> str:
    """Real client IP, honoring the nginx/cloudflared headers.

    Prefers X-Real-IP (set by nginx from the socket peer) over the
    X-Forwarded-For chain — a client can spoof its own entry in the chain
    (nginx appends to it with $proxy_add_x_forwarded_for), so the first entry
    is attacker-controlled. The LAST XFF entry is the one closest to us and,
    when only one hop appends, the same value nginx put in X-Real-IP.
    """
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[-1].strip()
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
# The Remote CLI feature has moved to the dev variant; chat no longer runs
# ReAct agent loops against a connected daemon.

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


async def _apply_router(req: ChatRequest):
    """If req.model is a hex-* variant, resolve it. Returns
    (effective_model, variant_system_prompt, temperature, num_ctx, num_predict, top_p, route_meta).
    For non-variant models, returns the request values unchanged with route_meta=None.
    """
    if not model_router.is_variant(req.model):
        return req.model, "", req.temperature, None, req.max_tokens, None, None

    last_user_msg = next((m for m in reversed(req.messages) if m.role == "user"), None)
    user_text = last_user_msg.content if last_user_msg else ""
    has_image = bool(req.attachment_base64 and req.attachment_type == "image")

    available = await ollama.list_models()
    available_names = [m["name"] for m in available]

    try:
        decision = model_router.route(req.model, user_text, available_names, has_image)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    route_meta = {
        "variant": decision.variant_id,
        "chosen_model": decision.chosen_model,
        "reason": decision.reason,
    }
    if decision.routed_variant:
        route_meta["routed_variant"] = decision.routed_variant

    return (
        decision.chosen_model,
        decision.system_prompt,
        req.temperature if req.temperature is not None else decision.temperature,
        decision.num_ctx,
        decision.num_predict if req.max_tokens is None else req.max_tokens,
        decision.top_p,
        route_meta,
    )


def _resolve_hub_model(req: ChatRequest, db: Session, current_user: Optional[User]):
    """Model Hub models arrive as model='custom:<slug>'. Resolve the hub
    entry: swap in its base (variant or raw) for routing and return it so its
    system prompt can be appended. Public entries are usable by anyone;
    private ones only by their owner. None when the model isn't a hub id."""
    if not req.model.startswith("custom:"):
        return None
    slug = req.model[len("custom:"):]
    m = db.query(AIModel).filter(AIModel.slug == slug).first()
    if not m:
        raise HTTPException(status_code=404, detail="Model not found in the Model Hub")
    if not m.is_public and (not current_user or m.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="This model is private")
    if model_router.is_variant(m.base_model):
        req.model = m.base_model
    else:
        req.model = m.ollama_model_name or m.base_model
    return m


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
        req.web_search = False
        req.attachment_base64 = req.attachment_type = req.attachment_name = None

    # Model Hub models arrive as custom:<slug>; resolve the entry before any
    # model gating so its base is what the gates evaluate (public entries are
    # usable by anyone; private ones only by their owner).
    custom_model = _resolve_hub_model(req, db, current_user)

    if is_guest:
        # Don't let a guest hand-pick an arbitrary/expensive direct model.
        if not model_router.is_variant(req.model):
            req.model = GUEST_DEFAULT_MODEL

    # Raw (non-variant) Ollama models are a Hyper+ entitlement, matching the
    # gate enforced on /models/ollama/list and at API-key creation. Admins and
    # users whose plan grants raw_models pass; everyone else gets a clean error.
    if not is_guest and not model_router.is_variant(req.model):
        if not current_user.is_admin:
            from ..services.billing_enforcement import get_user_limits
            if not get_user_limits(db, current_user).get("raw_models"):
                raise HTTPException(
                    status_code=403,
                    detail="Direct model access is available on the Hyper plan and above. " 
                           "Pick a HexaLLM model instead.",
                )

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

    # Route hex-* variants → concrete Ollama model + variant params.
    eff_model, variant_prompt, eff_temp, eff_ctx, eff_max, routed_top_p, route_meta = await _apply_router(req)

    # Route hex-* variants → concrete Ollama model + variant params.

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
    # reasoner (deepseek-r1:1.5b → HexaLLM Reason), where <think> streams in seconds.
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

    # In-chat text-to-image: "generate an image of …" works
    # in ANY chat. Skip when an image is attached (that's a vision query).
    img_prompt = None
    if not images and not is_guest:
        img_prompt = model_router.detect_image_request(_last_user)

    user_supplied_prompt = req.system_prompt

    base_system_prompt = model_router.merge_system_prompt(variant_prompt, user_supplied_prompt)
    if custom_model and custom_model.system_prompt:
        hub_block = f"[Model Hub — {custom_model.name}]\n{custom_model.system_prompt}"
        base_system_prompt = (base_system_prompt + "\n\n" + hub_block) if base_system_prompt else hub_block
        if not is_guest and custom_model.owner_id != current_user.id:
            custom_model.downloads = (custom_model.downloads or 0) + 1
            db.commit()
    # Personal AI preferences (Settings → AI Assistant): the user's custom
    # instructions apply to every one of their chats. Guests have no account.
    if not is_guest and (current_user.ai_instructions or "").strip():
        ci = current_user.ai_instructions.strip()
        base_system_prompt = (base_system_prompt or "") + f"\n\n[User's custom instructions — follow these]\n{ci}"
    # Identity block: the model learns who it's talking to (name + optional bio)
    # so replies and greetings feel personal. Guests have no account.
    if not is_guest:
        user_name = (current_user.full_name or "").strip() or (current_user.username or "").strip()
        if user_name:
            identity_block = f"\n\n[User profile — who you're talking to]\nName: {user_name}"
            bio = (current_user.bio or "").strip()
            if bio:
                identity_block += f"\nAbout: {bio[:200]}"
            base_system_prompt = (base_system_prompt or "") + identity_block
    # Inject user memories — manual (user-curated) facts first, then auto ones.
    # Guests have no account, so no memory.
    from ..models.memory import UserMemory
    user_memories = [] if is_guest else db.query(UserMemory).filter(
        UserMemory.user_id == current_user.id
    ).order_by(UserMemory.source == "manual", UserMemory.created_at.desc()).limit(30).all()
    if user_memories:
        mem_block = "\n".join(f"- {m.content}" for m in user_memories)
        memory_section = f"\n\n[User Memory — things you know about this user]\n{mem_block}"
        base_system_prompt = (base_system_prompt or "") + memory_section

    # top_p: the request's own value wins, else the Personality Engine's,
    # else the routed variant's default (admin-overridable via Model Settings).
    eff_top_p: Optional[float] = req.top_p if req.top_p is not None else routed_top_p
    if not is_guest:
        eff_traits = req.personality if req.personality is not None else current_user.ai_personality
        pspec = personality_engine.compose(eff_traits)
        if pspec["active"]:
            if pspec["system_fragment"]:
                base_system_prompt = (base_system_prompt or "") + "\n\n" + pspec["system_fragment"]
            if pspec["temperature"] is not None:
                eff_temp = pspec["temperature"]
            if req.top_p is None:
                eff_top_p = pspec["top_p"]
            if pspec["max_tokens"] and req.max_tokens is None:
                eff_max = pspec["max_tokens"]

    # KB RAG was a dev-variant feature; prod chat grounds only on live web search.
    system_prompt = base_system_prompt
    citations: list = []

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

                if img_prompt:
                    # Text-to-image short-circuit: stream a status note, then stream
                    # the image as a one-line markdown data URL (no newlines — the
                    # SSE framing splits on \n\n). If the client already generated
                    # the image locally (Puter), use that data URL; otherwise fall
                    # back to the server-side Stability AI engine.
                    status = f"🎨 Generating an image of *{img_prompt}*… "
                    full_response += status
                    yield _sse_data(status)
                    try:
                        if req.image_result_base64 and req.image_result_base64.startswith("data:image/"):
                            result = {"data_url": req.image_result_base64}
                        else:
                            from .image import generate_image_data_url
                            result = await generate_image_data_url(img_prompt)
                        chunk = f"![{img_prompt}]({result['data_url']})"
                    except Exception as exc:
                        chunk = f"⚠️ Image generation failed: {exc}"
                    full_response += chunk
                    yield _sse_data(chunk)
                else:
                    # Web search grounding: search the web for the user's question,
                    # inject the results into the system prompt, and surface them as
                    # citations. Emits a "searching" status so the UI can say so.
                    sys_for_llm = system_prompt
                    # web_active already excludes guests and image attachments,
                    # so web search only runs where the fast-model routing applies.
                    if web_active and _last_user.strip():
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
                        extra_options=req.ollama_options, format=req.response_format,
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
                try:
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
                        ))
                        session.updated_at = datetime.now(timezone.utc)
                        db.commit()
                        # Fully automatic memory: after each substantive exchange,
                        # extract durable facts about the user in the background
                        # (capped + deduped). Throttled to one pass per session per
                        # 5 minutes so chit-chat doesn't hammer the fast model.
                        if not is_guest and not img_prompt:
                            try:
                                from ..models.memory import UserMemory as _UM
                                recent_mem = db.query(_UM).filter(
                                    _UM.user_id == current_user.id, _UM.session_id == session.id
                                ).order_by(_UM.created_at.desc()).first()
                                throttle = (
                                    recent_mem
                                    and (datetime.now(timezone.utc) - recent_mem.created_at).total_seconds() < 300
                                )
                                last_user_txt = next(
                                    (m.content for m in reversed(req.messages) if m.role == "user"), ""
                                )
                                if not throttle and len(last_user_txt.strip()) >= 40:
                                    turns = [
                                        {"role": m.role, "content": m.content}
                                        for m in req.messages[-6:]
                                    ]
                                    turns.append({"role": "assistant", "content": full_response[:2000]})
                                    from ..services.memory_service import run_auto_extract
                                    asyncio.create_task(run_auto_extract(current_user.id, turns, session.id))
                            except Exception:
                                pass
                except Exception:
                    # A save failure must never truncate the user's stream — the
                    # conversation still answered; persistence can retry next time.
                    pass
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
    if img_prompt:
        from .image import generate_image_data_url
        try:
            if req.image_result_base64 and req.image_result_base64.startswith("data:image/"):
                data_url = req.image_result_base64
            else:
                data_url = (await generate_image_data_url(img_prompt))["data_url"]
            full_response = f"🎨 Generating an image of *{img_prompt}*… ![{img_prompt}]({data_url})"
        except Exception as exc:
            full_response = f"⚠️ Image generation failed: {exc}"
    else:
        # Web search grounding (mirrors the streaming branch): search, inject
        # into the system prompt, and populate citations for the response.
        ns_sys = system_prompt
        if web_active and _last_user.strip():
            try:
                web_results = await web_search_svc.search_web(_last_user, max_results=WEB_MAX_RESULTS)
            except Exception:
                web_results = []
            if web_results:
                block = web_search_svc.format_context(web_results)
                ns_sys = f"{system_prompt}\n\n{block}" if system_prompt else block
                citations = [
                    {"index": i + 1, "chunk_id": f"web-{i}",
                     "document_filename": (r["title"] or r["url"])[:80],
                     "snippet": r["snippet"][:240], "url": r["url"]}
                    for i, r in enumerate(web_results)
                ]
            else:
                note = ("(A live web search was run for this question but returned no "
                        "usable results. Answer from what you know and tell the user you "
                        "couldn't retrieve current web sources — do not claim a knowledge cutoff.)")
                ns_sys = f"{system_prompt}\n\n{note}" if system_prompt else note
        ns_usage: Dict = {}
        async for chunk in ollama.chat_stream(eff_model, messages, ns_sys, eff_temp, eff_max, eff_ctx, think=eff_think, usage=ns_usage, top_p=eff_top_p, extra_options=req.ollama_options, format=req.response_format):
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


@router.post("/image-intent")
def detect_image_intent(payload: ImageIntentIn, current_user: User = Depends(get_current_user)):
    """Tell the client whether this message is a text-to-image request (and with
    which prompt), so it can generate the image client-side with Puter before
    streaming the chat reply."""
    return {"prompt": model_router.detect_image_request(payload.text or "")}


DEFAULT_SUGGESTIONS = [
    "Explain a complex topic simply",
    "Help me write or debug code",
    "Summarize an article or document",
    "Brainstorm ideas for a project",
]


@router.post("/suggestions")
async def generate_suggestions(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """Personalized chat starter prompts — a mix of "continue where you left off"
    and "start something new", grounded in the user's memories and recent chats.
    Guests (and users with no history) get the static defaults."""
    if not current_user:
        return {"suggestions": DEFAULT_SUGGESTIONS, "personalized": False}
    user_name = (current_user.full_name or "").strip() or (current_user.username or "").strip()
    from ..models.memory import UserMemory
    mems = (
        db.query(UserMemory)
        .filter(UserMemory.user_id == current_user.id)
        .order_by(UserMemory.source == "manual", UserMemory.created_at.desc())
        .limit(8)
        .all()
    )
    titles = [
        s.title
        for s in db.query(ChatSession)
        .filter(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc())
        .limit(5)
        .all()
        if s.title and s.title != "New Chat"
    ]

    bits: List[str] = []
    if user_name:
        hour = datetime.now().astimezone().hour
        phase = "morning" if hour < 12 else "afternoon" if hour < 18 else "evening"
        bits.append(f"the user is named {user_name}, it is {phase} for them")
    if mems:
        bits.append("things you know about them: " + "; ".join(m.content for m in mems)[:400])
    if titles:
        bits.append("their recent chats: " + "; ".join(f'"{t[:60]}"' for t in titles)[:300])
    context = " ".join(bits)

    system = (
        "You are a helpful assistant suggesting the next things a user could ask their AI. "
        "Propose exactly FOUR short chat starter prompts, written in the first person "
        "('I'/'my'), as if the user would type them. Mix roughly two that CONTINUE their "
        "ongoing work or interests and two that start something NEW they'd likely enjoy, "
        "based on the context. Keep each under 12 words. Output only the four prompts, "
        "one per line, no numbering, no bullets, no extra text."
    )
    from ..services.ollama_service import ollama
    avail = [m["name"] for m in await ollama.list_models()]
    fast = model_router.fast_model_for(avail) or "qwen2.5:7b"
    raw = ""
    async for chunk in ollama.chat_stream(
        fast,
        [{"role": "user", "content": f"Context about the user: {context}"}],
        system_prompt=system,
        temperature=0.8,
    ):
        raw += chunk

    parsed: List[str] = []
    for line in raw.splitlines():
        line = line.strip().lstrip("-•*0123456789). ").strip()
        if 8 <= len(line) <= 100 and line not in parsed:
            parsed.append(line)
        if len(parsed) == 4:
            break
    if len(parsed) < 2:
        return {"suggestions": DEFAULT_SUGGESTIONS, "personalized": False}
    return {"suggestions": parsed, "personalized": True}



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
    # Erasing a chat also erases the facts it auto-learned about the user —
    # conversation-level memory dies with the conversation. Manually pinned
    # memories (source="manual") are user-curated and always survive.
    from ..models.memory import UserMemory
    db.query(UserMemory).filter(
        UserMemory.user_id == current_user.id,
        UserMemory.session_id == session.id,
        UserMemory.source == "auto",
    ).delete(synchronize_session=False)
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
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    # Personalize for logged-in users: name, time of day, memories, last chat.
    user_name = None
    phase = None
    context = ""
    continue_session = None
    if current_user:
        user_name = (current_user.full_name or "").strip() or (current_user.username or "").strip() or "there"
        hour = datetime.now().astimezone().hour
        phase = "morning" if hour < 12 else "afternoon" if hour < 18 else "evening"
        bits = [f"address the user as {user_name}", f"it is {phase} for them"]
        from ..models.memory import UserMemory
        mems = (
            db.query(UserMemory)
            .filter(UserMemory.user_id == current_user.id)
            .order_by(UserMemory.source == "manual", UserMemory.created_at.desc())
            .limit(4)
            .all()
        )
        if mems:
            bits.append("you know these things about them: " + "; ".join(m.content for m in mems)[:300])
        last_session = (
            db.query(ChatSession)
            .filter(ChatSession.user_id == current_user.id)
            .order_by(ChatSession.updated_at.desc())
            .first()
        )
        if last_session and last_session.title and last_session.title != "New Chat":
            bits.append(f"their most recent chat was '{last_session.title[:80]}'")
            continue_session = {"id": last_session.id, "title": last_session.title[:80]}
        context = "Context for the greeting: " + "; ".join(bits) + ". "

    prompt = (
        f"{context}"
        "Write exactly one short warm welcome greeting from the AI assistant HexaLLM, "
        "addressed to the user by name, lightly referencing the given context if it fits "
        "naturally (do not force it). "
    )
    if continue_session:
        prompt += (
            "The user has an ongoing chat they may want to continue — warmly invite them "
            "to pick up where they left off, mentioning its title. "
        )
    prompt += (
        "One sentence only. Warm, unique, creative. "
        "No extra text or options."
    )

    try:
        greeting = await ollama.generate(
            model="qwen2.5:7b",
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

    # Deterministic fallback when the model is unavailable — still personal.
    if greeting == "What can I help with?" and current_user and user_name and phase:
        if continue_session:
            greeting = f"Good {phase}, {user_name}! Ready to pick up '{continue_session['title']}' — or start something new?"
        else:
            greeting = f"Good {phase}, {user_name}! What can I help with?"

    return {"greeting": greeting, "continue_session": continue_session}
