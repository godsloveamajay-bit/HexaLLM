import json
import re
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

SYSTEM_PROMPT = """\
You are NebulaCode, an expert AI coding assistant running in the terminal.
You help users read, write, debug, and understand code in any language.

You have access to these tools:
{tools}

STRICT OUTPUT FORMAT — every reply must be ONLY a JSON object, no markdown fences, no other text:
  Use a tool:   {{"thought": "<why>", "tool": "<name>", "input": "<input>"}}
  Final answer: {{"thought": "<why>", "tool": "done",   "input": "<your full response to the user>"}}

Coding workflow:
1. Start by exploring the project (list_files, read_file) before making any changes.
2. Make changes with write_file or patch_file (prefer patch_file for small edits).
3. Verify with run_command (tests, linter, build step).
4. Summarise what you did in the "done" response.

If the user asks a simple question, answer immediately with "done".
"""

FIX_PROMPT = (
    "Your reply was not valid JSON. Reply with ONLY a JSON object — no backticks, no other text:\n"
    '{"thought": "...", "tool": "<tool or done>", "input": "..."}'
)


def _extract_json(text: str) -> Optional[dict]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # strip code fences
    stripped = re.sub(r"```(?:json)?\s*|\s*```", "", text).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    # balanced-brace scan
    start = text.find("{")
    if start != -1:
        depth, in_str, esc = 0, False, False
        for i, ch in enumerate(text[start:], start):
            if esc:
                esc = False
                continue
            if ch == "\\" and in_str:
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
    return None


class OllamaClient:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url.rstrip("/")

    async def list_models(self) -> List[str]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{self.base_url}/api/tags")
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]

    async def _stream_raw(
        self,
        model: str,
        messages: List[Dict],
        system: str,
        temperature: float,
    ) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": messages,
            "system": system,
            "stream": True,
            "options": {"temperature": temperature},
        }
        async with httpx.AsyncClient(timeout=None) as c:
            async with c.stream("POST", f"{self.base_url}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    chunk = data.get("message", {}).get("content", "")
                    if chunk:
                        yield chunk
                    if data.get("done"):
                        break

    async def full_response(
        self,
        model: str,
        messages: List[Dict],
        system: str,
        temperature: float = 0.1,
    ) -> str:
        text = ""
        async for chunk in self._stream_raw(model, messages, system, temperature):
            text += chunk
        return text


class Agent:
    """
    ReAct agent with persistent conversation history.

    Accepts either an OllamaClient or a NebulaXClient as the LLM backend —
    both expose the same `full_response(model, messages, system, temperature)`
    and `list_models()` interface.

    Yields events consumed by the CLI:
      {"type": "tool",  "name": str, "input": str, "output": str, "thought": str}
      {"type": "done",  "text": str, "steps": List[Dict]}
      {"type": "error", "text": str}
    """

    def __init__(
        self,
        model: str,
        ollama_url: str = "http://localhost:11434",
        max_steps: int = 20,
        temperature: float = 0.1,
        backend=None,          # OllamaClient or NebulaXClient; overrides ollama_url
    ) -> None:
        self.model = model
        self.backend = backend if backend is not None else OllamaClient(ollama_url)
        self.max_steps = max_steps
        self.temperature = temperature
        self.history: List[Dict[str, str]] = []

    async def run(
        self,
        user_message: str,
        tool_funcs: Dict[str, Any],
        tool_descriptions: Dict[str, str],
    ) -> AsyncIterator[Dict]:
        tool_list = "\n".join(f"  {k}: {v}" for k, v in tool_descriptions.items())
        system = SYSTEM_PROMPT.format(tools=tool_list)

        self.history.append({"role": "user", "content": user_message})
        messages = list(self.history)
        run_steps: List[Dict] = []
        tools_used: List[str] = []

        for step_num in range(self.max_steps):
            raw = await self.backend.full_response(
                self.model, messages, system, self.temperature
            )
            parsed = _extract_json(raw)

            if not parsed:
                fix_msgs = messages + [
                    {"role": "assistant", "content": raw or "(empty)"},
                    {"role": "user", "content": FIX_PROMPT},
                ]
                raw = await self.backend.full_response(
                    self.model, fix_msgs, system, self.temperature
                )
                parsed = _extract_json(raw)
                if not parsed:
                    yield {"type": "error", "text": f"Invalid JSON from model:\n{raw[:400]}"}
                    return

            messages.append({"role": "assistant", "content": raw})

            tool_name  = parsed.get("tool", "")
            tool_input = str(parsed.get("input", ""))
            thought    = parsed.get("thought", "")

            if tool_name == "done":
                answer = tool_input
                self.history.append({"role": "assistant", "content": answer})
                run_steps.append({"step": step_num + 1, "thought": thought, "tool": "done", "input": tool_input, "output": None})
                yield {
                    "type": "done",
                    "text": answer,
                    "thought": thought,
                    "steps": run_steps,
                    "tools_used": list(set(tools_used)),
                }
                return

            if tool_name in tool_funcs:
                try:
                    output = tool_funcs[tool_name](tool_input)
                except Exception as e:
                    output = f"Tool error: {e}"
            else:
                output = f"Unknown tool '{tool_name}'. Available: {', '.join(tool_funcs)}"

            tools_used.append(tool_name)
            run_steps.append({
                "step": step_num + 1,
                "thought": thought,
                "tool": tool_name,
                "input": tool_input,
                "output": output,
            })
            yield {
                "type":    "tool",
                "name":    tool_name,
                "input":   tool_input,
                "output":  output,
                "thought": thought,
            }

            messages.append({"role": "user", "content": f"Tool result:\n{output}"})

        yield {"type": "error", "text": "Reached max steps without finishing."}
