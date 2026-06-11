"""Model Personality Engine.

Turns six 0–100 personality sliders into (a) a behavioural system-prompt
fragment and (b) concrete sampling parameters. Pure functions, no deps — reused
by chat, personas, and the exposed OpenAI-compatible API.

Traits (all default 50 = neutral):
  creativity   imaginative ↔ practical
  formality    formal ↔ casual
  risk         bold/decisive ↔ cautious
  verbosity    thorough ↔ concise
  empathy      warm ↔ objective
  logic        analytical(100) ↔ intuitive(0)
"""
from __future__ import annotations

from typing import Dict, Optional

TRAIT_KEYS = ("creativity", "formality", "risk", "verbosity", "empathy", "logic")

# Per-trait sentence for the low and high ends. The middle band emits nothing,
# so the fragment only describes the dials the user actually moved.
_PHRASES = {
    "creativity": (
        "Stay practical and conventional — prefer safe, well-established answers over novel ones.",
        "Be imaginative and original — offer fresh angles, analogies, and creative leaps.",
    ),
    "formality": (
        "Keep the tone casual and conversational, like talking to a friend.",
        "Keep the tone formal, polished, and professional.",
    ),
    "risk": (
        "Be cautious — hedge uncertain claims, surface caveats, and avoid speculation.",
        "Be bold and decisive — give direct opinions and commit to a recommendation even under uncertainty.",
    ),
    "verbosity": (
        "Be concise — short, direct answers with no preamble or filler.",
        "Be thorough — explain with depth, context, and concrete examples.",
    ),
    "empathy": (
        "Be objective and matter-of-fact — prioritise facts over feelings.",
        "Be warm, supportive, and emotionally attuned — acknowledge how the user feels.",
    ),
    "logic": (
        "Reason intuitively and holistically — use analogy, pattern, and big-picture judgement.",
        "Reason analytically and rigorously — work step by step with explicit logic.",
    ),
}

_DEADZONE = 8   # |value-50| below this = neutral (no effect)


def normalize(traits: Optional[Dict]) -> Dict[str, int]:
    """Coerce arbitrary input into a clean {trait: 0..100} dict."""
    out: Dict[str, int] = {}
    src = traits or {}
    for k in TRAIT_KEYS:
        try:
            v = int(round(float(src.get(k, 50))))
        except (TypeError, ValueError):
            v = 50
        out[k] = max(0, min(100, v))
    return out


def is_active(traits: Optional[Dict]) -> bool:
    t = normalize(traits)
    return any(abs(v - 50) >= _DEADZONE for v in t.values())


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def compose(traits: Optional[Dict]) -> Dict:
    """Return {active, system_fragment, temperature, top_p, max_tokens, traits}.

    temperature/top_p/max_tokens are None when the engine is neutral, so callers
    fall back to their own defaults.
    """
    t = normalize(traits)
    if not is_active(t):
        return {"active": False, "system_fragment": "", "temperature": None,
                "top_p": None, "max_tokens": None, "traits": t}

    lines = []
    for k in TRAIT_KEYS:
        v = t[k]
        if v <= 33:
            lines.append(_PHRASES[k][0])
        elif v >= 67:
            lines.append(_PHRASES[k][1])

    fragment = ""
    if lines:
        fragment = "[Personality — adopt this voice and behaviour]\n" + "\n".join(f"- {line}" for line in lines)

    # Sampling. creativity drives temperature, risk nudges it and sets top_p.
    temperature = round(_clamp(0.15 + (t["creativity"] / 100) * 1.0 + (t["risk"] - 50) / 250, 0.05, 1.3), 2)
    top_p = round(_clamp(0.55 + (t["risk"] / 100) * 0.45, 0.5, 1.0), 2)

    # verbosity → response length cap (only at the extremes; mid leaves it to the model)
    verb = t["verbosity"]
    if verb < 40:
        max_tokens = int(150 + verb * 5)          # ~150–350: terse
    elif verb > 70:
        max_tokens = int(800 + (verb - 70) * 40)  # ~800–2000: expansive
    else:
        max_tokens = None

    return {
        "active": True,
        "system_fragment": fragment,
        "temperature": temperature,
        "top_p": top_p,
        "max_tokens": max_tokens,
        "traits": t,
    }


def apply_to_prompt(base: Optional[str], traits: Optional[Dict]) -> str:
    """Append the personality fragment to a base system prompt."""
    spec = compose(traits)
    if not spec["active"] or not spec["system_fragment"]:
        return base or ""
    return (base + "\n\n" + spec["system_fragment"]) if base else spec["system_fragment"]
