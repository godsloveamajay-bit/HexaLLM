"""AI-Generated Tools: the LLM writes a self-contained Python tool, a human
approves it, and it runs inside the Docker sandbox alongside built-in tools."""
from __future__ import annotations

import json
import re
from typing import Dict, List, Optional

from .ollama_service import ollama
from .agent_service import _strip_think


# A delimited format (not JSON) — JSON-wrapping a code payload is fragile across
# models (they emit invalid \' escapes and truncate). A fenced code block parses
# reliably and keeps the code intact.
GEN_SYSTEM = """You are a tool-writing assistant for an AI agent platform. \
Given a description of a capability, write ONE self-contained Python tool.

REQUIREMENTS:
- Define exactly one function with this signature: `def run(input: str) -> str:`
- It takes a SINGLE string argument and RETURNS a string.
- Read every parameter from `input`. If the tool needs structured arguments,
  parse JSON from `input` inside run() (e.g. data = json.loads(input)).
- Use only the Python standard library. No pip packages.
- Do NOT access the network or the file system unless the request explicitly asks for it.
- Be robust: wrap risky logic in try/except and RETURN a helpful error string
  instead of raising.
- Top-level code must be ONLY imports and the single function definition.
  Do NOT call run() yourself. Do NOT print.

Respond in EXACTLY this format and nothing else:
NAME: snake_case_tool_name
DESCRIPTION: one sentence — what it does AND the exact format of the input string
INPUT: a friendly note on what a caller should pass as input
CODE:
```python
import json

def run(input: str) -> str:
    ...
```
"""


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_]+", "_", (name or "").strip().lower()).strip("_")
    s = re.sub(r"_+", "_", s)
    if not s:
        s = "custom_tool"
    if s[0].isdigit():
        s = f"tool_{s}"
    return s[:48]


def _clean_code(code) -> str:
    """Coerce the model's `code` field to a plain Python source string."""
    if isinstance(code, list):
        code = "\n".join(str(x) for x in code)
    code = str(code or "")
    # Strip accidental markdown fences.
    code = re.sub(r"^```(?:python)?\s*|\s*```$", "", code.strip())
    return code.strip()


def validate_code(code: str) -> Optional[str]:
    """Return an error string if the code is unusable, else None."""
    if not code.strip():
        return "No code was generated."
    if not re.search(r"def\s+run\s*\(", code):
        return "Generated code does not define a `run(input)` function."
    try:
        compile(code, "<generated_tool>", "exec")
    except SyntaxError as e:
        return f"Generated code has a syntax error: {e}"
    return None


def _field(text: str, label: str) -> str:
    m = re.search(rf"^\s*{label}\s*:\s*(.+)$", text, re.MULTILINE | re.IGNORECASE)
    return m.group(1).strip() if m else ""


def parse_tool_response(raw: str) -> Dict:
    """Parse the delimited tool spec out of the model output."""
    text = _strip_think(raw or "")

    # Code: prefer a fenced block; fall back to everything after a CODE: marker.
    m = re.search(r"```(?:python)?\s*\n?(.*?)```", text, re.DOTALL)
    code = _clean_code(m.group(1)) if m else ""
    if not code:
        m2 = re.search(r"CODE\s*:\s*(.+)$", text, re.DOTALL | re.IGNORECASE)
        if m2:
            code = _clean_code(m2.group(1))

    name = _slug(_field(text, "NAME"))
    description = _field(text, "DESCRIPTION")
    input_description = _field(text, "INPUT")

    return {"name": name, "description": description,
            "input_description": input_description, "code": code}


async def generate_tool(
    model: str, request: str, existing_names: Optional[List[str]] = None
) -> Dict:
    """Ask the LLM to write a tool. Returns a dict with name/description/
    input_description/code/error (error is None on success)."""
    user = f"Capability requested:\n{request.strip()}"
    if existing_names:
        user += f"\n\nThese tool names are already taken, pick a different one: {', '.join(existing_names)}"

    raw = ""
    async for chunk in ollama.chat_stream(
        model, [{"role": "user", "content": user}], system_prompt=GEN_SYSTEM, temperature=0.2
    ):
        raw += chunk

    parsed = parse_tool_response(raw)
    code = parsed["code"]
    name = parsed["name"] or "custom_tool"
    description = parsed["description"] or (request.strip()[:140] or "A custom generated tool.")
    input_description = parsed["input_description"]

    err = validate_code(code)
    return {
        "name": name,
        "description": description,
        "input_description": input_description,
        "code": code,
        "raw": raw if err else None,
        "error": err,
    }


def build_script(code: str, input_str: str) -> str:
    """Wrap the tool's code in a harness that calls run() with the given input
    and writes the (string) result to stdout. The input is embedded as a safe
    Python string literal via json.dumps so it can't break out of the source."""
    literal = json.dumps(input_str if input_str is not None else "")
    harness = (
        "\n\n"
        "import sys as _sys\n"
        "try:\n"
        f"    _nebula_result = run({literal})\n"
        "    _sys.stdout.write('' if _nebula_result is None else str(_nebula_result))\n"
        "except Exception as _e:\n"
        "    _sys.stdout.write('Tool error: ' + repr(_e))\n"
    )
    return code + harness


async def run_generated_tool(code: str, input_str: str, sandbox) -> str:
    """Execute a generated tool inside the provided Sandbox and return its output."""
    script = build_script(code, input_str)
    out = await sandbox.execute_code(script)
    return (out or "").strip() or "(no output)"
