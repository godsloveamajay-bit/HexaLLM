import random
import base64
import httpx
from math import gcd
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from ..core.security import get_current_user
from ..core.database import get_db
from ..core.config import settings
from ..models.user import User

router = APIRouter(prefix="/image", tags=["image"])

_OLLAMA_URL = "http://localhost:11434"
_ENHANCE_MODEL = "llama3.1:8b"

_ENHANCE_SYSTEM = (
    "You are an expert image prompt engineer. "
    "Rewrite the user's prompt into a richly detailed, vivid description for a text-to-image AI. "
    "Add specific details about lighting, composition, style, mood, and quality. "
    "Keep it under 120 words. Output ONLY the improved prompt — no explanations, no quotes."
)

STABILITY_MODELS = {
    "sd3-ultra": "Stable Diffusion 3.5 Ultra",
    "sd3-core": "Stable Diffusion 3.5 Core",
}

_ASPECT_RATIOS = {
    (16, 9): "16:9", (9, 16): "9:16",
    (3, 2): "3:2", (2, 3): "2:3",
    (4, 5): "4:5", (5, 4): "5:4",
    (21, 9): "21:9", (9, 21): "9:21",
    (1, 1): "1:1",
}


async def _enhance_prompt(prompt: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(f"{_OLLAMA_URL}/api/generate", json={
                "model": _ENHANCE_MODEL,
                "system": _ENHANCE_SYSTEM,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.7, "num_predict": 150},
            })
            r.raise_for_status()
            return r.json().get("response", prompt).strip()
    except Exception:
        return prompt


def _aspect_ratio_str(width: int, height: int) -> str:
    g = gcd(width, height)
    return _ASPECT_RATIOS.get((width // g, height // g), "1:1")


async def generate_image_data_url(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    seed: Optional[int] = None,
    model: str = "sd3-core",
    negative_prompt: str = "",
) -> dict:
    seed = seed if seed is not None else random.randint(1, 2**31)

    api_key = settings.STABILITY_API_KEY
    if not api_key:
        raise HTTPException(status_code=502, detail="Stability AI API key not configured")

    endpoint = "https://api.stability.ai/v2beta/stable-image/generate/" + \
        ("ultra" if model == "sd3-ultra" else "core")

    files = {
        "prompt": (None, prompt),
        "aspect_ratio": (None, _aspect_ratio_str(width, height)),
        "seed": (None, str(seed)),
        "output_format": (None, "png"),
    }
    if negative_prompt:
        files["negative_prompt"] = (None, negative_prompt)

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            endpoint,
            headers={
                "authorization": f"Bearer {api_key}",
                "accept": "image/*",
            },
            files=files,
        )
        if resp.status_code == 403:
            raise HTTPException(status_code=502, detail="Stability AI: invalid API key or insufficient credits")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Stability AI: {resp.text[:300]}")

    content_type = resp.headers.get("content-type", "image/png").split(";")[0]
    b64 = base64.b64encode(resp.content).decode()
    return {"data_url": f"data:{content_type};base64,{b64}", "seed": seed}


class ImageRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    seed: Optional[int] = None
    model: str = "sd3-core"
    enhance_prompt: bool = False


@router.post("/generate")
async def generate_image(
    req: ImageRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ..services.billing_enforcement import check_image_gen
    check_image_gen(db, current_user, client_ip=request.client.host if request.client else None)

    if req.model not in STABILITY_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model '{req.model}'")

    final_prompt = req.prompt
    if req.enhance_prompt:
        final_prompt = await _enhance_prompt(req.prompt)

    try:
        result = await generate_image_data_url(
            final_prompt,
            width=req.width,
            height=req.height,
            seed=req.seed,
            model=req.model,
            negative_prompt=req.negative_prompt,
        )
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Image generation timed out")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Image provider error: {exc}")

    return {
        "url": result["data_url"],
        "seed": result["seed"],
        "prompt": req.prompt,
        "enhanced_prompt": final_prompt if req.enhance_prompt else None,
        "provider": "stability",
    }


class EnhanceRequest(BaseModel):
    prompt: str


@router.post("/enhance")
async def enhance_prompt_only(req: EnhanceRequest, current_user: User = Depends(get_current_user)):
    """Rewrite a prompt with AI detail — used by client-side providers (Puter)
    that can't go through the Stability-only /image/generate path."""
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt required")
    enhanced = await _enhance_prompt(req.prompt.strip())
    return {"prompt": enhanced or req.prompt}


@router.get("/models")
async def list_image_models():
    return {
        "stability": [{"id": k, "name": v} for k, v in STABILITY_MODELS.items()],
    }
