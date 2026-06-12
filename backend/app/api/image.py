import random
import base64
import urllib.parse
import httpx
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
_ENHANCE_MODEL = "llama3:8B"

_ENHANCE_SYSTEM = (
    "You are an expert image prompt engineer. "
    "Rewrite the user's prompt into a richly detailed, vivid description for a text-to-image AI. "
    "Add specific details about lighting, composition, style, mood, and quality. "
    "Keep it under 120 words. Output ONLY the improved prompt — no explanations, no quotes."
)

_STABILITY_API = "https://api.stability.ai/v2beta/stable-image/generate/ultra"

# Models available per provider
POLLINATIONS_MODELS = {
    "flux-realism": "FLUX Realism",
    "flux-anime": "FLUX Anime",
    "flux-3d": "FLUX 3D",
    "flux": "FLUX",
    "turbo": "Turbo",
}

STABILITY_MODELS = {
    "sd3-ultra": "Stable Diffusion 3.5 Ultra",
    "sd3-core": "Stable Diffusion 3.5 Core",
}

ALL_MODELS = {**POLLINATIONS_MODELS, **STABILITY_MODELS}


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


def _pick_provider(requested_model: str) -> str:
    if requested_model in STABILITY_MODELS:
        return "stability"
    return "pollinations"


async def _generate_pollinations(
    prompt: str, width: int, height: int, seed: int,
    model: str, pollinations_enhance: bool, negative_prompt: str,
) -> dict:
    encoded_prompt = urllib.parse.quote(prompt)
    url = (
        f"https://image.pollinations.ai/prompt/{encoded_prompt}"
        f"?width={width}&height={height}"
        f"&nologo=true&seed={seed}&model={model}"
    )
    if pollinations_enhance:
        url += "&enhance=true"
    if negative_prompt:
        url += f"&negative={urllib.parse.quote(negative_prompt)}"

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()

    content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
    b64 = base64.b64encode(resp.content).decode()
    return {"data_url": f"data:{content_type};base64,{b64}", "seed": seed}


async def _generate_stability(
    prompt: str, aspect_ratio: str, seed: int,
    model: str, output_format: str,
) -> dict:
    api_key = settings.STABILITY_API_KEY
    if not api_key:
        raise HTTPException(status_code=502, detail="Stability AI API key not configured")

    endpoint = _STABILITY_API if model == "sd3-ultra" else \
        "https://api.stability.ai/v2beta/stable-image/generate/core"

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            endpoint,
            headers={
                "authorization": f"Bearer {api_key}",
                "accept": "image/*",
            },
            files={
                "prompt": (None, prompt),
                "aspect_ratio": (None, aspect_ratio),
                "seed": (None, str(seed)),
                "output_format": (None, output_format),
            },
        )
        if resp.status_code == 403:
            raise HTTPException(status_code=502, detail="Stability AI: invalid API key or insufficient credits")
        if resp.status_code != 200:
            detail = resp.text[:300]
            raise HTTPException(status_code=502, detail=f"Stability AI: {detail}")
        resp.raise_for_status()

    content_type = resp.headers.get("content-type", f"image/{output_format}").split(";")[0]
    b64 = base64.b64encode(resp.content).decode()
    return {"data_url": f"data:{content_type};base64,{b64}", "seed": seed}


def _aspect_ratio_str(width: int, height: int) -> str:
    ratios = {
        (16, 9): "16:9",
        (9, 16): "9:16",
        (3, 2): "3:2",
        (2, 3): "2:3",
        (4, 5): "4:5",
        (5, 4): "5:4",
        (21, 9): "21:9",
        (9, 21): "9:21",
        (1, 1): "1:1",
    }
    from math import gcd
    g = gcd(width, height)
    simplified = (width // g, height // g)
    return ratios.get(simplified, "1:1")


async def generate_image_data_url(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    seed: Optional[int] = None,
    model: str = "flux-realism",
    pollinations_enhance: bool = True,
    negative_prompt: str = "",
) -> dict:
    provider = _pick_provider(model)
    seed = seed if seed is not None else random.randint(1, 2**31)

    if provider == "stability":
        aspect_ratio = _aspect_ratio_str(width, height)
        output_format = "png"
        return await _generate_stability(prompt, aspect_ratio, seed, model, output_format)

    return await _generate_pollinations(prompt, width, height, seed, model,
                                          pollinations_enhance, negative_prompt)


class ImageRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    seed: Optional[int] = None
    model: str = "flux-realism"
    enhance_prompt: bool = False
    pollinations_enhance: bool = True


@router.post("/generate")
async def generate_image(
    req: ImageRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ..services.billing_enforcement import check_image_gen
    check_image_gen(db, current_user, client_ip=request.client.host if request.client else None)

    provider = _pick_provider(req.model)
    available = STABILITY_MODELS if provider == "stability" else POLLINATIONS_MODELS
    if req.model not in available:
        raise HTTPException(status_code=400, detail=f"Unknown model '{req.model}' for provider '{provider}'")

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
            pollinations_enhance=req.pollinations_enhance,
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
        "provider": provider,
    }


@router.get("/models")
async def list_image_models():
    return {
        "pollinations": [{"id": k, "name": v} for k, v in POLLINATIONS_MODELS.items()],
        "stability": [{"id": k, "name": v} for k, v in STABILITY_MODELS.items()],
    }
