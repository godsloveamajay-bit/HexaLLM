import random
import base64
import urllib.parse
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..core.security import get_current_user
from ..core.config import settings
from ..models.user import User
from .image import _enhance_prompt  # reuse the Ollama prompt expander

router = APIRouter(prefix="/video", tags=["video"])

_GEN_BASE = "https://gen.pollinations.ai/video"


class VideoNotConfigured(RuntimeError):
    """Raised when no Pollinations key is set, so callers can show a hint."""


async def generate_video_data_url(
    prompt: str,
    *,
    model: Optional[str] = None,
    duration: int = 5,
    aspect_ratio: str = "16:9",
    seed: Optional[int] = None,
) -> dict:
    """Generate a short video via Pollinations and return it as a base64 data URL.

    Shared by the /video/generate endpoint and the in-chat "generate a video
    of …" shortcut. Mirrors generate_image_data_url() in image.py — but the
    Pollinations video endpoint requires a (free, seed-tier) API key, so we
    raise VideoNotConfigured when one isn't set.
    """
    if not settings.POLLINATIONS_API_KEY:
        raise VideoNotConfigured(
            "Video generation isn't configured. Add a free Pollinations key "
            "(POLLINATIONS_API_KEY) from enter.pollinations.ai to enable it."
        )

    model = model or settings.VIDEO_MODEL
    seed = seed if seed is not None else random.randint(1, 2**31)
    encoded_prompt = urllib.parse.quote(prompt)
    url = (
        f"{_GEN_BASE}/{encoded_prompt}"
        f"?model={urllib.parse.quote(model)}"
        f"&duration={duration}&aspectRatio={urllib.parse.quote(aspect_ratio)}"
        f"&seed={seed}"
    )

    # Video render can take a while on the provider side — give it a long budget.
    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        resp = await client.get(url, headers={
            "Authorization": f"Bearer {settings.POLLINATIONS_API_KEY}",
            "User-Agent": "Mozilla/5.0",
        })
        resp.raise_for_status()

    content_type = resp.headers.get("content-type", "video/mp4").split(";")[0]
    if not content_type.startswith("video/"):
        # Provider returned an error JSON instead of bytes.
        raise RuntimeError(resp.text[:200] or "unexpected non-video response")
    b64 = base64.b64encode(resp.content).decode()
    return {"data_url": f"data:{content_type};base64,{b64}", "seed": seed, "model": model}


class VideoRequest(BaseModel):
    prompt: str
    model: Optional[str] = None
    duration: int = 5
    aspect_ratio: str = "16:9"
    seed: Optional[int] = None
    enhance_prompt: bool = False  # use Ollama to expand the prompt first


@router.post("/generate")
async def generate_video(
    req: VideoRequest,
    current_user: User = Depends(get_current_user),
):
    final_prompt = req.prompt
    if req.enhance_prompt:
        final_prompt = await _enhance_prompt(req.prompt)

    try:
        result = await generate_video_data_url(
            final_prompt,
            model=req.model,
            duration=req.duration,
            aspect_ratio=req.aspect_ratio,
            seed=req.seed,
        )
    except VideoNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Video generation timed out")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Video provider error: {exc.response.status_code}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Video provider error: {exc}")

    return {
        "url": result["data_url"],
        "seed": result["seed"],
        "model": result["model"],
        "prompt": req.prompt,
        "enhanced_prompt": final_prompt if req.enhance_prompt else None,
    }
