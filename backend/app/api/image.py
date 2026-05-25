import random
import base64
import urllib.parse
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.security import get_current_user
from ..models.user import User

router = APIRouter(prefix="/image", tags=["image"])


class ImageRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    seed: int | None = None
    model: str = "flux"


@router.post("/generate")
async def generate_image(
    req: ImageRequest,
    current_user: User = Depends(get_current_user),
):
    seed = req.seed if req.seed is not None else random.randint(1, 2**31)
    encoded_prompt = urllib.parse.quote(req.prompt)
    url = (
        f"https://image.pollinations.ai/prompt/{encoded_prompt}"
        f"?width={req.width}&height={req.height}"
        f"&nologo=true&seed={seed}&model={req.model}"
    )
    if req.negative_prompt:
        url += f"&negative={urllib.parse.quote(req.negative_prompt)}"

    # Fetch the image server-side so the client never needs direct access
    # to external domains (avoids CSP/WebView issues in Tauri and Capacitor)
    try:
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Image generation timed out")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Image provider error: {exc}")

    content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
    b64 = base64.b64encode(resp.content).decode()
    data_url = f"data:{content_type};base64,{b64}"

    return {"url": data_url, "seed": seed, "prompt": req.prompt}
