"""MCP Integration - Expose HexaLLM tools via MCP."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


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

    # Tool: file_operations
    mcp_server.register_tool(
        name="file_operations",
        description="Read, write, or list files in the workspace",
        input_schema={
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["read", "write", "list", "delete"]},
                "path": {"type": "string"},
                "content": {"type": "string"},
                "recursive": {"type": "boolean", "default": False}
            },
            "required": ["operation", "path"]
        },
        handler=file_operations_handler
    )

    # Tool: shell_command
    mcp_server.register_tool(
        name="shell_command",
        description="Execute shell commands",
        input_schema={
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "args": {"type": "array", "items": {"type": "string"}},
                "cwd": {"type": "string"}
            },
            "required": ["command"]
        },
        handler=shell_command_handler
    )

    logger.info("Registered all HexaLLM tools with MCP server")


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
    """Handle file operations."""
    import os
    import shutil
    
    operation = args.get("operation")
    path = args.get("path")
    content = args.get("content", "")
    recursive = args.get("recursive", False)
    
    try:
        if operation == "read":
            with open(path, "r") as f:
                return f.read()
        elif operation == "write":
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(content)
            return f"Written to {path}"
        elif operation == "list":
            items = os.listdir(path)
            return "\n".join(items)
        elif operation == "delete":
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            return f"Deleted {path}"
        else:
            return f"Unknown operation: {operation}"
    except Exception as e:
        return f"Error: {str(e)}"


async def shell_command_handler(args: Dict[str, Any]) -> str:
    """Handle shell command execution."""
    import subprocess
    
    command = args.get("command")
    args_list = args.get("args", [])
    cwd = args.get("cwd")
    
    try:
        result = subprocess.run(
            [command] + args_list,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=60
        )
        return f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}\nexit_code: {result.returncode}"
    except subprocess.TimeoutExpired:
        return "Error: Command timed out"
    except Exception as e:
        return f"Error: {str(e)}"
