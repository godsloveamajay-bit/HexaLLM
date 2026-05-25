import httpx
import json
from typing import AsyncGenerator, List, Dict, Optional
from ..core.config import settings


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
    ) -> AsyncGenerator[str, None]:
        # Ollama's /api/chat takes system messages via the messages array,
        # NOT a top-level "system" field (that's only for /api/generate).
        # Prepend a system message if a prompt was supplied AND the caller
        # hasn't already included one.
        if system_prompt and not (messages and messages[0].get("role") == "system"):
            messages = [{"role": "system", "content": system_prompt}] + list(messages)

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

        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=10.0)
        async with self._client(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload,
            ) as resp:
                async for line in resp.aiter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            content = data.get("message", {}).get("content", "")
                            if content:
                                yield content
                            if data.get("done"):
                                if usage is not None:
                                    usage["prompt_tokens"] = data.get("prompt_eval_count", 0)
                                    usage["completion_tokens"] = data.get("eval_count", 0)
                                break
                        except json.JSONDecodeError:
                            continue

    async def generate(self, model: str, prompt: str, temperature: float = 0.7) -> str:
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

    async def health_check(self) -> bool:
        async with self._client(timeout=5) as client:
            try:
                resp = await client.get(f"{self.base_url}/api/tags")
                return resp.status_code == 200
            except Exception:
                return False


ollama = OllamaService()
