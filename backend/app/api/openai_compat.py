"""OpenAI-compatible /v1/chat/completions endpoint.

Allows any OpenAI client to point at NebulaX and use local Ollama models.
"""
import json
import time
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from ..core.security import get_api_key_user
from ..models.user import User
from ..services.ollama_service import ollama

router = APIRouter(prefix="/openai", tags=["openai-compat"])


class OAIMessage(BaseModel):
    role: str
    content: str


class OAIChatRequest(BaseModel):
    model: str
    messages: List[OAIMessage]
    stream: bool = False
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = None
    system: Optional[str] = None


@router.post("/chat/completions")
async def chat_completions(
    req: OAIChatRequest,
    current_user: User = Depends(get_api_key_user),
):
    system_prompt = req.system or ""
    # Extract system message from messages array if present
    messages = []
    for m in req.messages:
        if m.role == "system" and not system_prompt:
            system_prompt = m.content
        else:
            messages.append({"role": m.role, "content": m.content})

    request_id = f"chatcmpl-{uuid.uuid4().hex[:16]}"
    created = int(time.time())

    if req.stream:
        async def stream_gen():
            async for chunk in ollama.chat_stream(
                req.model, messages,
                system_prompt=system_prompt,
                temperature=req.temperature or 0.7,
            ):
                delta = {
                    "id": request_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": req.model,
                    "choices": [{"index": 0, "delta": {"content": chunk}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(delta)}\n\n"
            done = {
                "id": request_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": req.model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(done)}\n\ndata: [DONE]\n\n"

        # Content-Encoding: identity bypasses the GZipMiddleware (which otherwise
        # buffers the entire SSE stream in the zlib compressor until the model
        # finishes, causing Cloudflare 524 timeouts on long responses).
        return StreamingResponse(
            stream_gen(),
            media_type="text/event-stream",
            headers={
                "Content-Encoding": "identity",
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    # Non-streaming
    full = ""
    async for chunk in ollama.chat_stream(
        req.model, messages,
        system_prompt=system_prompt,
        temperature=req.temperature or 0.7,
    ):
        full += chunk

    prompt_tokens = sum(len(m.content.split()) for m in req.messages)
    completion_tokens = len(full.split())

    return {
        "id": request_id,
        "object": "chat.completion",
        "created": created,
        "model": req.model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": full},
            "finish_reason": "stop",
        }],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }
