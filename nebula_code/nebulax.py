"""
NebulaX platform client.

Provides LLM completions (via the OpenAI-compat endpoint),
knowledge base search, and agent-run syncing so CLI runs
appear in the NebulaX web UI history.
"""

import json
from typing import Dict, List, Optional

import httpx


class NebulaXClient:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._h = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    # ── LLM ─────────────────────────────────────────────────────────────────

    async def list_models(self) -> List[str]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{self.base_url}/api/v1/models/ollama/list", headers=self._h)
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]

    async def full_response(
        self,
        model: str,
        messages: List[Dict],
        system: str,
        temperature: float = 0.1,
    ) -> str:
        """Non-streaming completion via the OpenAI-compat endpoint."""
        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.extend(messages)

        payload = {
            "model": model,
            "messages": msgs,
            "temperature": temperature,
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=None) as c:
            r = await c.post(
                f"{self.base_url}/api/v1/openai/chat/completions",
                json=payload,
                headers=self._h,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    # ── Knowledge bases ──────────────────────────────────────────────────────

    def list_kbs_sync(self) -> List[Dict]:
        with httpx.Client(timeout=10) as c:
            r = c.get(f"{self.base_url}/api/v1/knowledge", headers=self._h)
            r.raise_for_status()
            return r.json()

    def search_kb_sync(self, kb_id: int, query: str, top_k: int = 5) -> str:
        with httpx.Client(timeout=30) as c:
            r = c.post(
                f"{self.base_url}/api/v1/knowledge/{kb_id}/query",
                json={"query": query, "top_k": top_k},
                headers=self._h,
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
        POST a completed agent run to NebulaX so it shows up in the
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
                    headers=self._h,
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
