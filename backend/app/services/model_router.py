"""NebulaX virtual models — a thin routing layer over Ollama.

Each variant looks like a single model from the user's perspective
(`nebulax:fast`, `nebulax:balanced`, `nebulax:thinking`) but the backend
picks the best underlying Ollama model per request, then merges in the
variant's system prompt + sampling parameters.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# ── prompt feature detection ─────────────────────────────────────────────────

_CODE_FENCE_RE = re.compile(r"```|^\s{4}[^\s]", re.MULTILINE)
_CODE_HINT_RE = re.compile(
    r"\b("
    r"function|class|def|import|return|const|let|var|=>|"
    r"refactor|debug|stacktrace|traceback|stack trace|"
    r"compile|runtime error|syntax error|"
    r"javascript|typescript|python|rust|golang|java|"
    r"sql query|regex"
    r")\b",
    re.IGNORECASE,
)

_REASONING_HINT_RE = re.compile(
    r"\b("
    r"prove|derive|why|explain why|reason|reasoning|"
    r"step by step|step-by-step|walk me through|"
    r"calculate|compute|solve|equation|theorem|"
    r"trade-?off|compare|contrast|analy[sz]e|"
    r"plan|strategy|design|architecture|"
    r"puzzle|logic"
    r")\b",
    re.IGNORECASE,
)


def looks_like_code(text: str) -> bool:
    if not text:
        return False
    if _CODE_FENCE_RE.search(text):
        return True
    return bool(_CODE_HINT_RE.search(text))


def needs_reasoning(text: str) -> bool:
    if not text:
        return False
    # Long prompts often need more thinking; cheap heuristic.
    if len(text) > 600:
        return True
    return bool(_REASONING_HINT_RE.search(text))


# ── variant definitions ──────────────────────────────────────────────────────

@dataclass
class RoutedModel:
    """One concrete backend choice within a variant."""
    name: str                   # ollama model id
    condition: str = "default"  # human label: "code" / "reasoning" / "default"


@dataclass
class Variant:
    id: str
    label: str
    description: str
    default_model: str
    routes: List[RoutedModel] = field(default_factory=list)
    system_prompt: str = ""
    temperature: float = 0.7
    num_ctx: int = 4096
    num_predict: Optional[int] = None
    fallbacks: List[str] = field(default_factory=list)

    def all_candidates(self) -> List[str]:
        seen: List[str] = []
        for n in [self.default_model] + [r.name for r in self.routes] + self.fallbacks:
            if n not in seen:
                seen.append(n)
        return seen


VARIANTS: Dict[str, Variant] = {
    "nebulax:fast": Variant(
        id="nebulax:fast",
        label="NebulaX Fast",
        description="Quick, direct answers. Best for short questions and snappy chat.",
        default_model="phi3:mini",
        routes=[],  # fast = always the same model, no routing overhead
        system_prompt=(
            "You are NebulaX Fast, a concise assistant. "
            "Answer directly and briefly in plain language. "
            "Do not invent context, exercises, or tutorials the user did not ask for. "
            "If asked a simple question, give a simple answer."
        ),
        temperature=0.3,
        num_ctx=4096,
        num_predict=512,
        fallbacks=["llama3.1:8b"],
    ),
    "nebulax:balanced": Variant(
        id="nebulax:balanced",
        label="NebulaX Balanced",
        description="General-purpose chat. Picks a code model when the prompt looks like code.",
        default_model="llama3.1:8b",
        routes=[
            RoutedModel("deepseek-coder:6.7b", "code"),
        ],
        system_prompt=(
            "You are NebulaX Balanced, a helpful general-purpose assistant. "
            "Be clear, accurate, and well-organized. "
            "Use markdown for structure when it helps; keep answers focused on what was asked."
        ),
        temperature=0.7,
        num_ctx=8192,
        num_predict=2048,
        fallbacks=["phi3:mini"],
    ),
    "nebulax:thinking": Variant(
        id="nebulax:thinking",
        label="NebulaX Thinking",
        description="Deeper reasoning. Routes between r1 (reasoning), deepseek-coder (code), and llama (general).",
        default_model="deepseek-r1:8b",
        routes=[
            RoutedModel("deepseek-coder:6.7b", "code"),
            RoutedModel("deepseek-r1:8b", "reasoning"),
            RoutedModel("llama3.1:8b", "default"),
        ],
        system_prompt=(
            "You are NebulaX Thinking, an assistant that reasons carefully before answering. "
            "Break problems into steps when useful. State assumptions, weigh trade-offs, "
            "and prefer correctness over speed. Show your reasoning succinctly when relevant; "
            "always end with a clear final answer."
        ),
        temperature=0.5,
        num_ctx=16384,
        num_predict=4096,
        fallbacks=["llama3.1:8b", "phi3:mini"],
    ),
    "nebulax:custom": Variant(
        id="nebulax:custom",
        label="NebulaX Custom",
        description="Bring-your-own system prompt. The only variant where you control the assistant's voice and behavior.",
        default_model="llama3.1:8b",
        routes=[],   # no routing — predictable behavior for prompt experiments
        system_prompt="",  # empty; user-supplied prompt is used directly
        temperature=0.7,
        num_ctx=8192,
        num_predict=2048,
        fallbacks=["phi3:mini"],
    ),
}


# Variants that allow the caller to supply their own system prompt.
# All other variants ignore req.system_prompt to preserve their branded voice.
USER_PROMPT_ALLOWED = {"nebulax:custom"}


def allows_user_prompt(variant_id: str) -> bool:
    return variant_id in USER_PROMPT_ALLOWED


def is_variant(model_id: str) -> bool:
    return model_id in VARIANTS


def get_variant(model_id: str) -> Optional[Variant]:
    return VARIANTS.get(model_id)


# ── routing ──────────────────────────────────────────────────────────────────

@dataclass
class RouteDecision:
    variant_id: str
    chosen_model: str
    reason: str           # "code", "reasoning", "default", "fallback:<base>"
    system_prompt: str
    temperature: float
    num_ctx: int
    num_predict: Optional[int]


def route(
    variant_id: str,
    user_text: str,
    available_models: List[str],
) -> RouteDecision:
    """Pick the best concrete model for this variant + prompt.

    available_models is the list of models actually pulled in Ollama
    (names from `/api/tags`). We never route to a model the user hasn't pulled.
    """
    v = VARIANTS[variant_id]
    available = set(available_models)

    code = looks_like_code(user_text)
    reasoning = needs_reasoning(user_text)

    def matches(condition: str) -> bool:
        if condition == "code":
            return code
        if condition == "reasoning":
            return reasoning
        if condition == "default":
            return True
        return False

    chosen: Optional[str] = None
    reason = "default"

    # 1. Try the variant's explicit routes in order.
    for r in v.routes:
        if matches(r.condition) and r.name in available:
            chosen = r.name
            reason = r.condition
            break

    # 2. Fall back to the variant's default model.
    if chosen is None and v.default_model in available:
        chosen = v.default_model
        reason = "default"

    # 3. Fall back to declared fallbacks in order.
    if chosen is None:
        for fb in v.fallbacks:
            if fb in available:
                chosen = fb
                reason = f"fallback:{fb}"
                break

    # 4. Last resort: any candidate that exists.
    if chosen is None:
        for c in v.all_candidates():
            if c in available:
                chosen = c
                reason = f"fallback:{c}"
                break

    if chosen is None:
        raise RuntimeError(
            f"No underlying model available for {variant_id}. "
            f"Pull one of: {', '.join(v.all_candidates())}"
        )

    return RouteDecision(
        variant_id=variant_id,
        chosen_model=chosen,
        reason=reason,
        system_prompt=v.system_prompt,
        temperature=v.temperature,
        num_ctx=v.num_ctx,
        num_predict=v.num_predict,
    )


def merge_system_prompt(variant_prompt: str, user_prompt: Optional[str]) -> str:
    """Stack the variant's system prompt with any user-supplied one."""
    if not variant_prompt:
        return (user_prompt or "").strip()
    if not user_prompt:
        return variant_prompt
    return f"{variant_prompt}\n\n{user_prompt}"
