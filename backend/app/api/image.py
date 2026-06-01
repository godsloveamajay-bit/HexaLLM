import random
import base64
import urllib.parse
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..core.security import get_current_user
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


async def _enhance_prompt(prompt: str) -> str:
    """Use a local Ollama model to expand a short prompt into a detailed one."""
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
        return prompt  # fallback to original if Ollama unavailable


async def generate_image_data_url(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    seed: Optional[int] = None,
    model: str = "flux",
    pollinations_enhance: bool = True,
    negative_prompt: str = "",
) -> dict:
    """Generate an image via Pollinations and return it as a base64 data URL.

    Shared by the /image/generate endpoint and the in-chat "generate an image
    of …" shortcut. Raises httpx errors on failure (callers handle them).
    """
    seed = seed if seed is not None else random.randint(1, 2**31)
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


class ImageRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    seed: Optional[int] = None
    model: str = "flux-realism"
    enhance_prompt: bool = False   # use Ollama to rewrite the prompt
    pollinations_enhance: bool = True  # use Pollinations' built-in enhancer


@router.post("/generate")
async def generate_image(
    req: ImageRequest,
    current_user: User = Depends(get_current_user),
):
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
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Image generation timed out")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Image provider error: {exc}")

    return {
        "url": result["data_url"],
        "seed": result["seed"],
        "prompt": req.prompt,
        "enhanced_prompt": final_prompt if req.enhance_prompt else None,
    }
