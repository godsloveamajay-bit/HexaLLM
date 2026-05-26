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
    # ── 1. Code & Maths ──────────────────────────────────────────────────────
    "nebulax:code": Variant(
        id="nebulax:code",
        label="NebulaX Code",
        description="Coding and maths. Routes to DeepSeek-R1 for pure reasoning/proofs, DeepSeek-Coder for everything else.",
        default_model="deepseek-coder:6.7b",
        routes=[
            RoutedModel("deepseek-r1:8b", "reasoning"),   # proofs, equations, step-by-step maths
            RoutedModel("deepseek-coder:6.7b", "code"),   # code generation, debugging, refactoring
        ],
        system_prompt=(
            "You are NebulaX Code, an expert software engineer and mathematician. "
            "Write clean, correct, well-commented code. For maths and proofs, show each step clearly. "
            "Always specify the language in code blocks. Prefer concise, idiomatic solutions. "
            "Point out edge cases, bugs, and complexity trade-offs where relevant."
        ),
        temperature=0.2,
        num_ctx=16384,
        num_predict=4096,
        fallbacks=["phi3:mini"],
    ),

    # ── 2. Chat & Everyday tasks ─────────────────────────────────────────────
    "nebulax:chat": Variant(
        id="nebulax:chat",
        label="NebulaX Chat",
        description="Friendly conversation and everyday tasks. Fast, warm, and to the point.",
        default_model="llama3.2:3b",
        routes=[],
        system_prompt=(
            "You are NebulaX Chat, a friendly and helpful assistant. "
            "Keep answers conversational, clear, and concise. "
            "Match the user's tone — casual if they're casual, detailed if they want depth. "
            "Don't pad responses with unnecessary disclaimers or filler."
        ),
        temperature=0.7,
        num_ctx=8192,
        num_predict=1024,
        fallbacks=["phi3:mini"],
    ),

    # ── 3. Writing & Literature ──────────────────────────────────────────────
    "nebulax:write": Variant(
        id="nebulax:write",
        label="NebulaX Write",
        description="Creative writing, editing, storytelling, and literary analysis.",
        default_model="llama3.2:3b",
        routes=[],
        system_prompt=(
            "You are NebulaX Write, a skilled writer and literary assistant. "
            "Help with creative writing, storytelling, poetry, essays, editing, and literary analysis. "
            "Adapt your voice to the genre and style the user asks for — literary, commercial, academic, or playful. "
            "For editing tasks, explain changes and preserve the author's voice. "
            "Be imaginative, specific, and avoid clichés."
        ),
        temperature=0.9,
        num_ctx=8192,
        num_predict=2048,
        fallbacks=["phi3:mini"],
    ),

    # ── 4. Deep reasoning & Analysis ────────────────────────────────────────
    "nebulax:think": Variant(
        id="nebulax:think",
        label="NebulaX Think",
        description="Deep analysis, research, strategy, and complex problem solving.",
        default_model="deepseek-r1:8b",
        routes=[],
        system_prompt=(
            "You are NebulaX Think, an analytical assistant built for deep reasoning. "
            "Break complex problems into steps. State your assumptions explicitly. "
            "Weigh trade-offs, consider multiple perspectives, and flag uncertainty. "
            "Prefer correctness and thoroughness over speed. "
            "End every response with a clear, actionable conclusion."
        ),
        temperature=0.4,
        num_ctx=16384,
        num_predict=4096,
        fallbacks=["llama3.2:3b", "phi3:mini"],
    ),

    # ── 5. Custom ────────────────────────────────────────────────────────────
    "nebulax:custom": Variant(
        id="nebulax:custom",
        label="NebulaX Custom",
        description="Bring-your-own system prompt. Full control over the assistant's voice and behavior.",
        default_model="llama3.2:3b",
        routes=[],
        system_prompt="",  # user-supplied prompt used directly
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
