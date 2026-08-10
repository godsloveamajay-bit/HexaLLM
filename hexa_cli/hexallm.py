"""
HexaLLM platform client + Pollinations free cloud backend.

Provides LLM completions (via the OpenAI-compat endpoint),
knowledge base search, and agent-run syncing so CLI runs
appear in the HexaLLM web UI history.
"""

import json
from typing import AsyncIterator, Dict, List, Optional

import httpx

from . import __version__


class HexaLLMClient:
    def __init__(self, base_url: str, token: str, api_key: Optional[str] = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.api_key = api_key
        self._h_user = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
    
    def _headers_for_llm(self) -> Dict[str, str]:
        """Return headers for LLM API calls (uses API key if available, else user token)."""
        if self.api_key:
            return {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }
        return self._h_user

    async def get_or_create_api_key(self) -> Optional[str]:
        """Get an existing API key or create one for CLI use."""
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                # Try to get existing keys
                r = await c.get(f"{self.base_url}/api/v1/auth/api-keys", headers=self._h_user)
                r.raise_for_status()
                keys = r.json()
                
                # Use first active key if available
                for key in keys:
                    if key.get("is_active"):
                        self.api_key = key.get("key")
                        return self.api_key
                
                # Create a new key if none exist
                payload = {"name": "HexaLLM CLI"}
                r = await c.post(f"{self.base_url}/api/v1/auth/api-keys", json=payload, headers=self._h_user)
                r.raise_for_status()
                key_data = r.json()
                self.api_key = key_data.get("key")
                return self.api_key
        except Exception as e:
            print(f"Warning: Could not get/create API key: {e}")
            return None

    # ── LLM ─────────────────────────────────────────────────────────────────

    async def list_models(self) -> List[str]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{self.base_url}/api/v1/models/ollama/list", headers=self._h_user)
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]

    async def stream_response(
        self,
        model: str,
        messages: List[Dict],
        system: str,
        temperature: float = 0.1,
    ) -> AsyncIterator[str]:
        """Token stream via the OpenAI-compat endpoint.

        Uses stream=True so Cloudflare sees a continuous byte flow and never
        hits its 100-second idle-connection timeout (524). Presence of this
        method lets the Agent render the answer live instead of buffering it.
        """
        msgs: List[Dict] = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.extend(messages)

        payload = {
            "model": model,
            "messages": msgs,
            "temperature": temperature,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=None) as c:
            async with c.stream(
                "POST",
                f"{self.base_url}/api/v1/openai/chat/completions",
                json=payload,
                headers=self._headers_for_llm(),
            ) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        content = chunk["choices"][0]["delta"].get("content", "")
                    except (json.JSONDecodeError, KeyError):
                        continue
                    if content:
                        yield content

    async def full_response(
        self,
        model: str,
        messages: List[Dict],
        system: str,
        temperature: float = 0.1,
    ) -> str:
        parts: List[str] = []
        async for chunk in self.stream_response(model, messages, system, temperature):
            parts.append(chunk)
        return "".join(parts)

    # ── Knowledge bases ──────────────────────────────────────────────────────

    def list_kbs_sync(self) -> List[Dict]:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{self.base_url}/api/v1/knowledge", headers=self._h_user)
            r.raise_for_status()
            return r.json()

    def search_kb_sync(self, kb_id: int, query: str, top_k: int = 5) -> str:
        with httpx.Client(timeout=30) as c:
            r = c.post(
                f"{self.base_url}/api/v1/knowledge/{kb_id}/query",
                json={"query": query, "top_k": top_k},
                headers=self._h_user,
            )
            r.raise_for_status()
            data = r.json()
            hits = data.get("hits", [])
            if not hits:
                return "No results found."
            lines = []
            for h in hits:
                lines.append(
                    f"[{h['document_filename']}  score={h['score']:.3f}]\n{h['content']}"
                )
            return "\n\n---\n\n".join(lines)

    # ── Agent run sync ───────────────────────────────────────────────────────

    def sync_run(
        self,
        task: str,
        model: str,
        tools: List[str],
        steps: List[Dict],
        result: Optional[str],
        error: Optional[str] = None,
    ) -> Optional[int]:
        """
        POST a completed agent run to HexaLLM so it shows up in the
        Agents page history.  Returns the saved run ID on success.
        """
        payload = {
            "task": task,
            "model": model,
            "tools": tools,
            "max_steps": len(steps),
        }
        try:
            with httpx.Client(timeout=15) as c:
                r = c.post(
                    f"{self.base_url}/api/v1/agents/run",
                    json=payload,
                    headers=self._h_user,
                )
                r.raise_for_status()
                return r.json().get("id")
        except Exception:
            return None

    # ── Auth ─────────────────────────────────────────────────────────────────

    @staticmethod
    async def login(base_url: str, email: str, password: str) -> str:
        """Authenticate with email + password, return JWT."""
        payload = {"email": email, "password": password}
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                f"{base_url.rstrip('/')}/api/v1/auth/login",
                json=payload,
            )
            r.raise_for_status()
            return r.json()["access_token"]

    @staticmethod
    async def verify(base_url: str, token: str) -> Optional[Dict]:
        """Return user info if token is valid, else None."""
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                r = await c.get(
                    f"{base_url.rstrip('/')}/api/v1/auth/me",
                    headers={"Authorization": f"Bearer {token}"},
                )
                if r.status_code == 200:
                    return r.json()
        except Exception:
            pass
        return None


class PollinationsClient:
    """
    Free cloud LLM backend via Pollinations.ai — no API key required.

    Exposes the same list_models / full_response interface as OllamaClient
    so the Agent can use it as a drop-in replacement.
    """

    BASE = "https://text.pollinations.ai"
    DEFAULT_MODEL = "openai"
    MODELS = [
        "openai",        # GPT-4o — best for ReAct JSON format
        "openai-large",  # GPT-4o turbo
        "mistral",       # Mistral Large
        "llama",         # Llama 3
        "qwen-coder",    # Qwen Coder — strong at code tasks
    ]

    async def list_models(self) -> List[str]:
        return list(self.MODELS)

    async def stream_response(
        self,
        model: str,
        messages: List[Dict],
        system: str,
        temperature: float = 0.1,
    ) -> AsyncIterator[str]:
        """Token stream via Pollinations' OpenAI-compat SSE. Presence of this
        method lets the Agent render the answer live instead of buffering it."""
        msgs: List[Dict] = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.extend(messages)

        payload = {
            "model": model,
            "messages": msgs,
            "temperature": temperature,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=None) as c:
            async with c.stream(
                "POST",
                f"{self.BASE}/",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": f"HexaLLM/{__version__}",
                },
            ) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        content = chunk["choices"][0]["delta"].get("content", "")
                    except (json.JSONDecodeError, KeyError):
                        continue
                    if content:
                        yield content

    async def full_response(
        self,
        model: str,
        messages: List[Dict],
        system: str,
        temperature: float = 0.1,
    ) -> str:
        parts: List[str] = []
        async for chunk in self.stream_response(model, messages, system, temperature):
            parts.append(chunk)
        return "".join(parts)
