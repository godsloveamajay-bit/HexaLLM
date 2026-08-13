"""HexaLLM virtual models — a thin routing layer over Ollama.

Each variant looks like a single model from the user's perspective
(`hex-4.2-turbo`, `hex-5.1-prime`, `hex-6.0-reason`) but the backend
picks the best underlying Ollama model per request, then merges in the
variant's system prompt + sampling parameters.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
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


# Escalation cues — these promote a request to a heavier (slower) tier. Kept
# deliberately explicit so casual use stays in the fast lane; a user only pays
# the 14B latency when they ask for depth.
_DEEP_HINT_RE = re.compile(
    r"\b("
    r"rigorous(ly)?|in[\s-]?depth|deep[\s-]?dive|think (deeply|hard(er)?)|"
    r"thorough(ly)?|comprehensive(ly)?|exhaustive(ly)?|"
    r"formal proof|from first principles|prove rigorously|"
    r"carefully (analy[sz]e|reason|consider)|detailed analysis"
    r")\b",
    re.IGNORECASE,
)
_HEAVY_CODE_RE = re.compile(
    r"\b("
    r"refactor|re-?architect|architect|migrate|rewrite|optimi[sz]e|"
    r"design (a|an|the) (system|api|architecture|schema|database)|"
    r"entire (codebase|module|file|project)|"
    r"implement (a|an|the) (full|complete|entire)"
    r")\b",
    re.IGNORECASE,
)


def needs_deep_reasoning(text: str) -> bool:
    """Explicit deep-reasoning cues (or a very long prompt) → escalate to 14B."""
    if not text:
        return False
    return len(text) > 2000 or bool(_DEEP_HINT_RE.search(text))


def looks_like_heavy_code(text: str) -> bool:
    """Big/structural code work → escalate to the 14B coder."""
    if not text:
        return False
    return looks_like_code(text) and (len(text) > 800 or bool(_HEAVY_CODE_RE.search(text)))


# LaTeX delimiters are a strong math signal; word cues catch plain-language
# maths ("solve for x", "integral", "derivative", …).
_MATH_LATEX_RE = re.compile(r"\$[^$\n]{2,}\$")
_MATH_HINT_RE = re.compile(
    r"\b("
    r"equation|integral|derivative|differentiat|calculus|algebra|geometry|"
    r"matrix|vector|polynomial|fraction|probability|statistics|"
    r"theorem|axiom|solve for|linear algebra|differential|"
    r"trigonom|logarithm|exponent"
    r")\b",
    re.IGNORECASE,
)


def looks_like_math(text: str) -> bool:
    """True for equations, proofs and step-by-step maths — routes to the math-tuned model."""
    if not text:
        return False
    if _MATH_LATEX_RE.search(text):
        return True
    return bool(_MATH_HINT_RE.search(text))


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


# Underlying Ollama bases. Routing resolves these case-INSENSITIVELY against the
# live `/api/tags` list (see `route()`), so the exact casing here is forgiving —
# Ollama reports tags inconsistently (qwen2.5:7B but deepseek-r1:32b).
#
# Each "department" has a fast default plus heavier opt-in tiers that only kick
# in on explicit cues (see the escalation heuristics below). Tuned for the
# 12 GB RTX 4080 (laptop) GPU: the heaviest tier is 14B, which fits the VRAM
# alongside its KV cache at the context sizes used below. Nothing exceeds 12 GB.
_CODING = "qwen2.5-coder:7b"          # default coder (fast on GPU)
_CODING_HEAVY = "qwen2.5-coder:14b"   # hard refactors/architecture (fits 12 GB @8k ctx)
_CHAT = "qwen2.5:7b"                   # general chat
_THINKING = "deepseek-r1:1.5b"        # default reasoner — tiny, streams <think> fast
_THINKING_DEEP = "deepseek-r1:8b"     # heavier reasoner; ~6 GB, fits 12 GB VRAM
_GENERAL = "llama3.1:8b"              # writing/general
_LARGE = "qwen3:14b"                  # balanced default + universal fallback (fits 12 GB)
_FAST = "llama3.2:3b"                # snappy 3B for titles / quick replies
_VISION = "llama3.2-vision:11b"      # image understanding (fits 12 GB)
_MATH = "qwen2-math:7b"             # math-tuned for equations, proofs, step-by-step
_EMBED = "nomic-embed-text"          # embeddings for RAG / knowledge bases (~0.3 GB)
# Legacy models kept as safety fallbacks (only used if a primary is missing):
_OPENCHAT = "openchat:7b"
_LLAMA3 = "llama3:8b"

# Models that emit a separate chain-of-thought (reasoning) stream.
_REASONING_MODELS = ("deepseek-r1", "qwen3")

# Reasoners small enough to think quickly on the 12 GB GPU. Only these get
# chain-of-thought forced ON (so the Thought bubble fills fast); heavier
# reasoners are suppressed to keep everyday chat responsive.
_FAST_REASONERS = ("deepseek-r1:1.5b",)


def is_fast_reasoner(model: str) -> bool:
    """True for a reasoning model light enough to think quickly on CPU."""
    m = (model or "").lower()
    return any(f.lower() in m for f in _FAST_REASONERS)

# Trivial social inputs — greetings, acknowledgements, sign-offs — that don't
# warrant a reasoning pass. A message qualifies only if it is composed ENTIRELY
# of these words/phrases (any real question contains a non-trivial word and so
# fails the anchored match). Matched whole and case-insensitively.
_TRIVIAL_WORD = (
    r"(?:hi|hey+|hello|hiya|howdy|there|yo|sup|wassup|gm|good\s*(?:morning|afternoon|evening|night)|"
    r"how(?:'?s| are| is)?(?:\s*(?:you|it|things|everything|it\s*going))?|"
    r"thanks?|thank\s*you|thx|ty|cheers|much\s*appreciated|"
    r"ok(?:ay)?|kk?|cool|nice|great|awesome|perfect|got\s*it|gotcha|sounds\s*good|will\s*do|"
    r"yes|yep|yeah|nope?|np|no\s*problem|sure|alright|right|"
    r"lol|lmao|haha+|hehe|"
    r"bye|goodbye|see\s*(?:you|ya)|take\s*care|later)"
)
_TRIVIAL_RE = re.compile(
    rf"^{_TRIVIAL_WORD}(?:[\s,.!?]+{_TRIVIAL_WORD})*[\s,.!?]*$",
    re.IGNORECASE,
)


def is_reasoning_model(model: str) -> bool:
    """True if the model produces a chain-of-thought (deepseek-r1, qwen3)."""
    m = (model or "").lower()
    return any(r in m for r in _REASONING_MODELS)


def is_trivial_message(text: str) -> bool:
    """True for short greetings / acknowledgements that don't need reasoning."""
    t = (text or "").strip()
    return 0 < len(t) <= 60 and bool(_TRIVIAL_RE.match(t))


def should_think(model: str, user_text: str) -> Optional[bool]:
    """Return False to suppress chain-of-thought when a reasoning model is asked
    a trivial question (so it answers instantly instead of reasoning for minutes);
    None to leave the model's default behavior untouched."""
    if is_reasoning_model(model) and is_trivial_message(user_text):
        return False
    return None


# ── text-to-image intent ─────────────────────────────────────────────────────
# "generate/create/make/render an image|picture|… of X"  → prompt = X.
# Requires an explicit connector (of/showing/:/…) after the image noun so we
# don't fire on "generate an image classifier in Python".
_IMG_EXPLICIT_RE = re.compile(
    r"^\s*(?:please\s+|pls\s+|hey,?\s+)?"
    r"(?:can|could|would)?\s*(?:you\s+)?"
    r"(?:generate|create|make|render|produce|design|cook up|whip up|give me|show me|imagine)\s+"
    r"(?:me\s+)?(?:an?|some|a\s+few|a\s+couple\s+of)?\s*"
    r"(?:image|picture|photo(?:graph)?|pic|drawing|painting|illustration|artwork|art|"
    r"render(?:ing)?|logo|wallpaper|portrait|sketch|graphic|icon|poster|scene)s?"
    r"\s*(?:of|showing|depicting|featuring|with|that shows?|about|for|[:\-,])\s*(.+)",
    re.IGNORECASE | re.DOTALL,
)
# Visual verbs that imply image output directly: "draw/paint/sketch … X".
_IMG_DRAW_RE = re.compile(
    r"^\s*(?:please\s+|pls\s+)?(?:can|could|would)?\s*(?:you\s+)?"
    r"(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?(?:an?|some)?\s*(.+)",
    re.IGNORECASE | re.DOTALL,
)
# Explicit slash command.
_IMG_SLASH_RE = re.compile(r"^\s*/(?:image|imagine|img|draw|gen)\s+(.+)", re.IGNORECASE | re.DOTALL)


def detect_image_request(text: str) -> Optional[str]:
    """If the message is a text-to-image request, return the image prompt
    (whitespace-collapsed, single line); else None."""
    for rx in (_IMG_SLASH_RE, _IMG_EXPLICIT_RE, _IMG_DRAW_RE):
        m = rx.match(text or "")
        if m:
            prompt = " ".join(m.group(1).split()).strip().strip("\"'.")
            if len(prompt) >= 2:
                return prompt
    return None


# Substrings identifying a vision-capable (multimodal) model.
_VISION_MODELS = ("vision", "llava", "-vl", "moondream", "minicpm-v", "bakllava")


def is_vision_model(model: str) -> bool:
    """True if the model can read images."""
    m = (model or "").lower()
    return any(v in m for v in _VISION_MODELS)


def fast_model_for(available_models: List[str]) -> Optional[str]:
    """A small, fast model for cheap throwaway work (chat titles, etc.).
    Prefers the 3B; never returns a slow reasoning model."""
    avail_lc = {m.lower(): m for m in available_models}
    for pref in (_FAST, _CHAT, _GENERAL, _OPENCHAT, _LLAMA3):
        if pref.lower() in avail_lc:
            return avail_lc[pref.lower()]
    # else: any non-reasoning model
    for m in available_models:
        if not is_reasoning_model(m) and not is_vision_model(m):
            return m
    return None


def vision_model_for(available_models: List[str]) -> Optional[str]:
    """Pick a pulled vision model (prefer the configured default), else None.
    Used to auto-route any request carrying an image to a model that can see."""
    avail_lc = {m.lower(): m for m in available_models}
    if _VISION.lower() in avail_lc:
        return avail_lc[_VISION.lower()]
    for m in available_models:
        if is_vision_model(m):
            return m
    return None


VARIANTS: Dict[str, Variant] = {
    # ── 0. Auto ─────────────────────────────────────────────────────────────
    # Meta-variant: picks the best VARIANT per message (code, maths, deep
    # reasoning, vision, everyday chat), then delegates to that variant's own
    # routing. Served to users as a normal variant.
    "hex-auto": Variant(
        id="hex-auto",
        label="HexaLLM Auto",
        description="Picks the best variant for each message — code, maths, deep reasoning, vision or everyday chat.",
        default_model=_GENERAL,
        routes=[],
        system_prompt=(
            "You are HexaLLM Auto, a versatile assistant that adapts to the task. "
            "Match the depth and tone to what the user needs — concise for simple questions, "
            "detailed for complex ones. Write clean code, reason through problems step by step, "
            "and communicate clearly in plain language."
        ),
        temperature=0.7,
        num_ctx=8192,
        num_predict=2048,
        fallbacks=[_LARGE, _GENERAL],
    ),
    "hex-4.2-code": Variant(
        id="hex-4.2-code",
        label="HexaLLM Code",
        description="Coding and maths. Scales from quick snippets to big refactors and step-by-step proofs.",
        default_model=_CODING,
        routes=[
            RoutedModel(_CODING_HEAVY, "code_heavy"),  # refactors, architecture, big implementations
            RoutedModel(_CODING, "code"),              # everyday code gen/debug
            RoutedModel(_THINKING, "reasoning"),       # proofs, equations, step-by-step maths (no code)
        ],
        system_prompt=(
            "You are HexaLLM Code, an expert software engineer and mathematician. "
            "Write clean, correct, well-commented code. For maths and proofs, show each step clearly. "
            "Always specify the language in code blocks. Prefer concise, idiomatic solutions. "
            "Point out edge cases, bugs, and complexity trade-offs where relevant."
        ),
        temperature=0.2,
        num_ctx=8192,
        num_predict=4096,
        fallbacks=[_CODING, _LARGE, _GENERAL],
    ),

    # ── 2. Chat & Everyday tasks ─────────────────────────────────────────────
    "hex-4.2-turbo": Variant(
        id="hex-4.2-turbo",
        label="HexaLLM Turbo",
        description="Friendly conversation and everyday tasks. Fast, warm, and to the point.",
        default_model=_CHAT,
        routes=[],
        system_prompt=(
            "You are HexaLLM Turbo, a friendly and helpful assistant. "
            "Keep answers conversational, clear, and concise. "
            "Match the user's tone — casual if they're casual, detailed if they want depth. "
            "Don't pad responses with unnecessary disclaimers or filler."
        ),
        temperature=0.7,
        num_ctx=8192,
        num_predict=1024,
        fallbacks=[_GENERAL, _OPENCHAT, _LARGE],
    ),

    # ── 3. Writing & Literature ──────────────────────────────────────────────
    "hex-4.3-write": Variant(
        id="hex-4.3-write",
        label="HexaLLM Write",
        description="Creative writing, editing, storytelling, and literary analysis.",
        default_model=_GENERAL,
        routes=[],
        system_prompt=(
            "You are HexaLLM Write, a skilled writer and literary assistant. "
            "Help with creative writing, storytelling, poetry, essays, editing, and literary analysis. "
            "Adapt your voice to the genre and style the user asks for — literary, commercial, academic, or playful. "
            "For editing tasks, explain changes and preserve the author's voice. "
            "Be imaginative, specific, and avoid clichés."
        ),
        temperature=0.9,
        num_ctx=8192,
        num_predict=2048,
        fallbacks=[_LLAMA3, _LARGE, _CHAT],
    ),

    # ── 4. Deep reasoning & Analysis ────────────────────────────────────────
    "hex-6.0-reason": Variant(
        id="hex-6.0-reason",
        label="HexaLLM Reason",
        description="Deep analysis, research, strategy, and complex problem solving. Digs deeper when you ask for rigour.",
        default_model=_THINKING,
        routes=[
            RoutedModel(_THINKING_DEEP, "reasoning_deep"),  # "rigorous", "in depth", very long prompts
        ],
        system_prompt=(
            "You are HexaLLM Reason, an analytical assistant built for deep reasoning. "
            "Break complex problems into steps. State your assumptions explicitly. "
            "Weigh trade-offs, consider multiple perspectives, and flag uncertainty. "
            "Prefer correctness and thoroughness over speed. "
            "End every response with a clear, actionable conclusion."
        ),
        temperature=0.4,
        # 8k context keeps every tier (incl. the 14B coders) within the 12 GB
        # VRAM budget once the KV cache is included.
        num_ctx=8192,
        num_predict=4096,
        fallbacks=[_THINKING, _LARGE, _GENERAL],
    ),

    # ── 5. Prime ─────────────────────────────────────────────────────────────
    "hex-5.1-prime": Variant(
        id="hex-5.1-prime",
        label="HexaLLM Prime",
        description="Spreads work across all models. Routes each message to the best model for the job.",
        default_model=_LARGE,
        routes=[
            RoutedModel(_CODING_HEAVY, "code_heavy"),
            RoutedModel(_CODING, "code"),
            RoutedModel(_THINKING_DEEP, "reasoning_deep"),
            RoutedModel(_THINKING, "reasoning"),
        ],
        system_prompt=(
            "You are HexaLLM Prime, a versatile assistant. "
            "Match the depth and tone to what the user needs — concise for simple questions, "
            "detailed for complex ones. Write clean code, reason through problems step by step, "
            "and communicate clearly in plain language."
        ),
        temperature=0.6,
        num_ctx=8192,
        # Prime routes reasoning queries to deepseek-r1, whose <think> stream
        # shares this budget with the answer — give it room so the body isn't empty.
        num_predict=4096,
        fallbacks=[_GENERAL, _CHAT],
    ),

    # ── 6. Custom ────────────────────────────────────────────────────────────
    "hex-4.2-custom": Variant(
        id="hex-4.2-custom",
        label="HexaLLM Custom",
        description="Bring-your-own system prompt. Full control over the assistant's voice and behavior.",
        default_model=_GENERAL,
        routes=[],
        system_prompt="",  # user-supplied prompt used directly
        temperature=0.7,
        num_ctx=8192,
        num_predict=2048,
        fallbacks=[_LLAMA3, _LARGE, _CHAT],
    ),

    # ── 7. Vision ────────────────────────────────────────────────────────────
    "hex-4.1-vision": Variant(
        id="hex-4.1-vision",
        label="HexaLLM Vision",
        description="Understands images — screenshots, diagrams, charts, photos, UI mockups, handwriting.",
        default_model=_VISION,
        routes=[],
        system_prompt=(
            "You are HexaLLM Vision, a multimodal assistant that can see images. "
            "Describe and analyze what's in the image accurately and specifically. "
            "For screenshots/diagrams/UI, read text and structure precisely; for charts, "
            "report the actual values and trends; for code or errors in an image, transcribe "
            "and explain them. If the image is unclear, say what you can and can't make out."
        ),
        temperature=0.5,
        num_ctx=8192,
        num_predict=2048,
        # No text-only fallback: vision needs a vision model. If _VISION isn't
        # pulled the router raises a clear "pull one of: …" error.
        fallbacks=[],
    ),

    # ── 8. Math ─────────────────────────────────────────────────────────────
    "hex-4.2-math": Variant(
        id="hex-4.2-math",
        label="HexaLLM Math",
        description="Math-tuned model for equations, proofs, step-by-step problem solving, and data analysis.",
        default_model=_MATH,
        routes=[],
        system_prompt=(
            "You are HexaLLM Math, a specialised mathematics assistant. "
            "Solve problems step by step with clear reasoning. Use LaTeX notation "
            "for equations and mathematical expressions. Explain concepts thoroughly "
            "and show all working. If the problem involves code, use appropriate "
            "code blocks. For proofs, show each logical step."
        ),
        temperature=0.3,
        num_ctx=8192,
        num_predict=4096,
        fallbacks=[_LARGE, _GENERAL, _CHAT],
    ),
}


# Variants that allow the caller to supply their own system prompt.
# All other variants ignore req.system_prompt to preserve their branded voice.
USER_PROMPT_ALLOWED = {"hex-4.2-custom"}


def allows_user_prompt(variant_id: str) -> bool:
    return variant_id in USER_PROMPT_ALLOWED


def is_variant(model_id: str) -> bool:
    return model_id in VARIANTS


def get_variant(model_id: str) -> Optional[Variant]:
    return VARIANTS.get(model_id)


AUTO_VARIANT_ID = "hex-auto"


def _variant_available(vid: str, avail_lc: Dict[str, str]) -> bool:
    """True if at least one of the variant's candidate bases is pulled."""
    v = VARIANTS.get(vid)
    if not v:
        return False
    return any(c.lower() in avail_lc for c in v.all_candidates())


def _auto_sub_variant(user_text: str, available_models: List[str], has_image: bool = False) -> str:
    """Pick the best VARIANT for this prompt. Specific departments win over
    general ones; each choice is skipped when none of its bases is pulled, so
    Auto degrades gracefully on a partial Ollama install."""
    avail_lc = {m.lower(): m for m in available_models}

    code = looks_like_code(user_text)
    heavy_code = looks_like_heavy_code(user_text)
    reasoning = needs_reasoning(user_text)
    deep = needs_deep_reasoning(user_text)
    math = looks_like_math(user_text)

    prefs: List[str] = []
    if has_image:
        prefs.append("hex-4.1-vision")
    if math:
        prefs.append("hex-4.2-math")
    if deep:
        prefs.append("hex-6.0-reason")
    if heavy_code:
        prefs.append("hex-4.2-code")
    if code:
        prefs.append("hex-4.2-code")
    if reasoning:
        prefs.append("hex-6.0-reason")
    prefs += ["hex-4.2-turbo", "hex-5.1-prime"]

    for pid in prefs:
        if _variant_available(pid, avail_lc):
            return pid

    # Nothing in the preference chain is pulled — use any ready variant.
    for vid in VARIANTS:
        if vid != AUTO_VARIANT_ID and _variant_available(vid, avail_lc):
            return vid

    # route() raises a helpful "pull one of: …" error from here.
    return "hex-4.2-turbo"


def public_variants() -> List[Dict[str, str]]:
    """The variants as the UI should advertise them — id, label and a
    description with NO underlying Ollama model names. Safe to show to any
    user (the concrete bases are an admin/back-end concern)."""
    return [{"id": v.id, "label": v.label, "description": v.description} for v in VARIANTS.values()]


def concrete_for(model_id: str, user_text: str, available_models: List[str]) -> str:
    """Resolve a model selection to a concrete Ollama model.

    If `model_id` is a HexaLLM variant, route it (using `user_text` as the
    prompt hint) to the best available base. Non-variant ids pass through
    unchanged. Used by the agent / OpenAI-compat paths so a user can pick a
    variant anywhere, not just in chat."""
    if not is_variant(model_id):
        return model_id
    return route(model_id, user_text or "", available_models).chosen_model


def base_for_training(model_id: str) -> str:
    """Resolve a model selection to a single concrete base for fine-tuning.

    Variants route across several models per request, but training needs one
    fixed base — use the variant's default model. Non-variant ids pass
    through unchanged."""
    v = get_variant(model_id)
    return v.default_model if v else model_id


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
    routed_variant: Optional[str] = None  # set only for hex-auto: the variant actually used


def route(
    variant_id: str,
    user_text: str,
    available_models: List[str],
    has_image: bool = False,
) -> RouteDecision:
    """Pick the best concrete model for this variant + prompt.

    available_models is the list of models actually pulled in Ollama
    (names from `/api/tags`). We never route to a model the user hasn't pulled.
    """
    if variant_id == AUTO_VARIANT_ID:
        sub = _auto_sub_variant(user_text, available_models, has_image)
        inner = route(sub, user_text, available_models, has_image)
        return replace(inner, variant_id=AUTO_VARIANT_ID, routed_variant=sub)

    v = VARIANTS[variant_id]
    # Case-insensitive resolution: Ollama reports tags with inconsistent casing
    # (qwen2.5:7B vs deepseek-r1:32b), so resolve a desired name to the ACTUAL
    # available tag rather than requiring an exact-case match.
    avail_lc = {m.lower(): m for m in available_models}

    def resolve(name: str) -> Optional[str]:
        return avail_lc.get(name.lower())

    code = looks_like_code(user_text)
    heavy_code = looks_like_heavy_code(user_text)
    reasoning = needs_reasoning(user_text)
    deep = needs_deep_reasoning(user_text)

    def matches(condition: str) -> bool:
        if condition == "code_heavy":
            return heavy_code
        if condition == "code":
            return code
        if condition == "reasoning_deep":
            return deep
        if condition == "reasoning":
            return reasoning
        if condition == "default":
            return True
        return False

    chosen: Optional[str] = None
    reason = "default"

    # 1. Try the variant's explicit routes in order (first match wins).
    for r in v.routes:
        actual = resolve(r.name)
        if matches(r.condition) and actual:
            chosen = actual
            reason = r.condition
            break

    # 2. Fall back to the variant's default model.
    if chosen is None and resolve(v.default_model):
        chosen = resolve(v.default_model)
        reason = "default"

    # 3. Fall back to declared fallbacks in order.
    if chosen is None:
        for fb in v.fallbacks:
            if resolve(fb):
                chosen = resolve(fb)
                reason = f"fallback:{fb}"
                break

    # 4. Last resort: any candidate that exists.
    if chosen is None:
        for c in v.all_candidates():
            if resolve(c):
                chosen = resolve(c)
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
