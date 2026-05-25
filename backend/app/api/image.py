import random
import urllib.parse
from fastapi import APIRouter, Depends
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
    return {"url": url, "seed": seed, "prompt": req.prompt}
