"""Text-to-speech for direct voice chat.

Edge TTS (Microsoft's free neural voices) turns assistant replies into speech so
the frontend voice mode can talk back to the user — no local model download, no
GPU needed. Two endpoints: /synthesize returns the whole mp3 blob at once,
/stream yields mp3 chunks so the client can start speaking before synthesis
finishes. The voice used is the caller's Settings preference (voice_name),
falling back to the TTS_VOICE env default.
"""
import os
import re
import threading
import time

try:
    import edge_tts
except ImportError:
    edge_tts = None  # availability checked per-request in _prepare

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
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

# ShortName validation: exact match against edge-tts' voice catalog, cached for
# an hour so we don't hit Microsoft on every request. If the catalog fetch ever
# fails we fall back to accepting the voice (synthesis itself still validates).
_voice_catalog = {"list": None, "at": 0.0}


def _lock_for(voice: str) -> threading.Lock:
    with _locks_lock:
        return _locks.setdefault(voice, threading.Lock())


def _resolve_voice(current_user) -> str:
    if current_user is not None:
        pref = getattr(current_user, "voice_name", None)
        if pref:
            return pref
    return TTS_VOICE


def _valid_voice(voice: str) -> bool:
    if edge_tts is None:
        return True
    now = time.time()
    if _voice_catalog["list"] is None or now - _voice_catalog["at"] > 3600:
        try:
            _voice_catalog["list"] = {v["ShortName"] for v in edge_tts.list_voices()}
            _voice_catalog["at"] = now
        except Exception:
            return True  # catalog unavailable — let synthesis be the judge
    return voice in _voice_catalog["list"]


class SynthesizeRequest(BaseModel):
    text: str
    voice: str | None = None  # optional per-request override


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


def _prepare(request: Request, body: SynthesizeRequest, current_user):
    """Common validation for both endpoints: returns (text, voice)."""
    text = _clean(body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to say")
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
    voice = body.voice or _resolve_voice(current_user)
    if voice != TTS_VOICE and not _valid_voice(voice):
        raise HTTPException(status_code=400, detail=f"Unknown voice: {voice}")
    if edge_tts is None:
        raise HTTPException(status_code=503, detail="TTS unavailable")
    return text, voice


@router.post("/synthesize")
@limiter.limit("30/minute")
async def synthesize(
    request: Request,
    body: SynthesizeRequest,
    current_user=Depends(get_optional_user),  # available to guests too
):
    text, voice = _prepare(request, body, current_user)

    audio = bytearray()
    try:
        with _lock_for(voice):
            communicate = edge_tts.Communicate(text, voice, rate="+8%")
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
        headers={"X-Voice": voice},
    )


@router.post("/stream")
@limiter.limit("30/minute")
async def synthesize_stream(
    request: Request,
    body: SynthesizeRequest,
    current_user=Depends(get_optional_user),
):
    """Stream mp3 chunks as they're generated so playback starts immediately."""
    text, voice = _prepare(request, body, current_user)

    async def gen():
        try:
            with _lock_for(voice):
                communicate = edge_tts.Communicate(text, voice, rate="+8%")
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        yield chunk["data"]
        except Exception:
            pass  # connection aborted / synthesis failed mid-stream

    return StreamingResponse(
        gen(),
        media_type="audio/mpeg",
        headers={"X-Voice": voice},
    )
