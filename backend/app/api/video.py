"""Server-side video generation.

Puter remains the default client-side provider. This module adds a server-side
Pollinations provider when POLLINATIONS_API_KEY is configured, so the app is
not solely dependent on the Puter browser flow.
"""
from __future__ import annotations

import base64
import urllib.parse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..core.config import settings
from ..core.security import get_current_user
from ..models.user import User

router = APIRouter(prefix="/video", tags=["video"])

POLLINATIONS_VIDEO_MODELS = {
    "pollinations-veo": "google/veo-3.1-fast",
    "pollinations-seedance": "bytedance/seedance-2.0-fast",
    "pollinations-wan": "alibaba/wan-2.6",
}


class VideoRequest(BaseModel):
    prompt: str
    model: str = "pollinations-veo"
    seconds: int = 4
    size: str = "1280x720"


@router.get("/models")
async def list_video_models(current_user: User = Depends(get_current_user)):
    available = bool(settings.POLLINATIONS_API_KEY)
    return {
        "pollinations": [
            {"id": k, "name": v, "available": available}
            for k, v in POLLINATIONS_VIDEO_MODELS.items()
        ],
        "puter": True,
    }


@router.post("/generate")
async def generate_video(
    req: VideoRequest,
    current_user: User = Depends(get_current_user),
):
    if req.model not in POLLINATIONS_VIDEO_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model '{req.model}'")
    api_key = settings.POLLINATIONS_API_KEY
    if not api_key:
        raise HTTPException(status_code=503, detail="Pollinations API key not configured")

    upstream_model = POLLINATIONS_VIDEO_MODELS[req.model]
    try:
        width, height = (int(x) for x in req.size.split("x", 1))
    except Exception:
        width, height = 1280, 720

    url = (
        "https://gen.pollinations.ai/video/"
        + urllib.parse.quote(req.prompt, safe="")
        + f"?model={urllib.parse.quote(upstream_model, safe='')}"
        + f"&duration={max(1, min(req.seconds, 15))}"
        + f"&width={width}&height={height}"
    )

    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Pollinations: {resp.text[:300]}")

    content_type = resp.headers.get("content-type", "video/mp4").split(";")[0]
    b64 = base64.b64encode(resp.content).decode()
    return {
        "url": f"data:{content_type};base64,{b64}",
        "provider": "pollinations",
        "model": req.model,
    }
