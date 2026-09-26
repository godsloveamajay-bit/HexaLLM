"""MCP Integration - Expose HexaLLM tools via MCP."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from ...core.config import settings

logger = logging.getLogger(__name__)

# Read-only binaries the MCP shell tool may run. Anything that can write to
# the host or reach the network is deliberately absent.
ALLOWED_SHELL_COMMANDS = frozenset({
    "ls", "cat", "head", "tail", "wc", "grep", "find", "stat", "du", "df", "echo", "pwd",
})


def _resolve_sandbox_path(path: Optional[str]) -> str:
    """Resolve `path` inside MCP_SANDBOX_ROOT, rejecting escapes."""
    root = os.path.abspath(settings.MCP_SANDBOX_ROOT)
    candidate = os.path.abspath(os.path.join(root, path or "."))
    if candidate != root and not candidate.startswith(root + os.sep):
        raise ValueError(f"path escapes the sandbox root: {path}")
    return candidate


def register_hexallm_tools(mcp_server):
    """Register all HexaLLM tools with the MCP server."""
    
    # Tool: chat_completion
    mcp_server.register_tool(
        name="chat_completion",
        description="Generate a chat completion using HexaLLM models",
        input_schema={
            "type": "object",
            "properties": {
                "model": {"type": "string", "description": "Model name (e.g., 'hex-auto', 'hex-4.2-turbo')"},
                "messages": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "role": {"type": "string", "enum": ["system", "user", "assistant"]},
                            "content": {"type": "string"}
                        },
                        "required": ["role", "content"]
                    }
                },
                "temperature": {"type": "number", "minimum": 0, "maximum": 2, "default": 0.7},
                "max_tokens": {"type": "integer", "minimum": 1, "maximum": 8192},
                "stream": {"type": "boolean", "default": False}
            },
            "required": ["messages"]
        },
        handler=chat_completion_handler
    )

    # Tool: generate_image
    mcp_server.register_tool(
        name="generate_image",
        description="Generate an image using Stability AI",
        input_schema={
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Image generation prompt"},
                "negative_prompt": {"type": "string", "default": ""},
                "width": {"type": "integer", "minimum": 512, "maximum": 1024, "default": 1024},
                "height": {"type": "integer", "minimum": 512, "maximum": 1024, "default": 1024},
                "steps": {"type": "integer", "minimum": 10, "maximum": 50, "default": 30},
                "cfg_scale": {"type": "number", "minimum": 1, "maximum": 20, "default": 7},
                "model": {"type": "string", "enum": ["sd3-ultra", "sd3-core"], "default": "sd3-ultra"}
            },
            "required": ["prompt"]
        },
        handler=generate_image_handler
    )

    # Tool: search_web
    mcp_server.register_tool(
        name="search_web",
        description="Search the web for information",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5}
            },
            "required": ["query"]
        },
        handler=search_web_handler
    )

    # Tool: file_operations — host filesystem access, opt-in only.
    if settings.MCP_ENABLE_DANGEROUS_TOOLS:
        mcp_server.register_tool(
            name="file_operations",
            description="Read, write, or list files inside the MCP sandbox root",
            input_schema={
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["read", "write", "list", "delete"]},
                    "path": {"type": "string", "description": "Path relative to the sandbox root"},
                    "content": {"type": "string"},
                    "recursive": {"type": "boolean", "default": False}
                },
                "required": ["operation", "path"]
            },
            handler=file_operations_handler
        )

        # Tool: shell_command — opt-in only, and only for allow-listed binaries.
        mcp_server.register_tool(
            name="shell_command",
            description="Run an allow-listed read-only command inside the sandbox root",
            input_schema={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "enum": sorted(ALLOWED_SHELL_COMMANDS)},
                    "args": {"type": "array", "items": {"type": "string"}},
                    "cwd": {"type": "string", "description": "Relative to the sandbox root"}
                },
                "required": ["command"]
            },
            handler=shell_command_handler
        )
    else:
        logger.warning(
            "MCP host tools (file_operations, shell_command) are DISABLED. "
            "Set MCP_ENABLE_DANGEROUS_TOOLS=true to expose them."
        )

    logger.info(
        "Registered HexaLLM MCP tools (dangerous tools: %s)",
        settings.MCP_ENABLE_DANGEROUS_TOOLS,
    )


async def chat_completion_handler(args: Dict[str, Any]) -> str:
    """Handle chat completion requests via direct API call."""
    import httpx
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Call the internal chat completions endpoint
            response = await client.post(
                "http://127.0.0.1:8080/api/v1/chat/completions",
                json=args,
                timeout=60.0
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("content", "No response")
            else:
                return f"Error: {response.text}"
    except Exception as e:
        return f"Error calling chat API: {str(e)}"


async def generate_image_handler(args: Dict[str, Any]) -> str:
    """Handle image generation requests via direct API call."""
    import httpx
    
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                "http://127.0.0.1:8080/api/v1/image/generate",
                json=args,
                timeout=120.0
            )
            if response.status_code == 200:
                data = response.json()
                return f"Image generated: {data.get('image_url', 'success')}"
            else:
                return f"Error: {response.text}"
    except Exception as e:
        return f"Error calling image API: {str(e)}"


async def search_web_handler(args: Dict[str, Any]) -> str:
    """Handle web search requests."""
    query = args.get("query", "")
    max_results = args.get("max_results", 5)
    return f"Web search for '{query}' (max {max_results} results) - [Search functionality would be implemented here]"


async def file_operations_handler(args: Dict[str, Any]) -> str:
    """Handle file operations, confined to MCP_SANDBOX_ROOT."""
    import os
    import shutil

    operation = args.get("operation")
    path = args.get("path")
    content = args.get("content", "")

    try:
        target = _resolve_sandbox_path(path)
    except ValueError as e:
        return f"Error: {e}"

    try:
        if operation == "read":
            with open(target, "r") as f:
                return f.read()
        elif operation == "write":
            parent = os.path.dirname(target)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(target, "w") as f:
                f.write(content)
            return f"Written to {target}"
        elif operation == "list":
            return "\n".join(os.listdir(target))
        elif operation == "delete":
            if os.path.abspath(target) == os.path.abspath(settings.MCP_SANDBOX_ROOT):
                return "Error: refusing to delete the sandbox root"
            if os.path.isdir(target):
                shutil.rmtree(target)
            else:
                os.remove(target)
            return f"Deleted {target}"
        else:
            return f"Unknown operation: {operation}"
    except Exception as e:
        return f"Error: {e}"


async def shell_command_handler(args: Dict[str, Any]) -> str:
    """Run an allow-listed command, confined to MCP_SANDBOX_ROOT."""
    import subprocess

    command = args.get("command")
    args_list = args.get("args") or []
    cwd = args.get("cwd")

    if command not in ALLOWED_SHELL_COMMANDS:
        return (
            f"Error: '{command}' is not allowed. "
            f"Allowed: {', '.join(sorted(ALLOWED_SHELL_COMMANDS))}"
        )
    # No shell metacharacters — these run without a shell, but a stray
    # ";" or "$(" in an argument would still be a footgun for anything that
    # later re-runs them through one.
    for arg in [command, *args_list]:
        if any(ch in str(arg) for ch in ";|&`$<>\n"):
            return "Error: shell metacharacters are not allowed in command arguments"

    try:
        workdir = _resolve_sandbox_path(cwd) if cwd else settings.MCP_SANDBOX_ROOT
    except ValueError as e:
        return f"Error: {e}"

    try:
        result = subprocess.run(
            [command] + [str(a) for a in args_list],
            capture_output=True,
            text=True,
            cwd=workdir,
            timeout=60,
        )
        return (
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}\n"
            f"exit_code: {result.returncode}"
        )
    except subprocess.TimeoutExpired:
        return "Error: Command timed out"
    except Exception as e:
        return f"Error: {e}"
