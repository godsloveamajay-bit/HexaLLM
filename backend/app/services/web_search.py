"""Web search for chat grounding.

Multi-provider with graceful degradation — returns the first source that yields
results, so chat web-search works out of the box (keyless via Wikipedia) and gets
better if an API key is configured:

  1. Tavily        — full web search, if TAVILY_API_KEY is set (best quality)
  2. DuckDuckGo    — keyless; works on networks DDG hasn't rate-limited
  3. Wikipedia     — keyless, reliable encyclopedic fallback (compliant UA)

Each result: {"title", "snippet", "url"}. Never raises — a failed search just
returns [] and the chat answers without grounding.
"""
from __future__ import annotations

import asyncio
import html
import os
import re
from typing import Dict, List

import httpx

_UA = "NebulaX-AI (https://ai.nebualax.co.uk; self-hosted AI assistant)"
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    return html.unescape(_TAG_RE.sub("", text or "")).strip()


async def _tavily(query: str, n: int) -> List[Dict]:
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as c:
            r = await c.post(
                "https://api.tavily.com/search",
                json={"api_key": key, "query": query, "max_results": n,
                      "search_depth": "basic"},
            )
            r.raise_for_status()
            return [
                {"title": x.get("title", ""), "snippet": x.get("content", ""), "url": x.get("url", "")}
                for x in r.json().get("results", [])
            ]
    except Exception:
        return []


async def _ddgs(query: str, n: int) -> List[Dict]:
    def _run() -> List[Dict]:
        try:
            from duckduckgo_search import DDGS
            with DDGS() as d:
                return [
                    {"title": r.get("title", ""), "snippet": r.get("body", ""), "url": r.get("href", "")}
                    for r in d.text(query, max_results=n)
                ]
        except Exception:
            return []
    try:
        return await asyncio.wait_for(asyncio.to_thread(_run), timeout=15)
    except Exception:
        return []


async def _wikipedia(query: str, n: int) -> List[Dict]:
    try:
        async with httpx.AsyncClient(timeout=15, trust_env=False, headers={"User-Agent": _UA}) as c:
            r = await c.get(
                "https://en.wikipedia.org/w/rest.php/v1/search/page",
                params={"q": query, "limit": n},
            )
            r.raise_for_status()
            out: List[Dict] = []
            for p in r.json().get("pages", []):
                title = p.get("title", "")
                desc = _clean(p.get("description") or "")
                exc = _clean(p.get("excerpt") or "")
                snippet = " — ".join(s for s in (desc, exc) if s) or title
                out.append({
                    "title": title,
                    "snippet": snippet,
                    "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                })
            return out
    except Exception:
        return []


async def search_web(query: str, max_results: int = 5) -> List[Dict]:
    query = (query or "").strip()[:400]
    if not query:
        return []
    for provider in (_tavily, _ddgs, _wikipedia):
        results = await provider(query, max_results)
        if results:
            return results[:max_results]
    return []


def format_context(results: List[Dict]) -> str:
    """Render results as a numbered context block for the system prompt.

    Worded forcefully on purpose: many local models are trained to insist they
    "can't browse the internet" and cite a knowledge cutoff. The directive below
    overrides that prior and grounds them in today's date + the live results.
    """
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).strftime("%B %d, %Y")
    parts = [f"[{i}] {r['title']}\n{r['snippet']}\nSource: {r['url']}" for i, r in enumerate(results, 1)]
    return (
        f"You have been given LIVE web search results, retrieved from the internet just now. "
        f"Today's date is {today}.\n"
        "Use these results to answer the question with current, up-to-date information and cite "
        "sources inline as [1], [2], …\n"
        "IMPORTANT: You DO have access to these fresh results — do NOT claim you cannot browse the "
        "internet, and do NOT mention a training-data knowledge cutoff. If the results don't fully "
        "answer the question, use what they do contain and say what's missing.\n\n"
        "--- WEB SEARCH RESULTS ---\n" + "\n\n".join(parts) + "\n--- END WEB SEARCH RESULTS ---"
    )
