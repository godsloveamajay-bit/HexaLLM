import json
import re
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

SYSTEM_PROMPT = """\
You are HexaLLM, an expert AI coding assistant running in the terminal.
You help users read, write, debug, and understand code in any language.

AVAILABLE TOOLS (use ONLY these exact names):
{tools}

OUTPUT FORMAT RULES — follow exactly every time:
1. Reply with ONE JSON object only. No markdown, no prose, no extra text.
2. The "tool" field must be one of the tool names above, or "done".
3. The "input" field must ALWAYS be a STRING (never an object or array).
   - For tools that take structured data (write_file, search_files, ssh_run), put JSON inside the string.
4. Use "done" to give the final answer — put your reply text inside "input".

Examples:
  {{"thought": "List project files first", "tool": "list_files", "input": "."}}
  {{"thought": "Answer directly", "tool": "done", "input": "The answer is 42."}}
  {{"thought": "Greet user", "tool": "done", "input": "Hello! I'm HexaLLM. What would you like me to help with today?"}}

Rules:
- "input" for "done" must contain your actual reply text — never leave it empty.
- Use "done" for greetings, simple questions, and final answers.
- Only use tools when you need to read/write files, run commands, or search.

Coding workflow:
1. Explore first (list_files, read_file) before editing.
2. Edit with write_file or patch_file (prefer patch_file for small changes).
3. Verify with run_command.
4. Finish with "done" summarising what changed.
"""

FIX_PROMPT = (
    "Your last reply was not valid JSON or used a wrong tool name. "
    "Reply with ONLY a valid JSON object using one of the allowed tools or 'done':\n"
    '{"thought": "...", "tool": "done", "input": "your answer here"}'
)


def _extract_json(text: str) -> Optional[dict]:
    text = text.strip()
    # Reasoning models (qwen3, deepseek-r1) wrap their chain-of-thought in
    # <think>...</think> before the real answer. That block frequently contains
    # JSON-like braces, which would derail the balanced-brace scan below, so
    # strip it (and any unclosed leading <think>) before parsing.
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    if text.startswith("<think>"):
        # Unclosed think block (truncated/streamed) — drop everything up to the
        # first real JSON object if there is one.
        brace = text.find("{")
        text = text[brace:].strip() if brace != -1 else ""
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

    def stream_response(
        self,
        model: str,
        messages: List[Dict],
        system: str,
        temperature: float = 0.1,
    ) -> AsyncIterator[str]:
        """Public token stream. Presence of this method signals the Agent that
        it can render the final answer live instead of buffering it."""
        return self._stream_raw(model, messages, system, temperature)


def _looks_like_tool_attempt(raw: str) -> bool:
    """True if the reply was *trying* to use the JSON tool protocol (so a
    malformed parse deserves a fix retry) rather than just answering in prose."""
    t = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    t = re.sub(r"^```(?:json)?|```$", "", t).strip()
    return t.startswith("{") or '"tool"' in t


class _LiveAnswer:
    """Streams the user-facing answer out of a model reply as it generates.

    Qwen-Coder & friends produce the answer in one of two shapes:
      • Protocol JSON — {"thought":..,"tool":"done","input":"<answer>"} — where
        the decoded `input` is the answer. Non-`done` tool calls carry no answer.
      • Direct prose/markdown — the model ignores the JSON wrapper and just
        writes the code/answer. This is common and, crucially, made the old
        agent throw the whole reply away and regenerate it as JSON (a second
        full pass — minutes wasted on a CPU box). We now detect it and stream
        the reply straight through as the final answer.

    Classification happens once, after the first real content char arrives
    (past any leading whitespace / <think> block / ``` fence). `mode` then
    drives the caller: "prose" => accept raw as the answer (no fix retry);
    "json" => parse normally. `emitted` is everything surfaced to the user.
    """

    _THINK_CLOSE = "</think>"
    _TOOL_RE = re.compile(r'"tool"\s*:\s*"([^"]*)"')
    _INPUT_RE = re.compile(r'"input"\s*:\s*"')
    _ESC = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f"}

    def __init__(self) -> None:
        self.buf = ""
        self.mode: Optional[str] = None      # None | "json" | "prose"
        self.emitted = ""                    # everything surfaced to the user
        # json-mode state
        self.is_done: Optional[bool] = None
        self.cursor: Optional[int] = None
        self.closed = False
        # prose-mode state
        self._prose_at = 0

    def _content_start(self) -> Optional[int]:
        """Index of the first real content char (past whitespace + <think>),
        or None if not yet determinable."""
        b = self.buf
        i = 0
        while i < len(b) and b[i].isspace():
            i += 1
        if b[i : i + 7] == "<think>":
            end = b.find(self._THINK_CLOSE, i)
            if end == -1:
                return None  # still inside the think block
            i = end + len(self._THINK_CLOSE)
            while i < len(b) and b[i].isspace():
                i += 1
        return i if i < len(b) else None

    def feed(self, chunk: str) -> str:
        """Append a raw chunk; return the answer delta to display (may be '')."""
        self.buf += chunk
        if self.closed:
            return ""
        if self.mode is None:
            cs = self._content_start()
            if cs is None:
                return ""
            if self.buf[cs] == "{":
                self.mode = "json"
            elif self.buf[cs : cs + 3] == "```":
                nl = self.buf.find("\n", cs)
                if nl == -1:
                    return ""  # wait for the full fence line to classify it
                lang = self.buf[cs + 3 : nl].strip().lower()
                if lang == "json":
                    self.mode = "json"
                else:
                    self.mode, self._prose_at = "prose", cs
            else:
                self.mode, self._prose_at = "prose", cs
        if self.mode == "prose":
            out = self.buf[self._prose_at :]
            self._prose_at = len(self.buf)
            self.emitted += out
            return out
        return self._feed_json()

    def _feed_json(self) -> str:
        if self.is_done is None:
            m = self._TOOL_RE.search(self.buf)
            if not m:
                return ""
            self.is_done = m.group(1) == "done"
        if not self.is_done:
            return ""
        if self.cursor is None:
            m = self._INPUT_RE.search(self.buf)
            if not m:
                return ""
            self.cursor = m.end()
        out: List[str] = []
        i, buf, n = self.cursor, self.buf, len(self.buf)
        while i < n:
            ch = buf[i]
            if ch == "\\":
                if i + 1 >= n:
                    break  # escape char not arrived yet — wait for next chunk
                nxt = buf[i + 1]
                if nxt == "u":
                    if i + 6 > n:
                        break  # \uXXXX not fully arrived
                    try:
                        out.append(chr(int(buf[i + 2 : i + 6], 16)))
                    except ValueError:
                        out.append(nxt)
                    i += 6
                    continue
                out.append(self._ESC.get(nxt, nxt))
                i += 2
                continue
            if ch == '"':
                self.closed = True  # unescaped quote closes the answer string
                i += 1
                break
            out.append(ch)
            i += 1
        self.cursor = i
        s = "".join(out)
        self.emitted += s
        return s


class Agent:
    """
    ReAct agent with persistent conversation history.

    Accepts either an OllamaClient or a HexaLLMClient as the LLM backend —
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
        backend=None,          # OllamaClient or HexaLLMClient; overrides ollama_url
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

        can_stream = hasattr(self.backend, "stream_response")

        for step_num in range(self.max_steps):
            streamed = ""
            streamer = _LiveAnswer()
            if can_stream:
                # Stream tokens live: the final answer (JSON `done` input OR a
                # direct prose reply) is surfaced as it generates instead of the
                # whole reply buffering silently for minutes on this CPU box.
                raw = ""
                async for chunk in self.backend.stream_response(
                    self.model, messages, system, self.temperature
                ):
                    raw += chunk
                    delta = streamer.feed(chunk)
                    if delta:
                        streamed += delta
                        yield {"type": "answer_chunk", "text": delta}
            else:
                raw = await self.backend.full_response(
                    self.model, messages, system, self.temperature
                )
                streamer.feed(raw)  # classify (no live output on this backend)

            # Direct prose/markdown reply: the model answered without the JSON
            # wrapper. Accept it as the final answer instead of burning a second
            # full generation to coerce JSON (the old behaviour, ~2x slower).
            if streamer.mode == "prose" or (
                _extract_json(raw) is None and not _looks_like_tool_attempt(raw)
            ):
                answer = (streamer.emitted if streamer.mode == "prose" else raw).strip() \
                    or "(No response generated — try rephrasing your request.)"
                self.history.append({"role": "assistant", "content": answer})
                run_steps.append({"step": step_num + 1, "thought": "", "tool": "done", "input": answer, "output": None})
                yield {
                    "type": "done",
                    "text": answer,
                    "thought": "",
                    "steps": run_steps,
                    "tools_used": list(set(tools_used)),
                    "streamed": bool(streamed),
                }
                return

            parsed = _extract_json(raw)

            if not parsed:
                # Looked like a (malformed) tool attempt — retry for valid JSON.
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
            _raw_input = parsed.get("input", "")
            # Model sometimes sends input as a JSON object instead of a string.
            # Normalise to a string so tools receive consistent input.
            if isinstance(_raw_input, (dict, list)):
                tool_input = json.dumps(_raw_input)
            else:
                tool_input = str(_raw_input)
            thought    = parsed.get("thought", "")

            if tool_name == "done":
                # Guard against the model returning an empty "done" response.
                answer = tool_input or thought or "(No response generated — try rephrasing your request.)"
                self.history.append({"role": "assistant", "content": answer})
                run_steps.append({"step": step_num + 1, "thought": thought, "tool": "done", "input": tool_input, "output": None})
                yield {
                    "type": "done",
                    "text": answer,
                    "thought": thought,
                    "steps": run_steps,
                    "tools_used": list(set(tools_used)),
                    # True when the answer was already emitted via answer_chunk
                    # events, so the CLI can finalize instead of re-printing.
                    "streamed": bool(streamed),
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
