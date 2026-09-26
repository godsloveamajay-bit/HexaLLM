"""text-stats — pure text analysis. No permissions required.

Contract: expose ``TOOLS`` metadata and a ``run(tool_name, args) -> str``
dispatcher. ``run`` may be sync or async; the harness handles either.
"""
import hashlib
import json
import re

TOOLS = [
    {
        "name": "text_stats",
        "description": "Compute word, character, sentence and line counts plus average word length.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {
        "name": "reading_time",
        "description": "Estimate reading time for a block of text.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}, "wpm": {"type": "integer"}},
            "required": ["text"],
        },
    },
]

_WORDS = re.compile(r"\b[\w'-]+\b", re.UNICODE)


def _stats(text: str) -> dict:
    words = _WORDS.findall(text)
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
    return {
        "characters": len(text),
        "characters_no_spaces": len(re.sub(r"\s", "", text)),
        "words": len(words),
        "unique_words": len({w.lower() for w in words}),
        "sentences": len(sentences),
        "lines": len(text.splitlines()) or (1 if text else 0),
        "avg_word_length": round(sum(len(w) for w in words) / len(words), 2) if words else 0,
        "longest_word": max(words, key=len) if words else None,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()[:16],
    }


def _text(args: dict) -> str:
    text = args.get("text")
    if not isinstance(text, str):
        raise ValueError("'text' is required and must be a string")
    return text


def run(tool: str, args: dict) -> str:
    args = args or {}
    if tool == "text_stats":
        return json.dumps(_stats(_text(args)), indent=2)

    if tool == "reading_time":
        wpm = args.get("wpm") or 200
        try:
            wpm = max(1, int(wpm))
        except (TypeError, ValueError):
            wpm = 200
        words = len(_WORDS.findall(_text(args)))
        minutes = words / wpm
        human = (
            f"{minutes * 60:.0f} seconds"
            if minutes < 1
            else f"{minutes:.1f} minutes"
        )
        return f"{words} words at {wpm} wpm ≈ {human} ({minutes:.2f} min)"

    raise ValueError(f"unknown tool: {tool}")
