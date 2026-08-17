"""OpenAI-compatible API ("Expose as API").

Any OpenAI client can point at HexaLLM and talk to a local model. Authenticate
with a HexaLLM API key (nai_…). A key may be *bound* to a saved persona, in
which case callers automatically get that persona's model, system prompt and
temperature — the "Expose as API" toggle — without knowing any of it.

Mounted at both `/v1` (clean OpenAI base_url) and `/api/v1/openai` (back-compat).
Every call meters real token usage against the key and the platform usage ledger.
"""
import json
import time
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.database import get_db, SessionLocal
from ..core.security import get_api_key_record
from ..core import personality as personality_engine
from ..models.user import APIKey
from ..models.chat import RequestLog
from ..services.ollama_service import ollama
from ..services import model_router

router = APIRouter(tags=["openai-compat"])


class OAIMessage(BaseModel):
    role: str
    content: str


class OAIStreamOptions(BaseModel):
    include_usage: bool = False


class OAIChatRequest(BaseModel):
    model: Optional[str] = None
    messages: List[OAIMessage]
    stream: bool = False
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    system: Optional[str] = None
    stream_options: Optional[OAIStreamOptions] = None
    personality: Optional[Dict[str, int]] = None
    # Structured output (OpenAI-style): {"type": "json_object"} or
    # {"type": "json_schema", "json_schema": {...}}. vLLM additionally accepts
    # {"type": "regex", "regex": "..."}.
    response_format: Optional[Dict] = None


def _resolve(key: APIKey, req: OAIChatRequest,
             base_temperature: Optional[float] = None,
             base_top_p: Optional[float] = None,
             base_max: Optional[int] = None):
    """Work out the served model, system prompt, sampling and personality for
    this call. Personality precedence: the key's persona binding, else a
    per-request `personality` override, else the key owner's saved sliders —
    so CLI/daemon calls with a plain key still carry the user's voice.

    Sampling precedence: per-key overrides (pinned at key creation, they win
    over everything) → the request's own values → the personality engine →
    the persona's saved temperature → the routed variant's defaults."""
    persona = key.persona if key.persona_id else None

    # Served model: persona's snapshot, else the key's raw model, else caller's.
    model = key.model_name or (persona.base_model if persona else None) or req.model
    if not model:
        raise HTTPException(
            status_code=400,
            detail="No model specified. This key isn't bound to a model, so include a 'model' field.",
        )

    # Model Hub models arrive as model='custom:<slug>': resolve the entry,
    # swap in its base (variant or raw) for routing, and remember it so its
    # system prompt is appended below. Public entries work for any key owner;
    # private ones only for the owner. Key-bound models still win over a
    # caller-supplied custom id (the binding above takes precedence).
    hub_model = None
    hub_name = None
    hub_prompt = None
    if req.model and req.model.startswith("custom:") and not (key.model_name or (persona.base_model if persona else None)):
        from ..core.database import SessionLocal
        from ..models.model import AIModel
        scope_db = SessionLocal()
        try:
            m = scope_db.query(AIModel).filter(
                AIModel.slug == req.model[len("custom:"):]
            ).first()
            if not m:
                raise HTTPException(status_code=404, detail="Model not found in the Model Hub")
            if not m.is_public and (not key.user or m.owner_id != key.user_id):
                raise HTTPException(status_code=403, detail="This model is private")
            req.model = m.base_model if model_router.is_variant(m.base_model) else (m.ollama_model_name or m.base_model)
            hub_name = m.name
            hub_prompt = m.system_prompt
            if key.user and m.owner_id != key.user_id:
                m.downloads = (m.downloads or 0) + 1
                scope_db.commit()
        finally:
            scope_db.close()
        model = req.model

    # Raw (non-variant) model ids are a Hyper+ entitlement. Keys are always
    # bound to a variant or persona unless the owner is admin/Hyper+, so a
    # caller-supplied raw model on an unbound key is never honored for
    # non-entitled users (mirrors the chat endpoint and ollama_list gate).
    if not model_router.is_variant(model) and key.user and not key.user.is_admin:
        owner_plan_ok = False
        from ..core.database import SessionLocal
        from ..services.billing_enforcement import get_user_limits
        scope_db = SessionLocal()
        try:
            owner_plan_ok = bool(get_user_limits(scope_db, key.user).get("raw_models"))
        finally:
            scope_db.close()
        if not owner_plan_ok:
            raise HTTPException(
                status_code=403,
                detail="Direct model access is available on the Hyper plan and above.",
            )

    # System prompt: persona identity first, then any caller system text.
    system_parts: List[str] = []
    if persona and persona.system_prompt:
        system_parts.append(persona.system_prompt)
    convo: List[Dict] = []
    for m in req.messages:
        if m.role == "system":
            system_parts.append(m.content)
        else:
            convo.append({"role": m.role, "content": m.content})
    if req.system:
        system_parts.append(req.system)
    if hub_prompt:
        system_parts.append(f"[Model Hub — {hub_name}]\n{hub_prompt}")
    system_prompt = "\n\n".join(p for p in system_parts if p)

    # Personality Engine sliders: persona binding → per-request override →
    # the key owner's saved default. The fragment + sampling reach the model
    # only when the engine is active (any trait moved ≥8 from neutral).
    traits = None
    if persona:
        traits = persona.personality
    elif req.personality is not None:
        traits = req.personality
    elif key.user:
        traits = key.user.ai_personality
    pspec = personality_engine.compose(traits)
    if pspec.get("active") and pspec["system_fragment"]:
        system_prompt = (system_prompt + "\n\n" + pspec["system_fragment"]) if system_prompt else pspec["system_fragment"]

    # Per-key sampling overrides win over everything (pinned at key creation);
    # then the request's own values; then the personality engine; then the
    # persona's saved temperature; then the routed variant's defaults.
    if key.temperature is not None:
        temperature = key.temperature
    elif req.temperature is not None:
        temperature = req.temperature
    elif pspec.get("active") and pspec.get("temperature") is not None:
        temperature = pspec["temperature"]
    elif persona and persona.temperature is not None:
        temperature = persona.temperature
    elif base_temperature is not None:
        temperature = base_temperature
    else:
        temperature = 0.7

    if key.top_p is not None:
        top_p = key.top_p
    elif req.top_p is not None:
        top_p = req.top_p
    elif pspec.get("active"):
        top_p = pspec["top_p"]
    else:
        top_p = base_top_p

    if key.max_tokens is not None:
        eff_max = key.max_tokens
    elif req.max_tokens is not None:
        eff_max = req.max_tokens
    elif pspec.get("active") and pspec.get("max_tokens"):
        eff_max = pspec["max_tokens"]
    elif base_max is not None:
        eff_max = base_max
    else:
        eff_max = None

    return model, system_prompt, temperature, top_p, eff_max, convo


def _meter(db: Session, key_id: int, user_id: int, model: str, usage: dict, latency_ms: int):
    """Record usage against the key and the platform ledger (RequestLog)."""
    pt = int((usage or {}).get("prompt_tokens", 0) or 0)
    ct = int((usage or {}).get("completion_tokens", 0) or 0)
    key = db.query(APIKey).filter(APIKey.id == key_id).first()
    if key:
        key.request_count = (key.request_count or 0) + 1
        key.prompt_tokens = (key.prompt_tokens or 0) + pt
        key.completion_tokens = (key.completion_tokens or 0) + ct
        key.last_used_at = datetime.now(timezone.utc)
    db.add(RequestLog(
        user_id=user_id, endpoint="/v1/chat/completions", method="POST",
        status_code=200, model_name=model, prompt_tokens=pt,
        completion_tokens=ct, latency_ms=latency_ms,
    ))
    db.commit()


@router.post("/chat/completions")
async def chat_completions(
    req: OAIChatRequest,
    key: APIKey = Depends(get_api_key_record),
    db: Session = Depends(get_db),
):
    model, system_prompt, temperature, top_p, eff_max, messages = _resolve(key, req)
    # `model` is the advertised id (may be a HexaLLM variant); resolve it to a
    # concrete Ollama model for the actual inference call. The route decision
    # also carries the variant's sampling defaults (incl. admin overrides).
    concrete = model
    decision = None
    if model_router.is_variant(model):
        try:
            avail = [m["name"] for m in await ollama.list_models()]
        except Exception:
            avail = []
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        decision = model_router.route(model, last_user, avail)
        concrete = decision.chosen_model
    request_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
    created = int(time.time())
    key_id, user_id = key.id, key.user_id
    started = time.monotonic()

    base_temp = decision.temperature if decision else None
    base_top = decision.top_p if decision else None
    base_max = decision.num_predict if decision else None
    num_ctx = decision.num_ctx if decision else None

    if req.stream:
        include_usage = bool(req.stream_options and req.stream_options.include_usage)

        async def stream_gen():
            usage: dict = {}
            try:
                async for chunk in ollama.chat_stream(
                    concrete, messages, system_prompt=system_prompt,
                    temperature=temperature, max_tokens=eff_max if eff_max is not None else req.max_tokens, usage=usage, top_p=top_p,
                    num_ctx=num_ctx, format=req.response_format,
                ):
                    delta = {
                        "id": request_id, "object": "chat.completion.chunk",
                        "created": created, "model": model,
                        "choices": [{"index": 0, "delta": {"content": chunk}, "finish_reason": None}],
                    }
                    yield f"data: {json.dumps(delta)}\n\n"
                done = {
                    "id": request_id, "object": "chat.completion.chunk",
                    "created": created, "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                if include_usage:
                    pt = int(usage.get("prompt_tokens", 0) or 0)
                    ct = int(usage.get("completion_tokens", 0) or 0)
                    done["usage"] = {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct}
                yield f"data: {json.dumps(done)}\n\n"
                yield "data: [DONE]\n\n"
            finally:
                # Meter even if the client disconnects mid-stream. Own session
                # because the request-scoped one is gone once streaming starts.
                meter_db = SessionLocal()
                try:
                    _meter(meter_db, key_id, user_id, model, usage,
                           int((time.monotonic() - started) * 1000))
                finally:
                    meter_db.close()

        # Content-Encoding: identity bypasses GZip buffering (Cloudflare 524 fix).
        return StreamingResponse(
            stream_gen(), media_type="text/event-stream",
            headers={"Content-Encoding": "identity", "Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Non-streaming
    usage: dict = {}
    full = ""
    async for chunk in ollama.chat_stream(
        concrete, messages, system_prompt=system_prompt,
        temperature=temperature, max_tokens=eff_max if eff_max is not None else req.max_tokens, usage=usage, top_p=top_p,
        num_ctx=num_ctx, format=req.response_format,
    ):
        full += chunk

    pt = int(usage.get("prompt_tokens", 0) or 0)
    ct = int(usage.get("completion_tokens", 0) or 0)
    _meter(db, key_id, user_id, model, usage, int((time.monotonic() - started) * 1000))

    return {
        "id": request_id, "object": "chat.completion", "created": created, "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": full}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct},
    }


@router.get("/models")
async def list_models(key: APIKey = Depends(get_api_key_record)):
    """OpenAI-style model list. A bound key advertises only its served model;
    an unbound key advertises the HexaLLM models (variants), never raw bases."""
    created = int(time.time())
    if key.model_name:
        names = [key.model_name]
    elif key.persona_id and key.persona:
        names = [key.persona.base_model]
    else:
        names = [v["id"] for v in model_router.public_variants()]
    return {
        "object": "list",
        "data": [{"id": n, "object": "model", "created": created, "owned_by": "hexallm"} for n in names],
    }
