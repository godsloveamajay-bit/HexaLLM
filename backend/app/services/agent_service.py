import re
import json
import asyncio
import subprocess
import tempfile
import os
from typing import List, Dict, Any, Optional
from .ollama_service import ollama


TOOL_DESCRIPTIONS = {
    "web_search": "Search the web for current information. Input: search query string.",
    "code_exec": "Execute Python code and return stdout. Input: Python code string.",
    "bash_exec": "Run a bash shell command and return output. Input: bash command string.",
    "read_file": "Read a file's contents. Input: file path (workspace-relative or absolute).",
    "write_file": 'Write to a file. Input: JSON {"path": "...", "content": "..."}',
}

AGENT_SYSTEM_PROMPT = """\
You are an autonomous AI agent. Complete tasks step by step using the tools below.

{tools}

STRICT OUTPUT FORMAT — every reply must be ONLY a JSON object, nothing else:
  To use a tool:  {{"thought": "<why>", "tool": "<name>", "input": "<input>"}}
  When finished:  {{"thought": "<why>", "tool": "done",   "input": "<final answer>"}}

No markdown. No explanation. No text outside the JSON object.
"""

FIX_PROMPT = (
    'Your last response was not valid JSON. '
    'Reply with ONLY a JSON object in this exact format:\n'
    '{"thought": "...", "tool": "<tool_name or done>", "input": "..."}'
)


# ── JSON extraction ────────────────────────────────────────────────────────

def _strip_think(text: str) -> str:
    """Remove <think>…</think> reasoning blocks emitted by reasoning models
    (deepseek-r1, qwen3, …). Their chain-of-thought often contains stray braces
    and example JSON that derail the parser, and it buries the real answer."""
    if not text:
        return ""
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL | re.IGNORECASE)
    # If only a closing tag survived (opening tag consumed mid-stream), keep
    # everything after the last one — that's where the real output lives.
    if '</think>' in text:
        text = text.rsplit('</think>', 1)[-1]
    return text.strip()


def _extract_json(text: str) -> Optional[dict]:
    """Try several strategies to pull a JSON object out of model output."""
    text = _strip_think(text).strip()

    # 1. Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Strip code fences
    stripped = re.sub(r'```(?:json)?\s*|\s*```', '', text).strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # 3. Balanced-brace scan — finds the first complete {...} in the text
    start = text.find('{')
    if start != -1:
        depth = 0
        in_string = False
        escape = False
        for i, ch in enumerate(text[start:], start):
            if escape:
                escape = False
                continue
            if ch == '\\' and in_string:
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break

    return None


# ── Tools ──────────────────────────────────────────────────────────────────

async def _web_search(query: str) -> str:
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
        if not results:
            return "No results found."
        return "\n\n".join(
            f"**{r['title']}**\n{r['body']}\nSource: {r['href']}" for r in results
        )
    except Exception as e:
        return f"Search error: {e}"


async def _code_exec(code: str) -> str:
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(code)
            tmp = f.name
        proc = subprocess.run(
            ["python3", tmp],
            capture_output=True, text=True, timeout=30,
        )
        os.unlink(tmp)
        out = proc.stdout or ""
        if proc.stderr:
            out += f"\nSTDERR:\n{proc.stderr}"
        return out or "(no output)"
    except subprocess.TimeoutExpired:
        return "Execution timed out (30 s limit)"
    except Exception as e:
        return f"Execution error: {e}"


async def _read_file(path: str) -> str:
    try:
        with open(path.strip()) as f:
            return f.read()[:4000]
    except Exception as e:
        return f"File read error: {e}"


async def _write_file(input_str: str) -> str:
    try:
        data = json.loads(input_str)
        path = data["path"]
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w") as f:
            f.write(data["content"])
        return f"Written to {path}"
    except Exception as e:
        return f"File write error: {e}"


async def _bash_exec(cmd: str) -> str:
    try:
        proc = subprocess.run(
            ["bash", "-c", cmd],
            capture_output=True, text=True, timeout=30,
        )
        out = proc.stdout or ""
        if proc.stderr:
            out += f"\nSTDERR:\n{proc.stderr}"
        return out or "(no output)"
    except subprocess.TimeoutExpired:
        return "Bash command timed out (30 s limit)"
    except Exception as e:
        return f"Bash execution error: {e}"


_TOOL_FUNCS = {
    "web_search": _web_search,
    "code_exec": _code_exec,
    "bash_exec": _bash_exec,
    "read_file": _read_file,
    "write_file": _write_file,
}


# ── Agent loop ─────────────────────────────────────────────────────────────

async def _llm_call(model: str, messages: list, system: str) -> str:
    """Collect a full response from the streaming LLM."""
    text = ""
    async for chunk in ollama.chat_stream(model, messages, system_prompt=system, temperature=0.1):
        text += chunk
    return text


async def run_agent(
    task: str,
    model: str,
    tools: List[str],
    max_steps: int = 10,
    on_step=None,
    persona_prompt: Optional[str] = None,
    mcp_clients: Optional[List] = None,   # list of (server_name, MCPClient) tuples
    sandbox=None,                          # Optional[Sandbox] from sandbox_service
) -> Dict[str, Any]:
    available = {k: TOOL_DESCRIPTIONS[k] for k in tools if k in TOOL_DESCRIPTIONS}

    # Build sandbox-aware tool dispatch table
    tool_funcs = dict(_TOOL_FUNCS)
    if sandbox is not None:
        tool_funcs["code_exec"] = sandbox.execute_code
        tool_funcs["bash_exec"] = sandbox.execute_bash
        tool_funcs["write_file"] = sandbox.write_file
        tool_funcs["read_file"] = sandbox.read_file

    # Inject MCP tools
    mcp_tool_map: Dict[str, Any] = {}  # "mcp__<server>__<tool>" -> callable
    if mcp_clients:
        from .mcp_service import MCPClient as _MCPClient
        for server_name, client in mcp_clients:
            if client.tools_cache:
                for t in client.tools_cache:
                    tname = t.get("name", "")
                    key = f"mcp__{server_name}__{tname}"
                    desc = t.get("description", tname)
                    available[key] = f"[MCP:{server_name}] {desc}"
                    async def _make_mcp_caller(c=client, n=tname):
                        async def _call(input_str):
                            import json as _json
                            try:
                                args = _json.loads(input_str)
                            except Exception:
                                args = {"input": input_str}
                            return await c.call_tool(n, args)
                        return _call
                    mcp_tool_map[key] = await _make_mcp_caller()

    tool_list = "\n".join(f"- {k}: {v}" for k, v in available.items())
    system = AGENT_SYSTEM_PROMPT.format(tools=tool_list)
    if persona_prompt:
        system = f"{persona_prompt}\n\n{system}"

    messages: List[Dict[str, str]] = [
        {"role": "user", "content": f"Complete this task: {task}"}
    ]
    steps: List[Dict] = []

    for step_num in range(1, max_steps + 1):
        # ── Get LLM response, retry up to 3× on bad JSON ──────────────────
        parsed: Optional[dict] = None
        last_response = ""

        for attempt in range(3):
            try:
                last_response = await asyncio.wait_for(
                    _llm_call(model, messages, system),
                    timeout=120,
                )
            except asyncio.TimeoutError:
                last_response = ""

            parsed = _extract_json(last_response)
            if parsed:
                break

            # Ask the model to fix its output (don't add to permanent history)
            fix_messages = messages + [
                {"role": "assistant", "content": last_response or "(no response)"},
                {"role": "user", "content": FIX_PROMPT},
            ]
            try:
                last_response = await asyncio.wait_for(
                    _llm_call(model, fix_messages, system),
                    timeout=60,
                )
            except asyncio.TimeoutError:
                last_response = ""
            parsed = _extract_json(last_response)
            if parsed:
                break

        if not parsed:
            # The model answered in prose instead of the JSON protocol — common
            # with chat-tuned and reasoning models. Rather than failing with no
            # output, accept the prose as the final answer (same pragmatic
            # "direct-prose acceptance" the CLI agent uses).
            cleaned = _strip_think(last_response).strip()
            if len(cleaned) >= 2:
                step = {
                    "step": step_num,
                    "thought": "",
                    "tool": "done",
                    "input": cleaned,
                    "output": cleaned,
                }
                steps.append(step)
                if on_step:
                    await on_step(step)
                return {"steps": steps, "result": cleaned, "error": None}

            # Truly empty (e.g. repeated timeouts) — record it and stop
            step = {
                "step": step_num,
                "thought": f"Model did not return usable output after retries. Raw: {last_response[:300]}",
                "tool": None,
                "input": None,
                "output": None,
            }
            steps.append(step)
            if on_step:
                await on_step(step)
            break

        # Add the valid assistant response to history
        messages.append({"role": "assistant", "content": last_response})

        tool_name: str = parsed.get("tool", "")
        tool_input: str = str(parsed.get("input", ""))
        thought: str = parsed.get("thought", "")

        step: Dict[str, Any] = {
            "step": step_num,
            "thought": thought,
            "tool": tool_name,
            "input": tool_input,
            "output": None,
        }

        # ── Done ───────────────────────────────────────────────────────────
        if tool_name == "done":
            step["output"] = tool_input
            steps.append(step)
            if on_step:
                await on_step(step)
            return {"steps": steps, "result": tool_input, "error": None}

        # ── Execute tool ───────────────────────────────────────────────────
        if tool_name in tool_funcs and tool_name in available:
            try:
                output = await asyncio.wait_for(
                    tool_funcs[tool_name](tool_input),
                    timeout=60,
                )
            except asyncio.TimeoutError:
                output = f"Tool '{tool_name}' timed out after 60 s"
        elif tool_name in mcp_tool_map:
            try:
                output = await asyncio.wait_for(
                    mcp_tool_map[tool_name](tool_input),
                    timeout=60,
                )
            except asyncio.TimeoutError:
                output = f"MCP tool '{tool_name}' timed out after 60 s"
            except Exception as e:
                output = f"MCP tool error: {e}"
        else:
            known = ", ".join(available.keys()) or "none"
            output = f"Unknown tool '{tool_name}'. Available: {known}"

        step["output"] = output
        steps.append(step)
        if on_step:
            await on_step(step)

        messages.append({"role": "user", "content": f"Tool result:\n{output}"})

    # Ran out of steps without an explicit "done". Don't return nothing —
    # ask the model for a best-effort answer from what it gathered so the
    # user always sees output.
    if steps:
        try:
            summary = await asyncio.wait_for(
                _llm_call(
                    model,
                    messages + [{
                        "role": "user",
                        "content": (
                            "You have run out of steps. Using everything gathered above, "
                            "write the best final answer you can for the original task. "
                            "Answer in plain prose — no JSON, no tool calls."
                        ),
                    }],
                    persona_prompt or "You are a helpful assistant.",
                ),
                timeout=120,
            )
            summary = _strip_think(summary).strip()
        except asyncio.TimeoutError:
            summary = ""
        if summary:
            return {
                "steps": steps,
                "result": summary,
                "error": "Reached the step limit — answer synthesized from partial progress.",
            }

    return {
        "steps": steps,
        "result": None,
        "error": "Reached max steps without completing the task.",
    }
