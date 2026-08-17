import httpx
import json
import os
from typing import AsyncGenerator, List, Dict, Optional
from ..core.config import settings


# Per-model GPU layer budget (CPU-RAM offload for big models). The 12GB VRAM
# can hold the 7B/8B chat models at full GPU, but the 14B (~9.3GB) evicts
# them. Setting a layer count here keeps the big model resident (RAM for the
# rest) alongside ONE small model — at ~2× slower generation. Measured on
# this box: CPU-only 14B ≈ 0.6 tok/s (unusable); half-offload ≈ 7 tok/s;
# full GPU ≈ 30-40 tok/s. Default empty = full GPU for everything (best
# single-model latency; mixed traffic pays occasional cold loads).
# Override via env: OLLAMA_NUM_GPU_OFFLOAD='{"qwen3:14b": 20}'
_NUM_GPU_OFFLOAD: Dict[str, Optional[int]] = {}
try:
    _NUM_GPU_OFFLOAD = json.loads(os.environ.get("OLLAMA_NUM_GPU_OFFLOAD") or "{}")
except (ValueError, TypeError):
    pass

# Models served by vLLM (OpenAI-compatible, /v1/chat/completions) instead of
# ollama — the fast default tier. vLLM keeps them resident with continuous
# batching (measured ~4× better p95 under 10 concurrent users); ollama keeps
# the heavy tiers. Keys are the ollama-side model names the router resolves.
_VLLM_MODELS: Dict[str, str] = {"qwen2.5:7b": "hexa-vllm"}
_VLLM_BASE_URL: str = settings.VLLM_BASE_URL


class OllamaService:
    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL

    def _client(self, **kwargs) -> httpx.AsyncClient:
        # trust_env=False prevents httpx from picking up proxy env vars (ALL_PROXY, etc.)
        return httpx.AsyncClient(trust_env=False, **kwargs)

    async def list_models(self) -> List[Dict]:
        async with self._client(timeout=10) as client:
            try:
                resp = await client.get(f"{self.base_url}/api/tags")
                resp.raise_for_status()
                return resp.json().get("models", [])
            except Exception:
                return []

    async def is_loaded(self, model: str) -> bool:
        """True if `model` is currently resident in memory (no cold-load needed).

        Checks Ollama's /api/ps. Used so the chat endpoint can warn the UI when a
        request will trigger a slow cold-load (minutes on this CPU-only box).
        vLLM-served models are always resident.
        """
        if model in _VLLM_MODELS:
            return True
        async with self._client(timeout=5) as client:
            try:
                resp = await client.get(f"{self.base_url}/api/ps")
                resp.raise_for_status()
                return any(m.get("name") == model for m in resp.json().get("models", []))
            except Exception:
                # If we can't tell, assume loaded so we don't show a spurious warning.
                return True

    async def pull_model(self, model_name: str) -> AsyncGenerator[str, None]:
        async with self._client(timeout=300) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/pull",
                json={"name": model_name},
            ) as resp:
                async for line in resp.aiter_lines():
                    if line:
                        yield line

    async def delete_model(self, model_name: str) -> bool:
        async with self._client(timeout=30) as client:
            try:
                resp = await client.delete(
                    f"{self.base_url}/api/delete",
                    json={"name": model_name},
                )
                return resp.status_code == 200
            except Exception:
                return False

    async def chat_stream(
        self,
        model: str,
        messages: List[Dict],
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        num_ctx: Optional[int] = None,
        images: Optional[List[str]] = None,
        usage: Optional[Dict] = None,
        think: Optional[bool] = None,
        top_p: Optional[float] = None,
        extra_options: Optional[Dict] = None,
        format: Optional[Dict] = None,
    ) -> AsyncGenerator[str, None]:
        # moondream's sampler on this ollama build degenerates to an EMPTY stream
        # for temperatures 0.6/0.7 (everything else works). Snap them so image
        # chats actually answer instead of streaming nothing.
        if "moondream" in model.lower() and temperature in (0.6, 0.7):
            temperature = 0.8
        # Ollama's /api/chat takes system messages via the messages array,
        # NOT a top-level "system" field (that's only for /api/generate).
        # Prepend a system message if a prompt was supplied AND the caller
        # hasn't already included one.
        if system_prompt and not (messages and messages[0].get("role") == "system"):
            messages = [{"role": "system", "content": system_prompt}] + list(messages)

        # Fast-tier models (qwen2.5:7b) are served by vLLM — delegate the
        # whole stream there. Same chunk contract as ollama's (content
        # strings + usage dict fill-in), so callers can't tell the engine.
        vllm_name = _VLLM_MODELS.get(model)
        if vllm_name and not images:
            async for chunk in self._vllm_chat_stream(
                vllm_name, messages, temperature, max_tokens, top_p, usage,
                format=format,
            ):
                yield chunk
            return

        # Attach images to the last user message for multimodal models
        if images:
            messages = list(messages)
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get("role") == "user":
                    messages[i] = {**messages[i], "images": images}
                    break

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {"temperature": temperature},
        }
        if max_tokens:
            payload["options"]["num_predict"] = max_tokens
        if num_ctx:
            payload["options"]["num_ctx"] = num_ctx
        if top_p is not None:
            payload["options"]["top_p"] = top_p
        if extra_options:
            payload["options"].update(extra_options)
        # Structured output: OpenAI-style response_format spec →
        # ollama's `format` field ("json" or a JSON-schema dict; regex isn't
        # supported by ollama, so it's dropped — the model just answers free-form).
        # OpenAI wraps the schema as {"name": ..., "schema": {...}} — ollama
        # wants the bare schema, so unwrap it.
        if format:
            fmt_type = format.get("type")
            if fmt_type == "json_object":
                payload["format"] = "json"
            elif fmt_type == "json_schema":
                js = format.get("json_schema") or {}
                schema = js.get("schema") if isinstance(js, dict) and "schema" in js else js
                payload["format"] = schema or "json"
        # Big models (>~9GB) that can't co-reside in the 12GB VRAM with the
        # fast chat models get HALF their layers offloaded to CPU RAM. They run
        # ~2× slower than full-GPU but stay resident alongside the 7B/8B models
        # (OLLAMA_KEEP_ALIVE=-1), so mixed traffic never pays a 10-20s reload.
        num_gpu = _NUM_GPU_OFFLOAD.get(model)
        if num_gpu is not None:
            payload["options"]["num_gpu"] = num_gpu
        # think=False suppresses chain-of-thought on reasoning models (deepseek-r1,
        # qwen3) so trivial inputs answer instantly instead of reasoning for minutes.
        # Leave it unset (None) for normal queries / non-reasoning models.
        if think is not None:
            payload["think"] = think
        # Structured output with a reasoning model: the format constraint only
        # binds the final response, so chain-of-thought just burns the output
        # budget (and pollutes the stream with  thinking wrappers the JSON
        # consumer has to strip). Suppress it unless the caller asked explicitly.
        if format and think is None and any(t in model.lower() for t in ("qwen3", "deepseek", "r1")):
            payload["think"] = False

        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        async with self._client(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload,
            ) as resp:
                # Reasoning models (deepseek-r1) return their chain-of-thought in a
                # separate `message.thinking` field, NOT as <think> tags in content.
                # Re-wrap it as <think>…</think> in the token stream so the frontend
                # Thought Drawer (splitThink) folds it into "Agent Thinking…" and the
                # body shows only the clean answer.
                think_open = False
                async for line in resp.aiter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            msg = data.get("message", {})
                            thinking = msg.get("thinking", "")
                            if thinking:
                                if not think_open:
                                    yield "<think>"
                                    think_open = True
                                yield thinking
                            content = msg.get("content", "")
                            if content:
                                if think_open:
                                    yield "</think>"
                                    think_open = False
                                yield content
                            if data.get("done"):
                                if think_open:  # close an answer-less reasoning stream
                                    yield "</think>"
                                    think_open = False
                                if usage is not None:
                                    usage["prompt_tokens"] = data.get("prompt_eval_count", 0)
                                    usage["completion_tokens"] = data.get("eval_count", 0)
                                break
                        except json.JSONDecodeError:
                            continue

    async def generate(self, model: str, prompt: str, temperature: float = 0.7) -> str:
        vllm_name = _VLLM_MODELS.get(model)
        if vllm_name:
            return await self._vllm_complete(
                vllm_name, [{"role": "user", "content": prompt}], temperature,
            )
        async with self._client(timeout=120) as client:
            resp = await client.post(
                f"{self.base_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False, "options": {"temperature": temperature}},
            )
            resp.raise_for_status()
            return resp.json().get("response", "")

    async def generate_title(self, model: str, user_message: str) -> str:
        """Generate a short conversation title using the model. Limits tokens for speed."""
        prompt = (
            f"/nothink\nGenerate a short title (4-6 words) for a chat that starts with:\n"
            f'"{user_message[:300]}"\n'
            "Reply with ONLY the title. No quotes. No punctuation at the end."
        )
        vllm_name = _VLLM_MODELS.get(model)
        if vllm_name:
            raw = await self._vllm_complete(
                vllm_name, [{"role": "user", "content": prompt}], 0.3, max_tokens=20,
            )
            return raw.strip().strip('"\'')
        timeout = httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0)
        async with self._client(timeout=timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 20},
                },
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "").strip()
            # Strip surrounding quotes if the model added them
            return raw.strip('"\'').strip()

    async def create_modelfile(self, name: str, modelfile: str) -> bool:
        async with self._client(timeout=60) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/api/create",
                    json={"name": name, "modelfile": modelfile},
                )
                return resp.status_code == 200
            except Exception:
                return False

    async def embed(self, model: str, text: str) -> List[float]:
        """Get an embedding vector for a single string."""
        async with self._client(timeout=60) as client:
            resp = await client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": model, "prompt": text},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("embedding", [])

    async def embed_batch(self, model: str, texts: List[str]) -> List[List[float]]:
        """Embed many texts. Ollama's embeddings endpoint is single-input, so call sequentially."""
        out: List[List[float]] = []
        for t in texts:
            out.append(await self.embed(model, t))
        return out

    async def _vllm_chat_stream(
        self,
        model: str,
        messages: List[Dict],
        temperature: float,
        max_tokens: Optional[int],
        top_p: Optional[float],
        usage: Optional[Dict],
        format: Optional[Dict] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream a chat completion from vLLM's OpenAI-compatible API.

        Yields the same content strings (and fills `usage` the same way) as the
        ollama /api/chat stream, so every caller sees one uniform interface.
        """
        payload: Dict = {
            "model": model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "temperature": temperature,
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens
        if top_p is not None:
            payload["top_p"] = top_p
        # Structured output: vLLM accepts json_object / json_schema via the
        # OpenAI response_format field. "regex" isn't a valid response_format
        # type on this vLLM build (0.19.x) — use the guided_regex extension.
        if format:
            fmt_type = format.get("type")
            if fmt_type in ("json_object", "json_schema"):
                payload["response_format"] = format
            elif fmt_type == "regex":
                payload["guided_regex"] = format.get("regex")
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        async with self._client(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{_VLLM_BASE_URL}/v1/chat/completions",
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[len("data: "):].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    # vLLM ends the stream with a usage-only chunk (choices: []).
                    # Consume it for the usage dict and move on.
                    choices = chunk.get("choices") or []
                    if not choices:
                        if usage is not None and chunk.get("usage"):
                            u = chunk["usage"]
                            usage["prompt_tokens"] = u.get("prompt_tokens", 0)
                            usage["completion_tokens"] = u.get("completion_tokens", 0)
                        continue
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                    if usage is not None and chunk.get("usage"):
                        u = chunk["usage"]
                        usage["prompt_tokens"] = u.get("prompt_tokens", 0)
                        usage["completion_tokens"] = u.get("completion_tokens", 0)

    async def _vllm_complete(
        self, model: str, messages: List[Dict], temperature: float, max_tokens: Optional[int] = None
    ) -> str:
        """Non-streaming chat completion from vLLM (titles, greetings, etc.)."""
        payload: Dict = {
            "model": model,
            "messages": messages,
            "stream": False,
            "temperature": temperature,
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens
        async with self._client(timeout=120) as client:
            resp = await client.post(f"{_VLLM_BASE_URL}/v1/chat/completions", json=payload)
            resp.raise_for_status()
            return resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")

    async def health_check(self) -> bool:
        async with self._client(timeout=5) as client:
            try:
                resp = await client.get(f"{self.base_url}/api/tags")
                return resp.status_code == 200
            except Exception:
                return False


ollama = OllamaService()
