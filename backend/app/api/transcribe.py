"""Server-side speech-to-text via faster-whisper (CTranslate2).

Replaces the browser's flaky Web Speech API: the client records audio and POSTs
it here, we run Whisper on CPU and return the transcript. Self-contained — no
torch, no external service; PyAV/ffmpeg handles audio decoding.
"""
import os
import tempfile
import threading

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..core.security import get_optional_user

router = APIRouter(prefix="/transcribe", tags=["transcribe"])
limiter = Limiter(key_func=get_remote_address)

# Model is loaded lazily on first request (downloads ~140MB for "base" the first
# time, then cached under ~/.cache/huggingface). Override size via WHISPER_MODEL
# (tiny|base|small|medium). int8 keeps it fast and light on this CPU-only box.
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(25 * 1024 * 1024)))  # 25MB

_model = None
_model_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel
                _model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _model


def _transcribe_file(path: str) -> dict:
    """Blocking — runs on a worker thread. Consumes the segment generator."""
    model = _get_model()
    segments, info = model.transcribe(path, beam_size=1, vad_filter=True)
    text = "".join(seg.text for seg in segments).strip()
    return {"text": text, "language": getattr(info, "language", None)}


@router.post("")
@limiter.limit("10/minute")
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_optional_user),  # available to guests too
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large")

    # Whisper/PyAV sniffs the container from content, but keep the original
    # extension when present so odd codecs decode cleanly.
    suffix = os.path.splitext(file.filename or "")[1] or ".webm"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(data)
        tmp.close()
        try:
            result = await run_in_threadpool(_transcribe_file, tmp.name)
        except Exception as exc:  # model download failure, decode error, etc.
            raise HTTPException(status_code=503, detail=f"Transcription failed: {exc}")
        return result
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
