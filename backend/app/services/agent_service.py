import json
import asyncio
import subprocess
import tempfile
import os
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from .ollama_service import ollama


TOOL_DESCRIPTIONS = {
    "web_search": "Search the web for current information. Input: search query string.",
    "code_exec": "Execute Python code and return output. Input: Python code string.",
    "read_file": "Read contents of a file. Input: file path string.",
    "write_file": "Write content to a file. Input: JSON with 'path' and 'content' keys.",
}

AGENT_SYSTEM_PROMPT = """You are an autonomous AI agent. You have access to these tools:

{tools}

To use a tool, respond in this exact JSON format:
{{"thought": "your reasoning", "tool": "tool_name", "input": "tool input"}}

When you have the final answer, respond:
{{"thought": "final reasoning", "tool": "done", "input": "final answer to the user"}}

Always respond with valid JSON only. No other text."""


async def web_search(query: str) -> str:
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


async def code_exec(code: str) -> str:
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(code)
            tmp_path = f.name
        result = subprocess.run(
            ["python3", tmp_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        os.unlink(tmp_path)
        output = result.stdout or ""
        if result.stderr:
            output += f"\nSTDERR: {result.stderr}"
        return output or "(no output)"
    except subprocess.TimeoutExpired:
        return "Execution timed out (30s limit)"
    except Exception as e:
        return f"Execution error: {e}"


async def read_file(path: str) -> str:
    try:
        with open(path, "r") as f:
            return f.read()[:4000]
    except Exception as e:
        return f"File read error: {e}"


async def write_file(input_str: str) -> str:
    try:
        data = json.loads(input_str)
        with open(data["path"], "w") as f:
            f.write(data["content"])
        return f"File written to {data['path']}"
    except Exception as e:
        return f"File write error: {e}"


TOOL_FUNCS = {
    "web_search": web_search,
    "code_exec": code_exec,
    "read_file": read_file,
    "write_file": write_file,
}


async def run_agent(
    task: str,
    model: str,
    tools: List[str],
    max_steps: int = 10,
    on_step=None,
    persona_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    available_tools = {k: v for k, v in TOOL_DESCRIPTIONS.items() if k in tools}
    tool_list = "\n".join(f"- {k}: {v}" for k, v in available_tools.items())
    base = AGENT_SYSTEM_PROMPT.format(tools=tool_list)
    system_prompt = f"{persona_prompt}\n\n{base}" if persona_prompt else base

    messages = [{"role": "user", "content": f"Complete this task: {task}"}]
    steps = []

    for step_num in range(1, max_steps + 1):
        response_text = ""
        async for chunk in ollama.chat_stream(model, messages, system_prompt=system_prompt, temperature=0.1):
            response_text += chunk

        messages.append({"role": "assistant", "content": response_text})

        try:
            # Extract JSON from response
            text = response_text.strip()
            if "```" in text:
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            parsed = json.loads(text)
        except json.JSONDecodeError:
            step = {"step": step_num, "thought": response_text, "tool": None, "input": None, "output": None}
            steps.append(step)
            if on_step:
                await on_step(step)
            break

        tool_name = parsed.get("tool")
        tool_input = parsed.get("input", "")
        thought = parsed.get("thought", "")

        step = {"step": step_num, "thought": thought, "tool": tool_name, "input": tool_input, "output": None}

        if tool_name == "done":
            step["output"] = tool_input
            steps.append(step)
            if on_step:
                await on_step(step)
            return {"steps": steps, "result": tool_input, "error": None}

        if tool_name in TOOL_FUNCS and tool_name in available_tools:
            output = await TOOL_FUNCS[tool_name](tool_input)
        else:
            output = f"Unknown tool: {tool_name}"

        step["output"] = output
        steps.append(step)
        if on_step:
            await on_step(step)

        messages.append({"role": "user", "content": f"Tool result: {output}"})

    return {"steps": steps, "result": None, "error": "Max steps reached without completing task"}
