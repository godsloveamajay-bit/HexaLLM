"""Text-to-speech for direct voice chat.

Edge TTS (Microsoft's free neural voices) turns assistant replies into speech so
the frontend voice mode can talk back to the user — no local model download, no
GPU needed. The audio comes back as a single mp3 blob; the client plays it.
"""
import os
import re
import threading

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..core.security import get_optional_user

router = APIRouter(prefix="/voice", tags=["voice"])
limiter = Limiter(key_func=get_remote_address)

# en-US-JennyNeural is warm and clear; override via TTS_VOICE.
TTS_VOICE = os.getenv("TTS_VOICE", "en-US-JennyNeural")
MAX_TEXT_CHARS = 4000

_locks = {}  # per-voice concurrency guard (edge-tts is not thread-safe per voice)
_locks_lock = threading.Lock()


def _lock_for(voice: str) -> threading.Lock:
    with _locks_lock:
        return _locks.setdefault(voice, threading.Lock())


class SynthesizeRequest(BaseModel):
    text: str


def _clean(text: str) -> str:
    """Strip markdown/emoji/noise so the voice doesn't read raw syntax."""
    text = re.sub(r"```[\s\S]*?```", " ", text)          # code fences
    text = re.sub(r"`([^`]*)`", r"\1", text)             # inline code
    text = re.sub(r"[*_~>#\[\]|]", " ", text)            # markdown symbols
    text = re.sub(r"!\[.*?\]\(.*?\)", " ", text)         # images
    text = re.sub(r"\(https?://[^)]*\)", " ", text)      # bare urls
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


@router.post("/synthesize")
@limiter.limit("30/minute")
async def synthesize(
    request: Request,
    body: SynthesizeRequest,
    current_user=Depends(get_optional_user),  # available to guests too
):
    text = _clean(body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to say")
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]

    try:
        import edge_tts
    except ImportError:
        raise HTTPException(status_code=503, detail="TTS unavailable")

    audio = bytearray()
    try:
        with _lock_for(TTS_VOICE):
            communicate = edge_tts.Communicate(text, TTS_VOICE, rate="+8%")
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Synthesis failed: {exc}")

    if not audio:
        raise HTTPException(status_code=502, detail="No audio produced")
    return Response(
        content=bytes(audio),
        media_type="audio/mpeg",
        headers={"X-Voice": TTS_VOICE},
    )
