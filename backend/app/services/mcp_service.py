"""MCP (Model Context Protocol) client service.

Connects to MCP servers over HTTP/SSE transport and dispatches tool calls.
Follows the MCP spec: list tools via GET /tools, call via POST /tools/call.
"""
import asyncio
import json
from typing import Any, Dict, List, Optional
import httpx


class MCPClient:
    def __init__(self, url: str, timeout: float = 30.0):
        # Normalize: strip /sse suffix for REST calls, keep base URL
        self.base_url = url.rstrip("/").removesuffix("/sse")
        self.timeout = timeout

    async def list_tools(self) -> List[Dict[str, Any]]:
        """Return list of tool definitions from the MCP server."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{self.base_url}/tools")
            resp.raise_for_status()
            data = resp.json()
            # MCP spec: {"tools": [...]}
            return data.get("tools", data if isinstance(data, list) else [])

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Call a tool and return its text result."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/tools/call",
                json={"name": tool_name, "arguments": arguments},
            )
            resp.raise_for_status()
            data = resp.json()

        # MCP spec: {"content": [{"type": "text", "text": "..."}], "isError": false}
        if data.get("isError"):
            return f"MCP tool error: {data}"
        content = data.get("content", [])
        if isinstance(content, list):
            return "\n".join(
                c.get("text", json.dumps(c)) for c in content if isinstance(c, dict)
            ) or str(data)
        return str(content or data)

    async def ping(self) -> bool:
        try:
            tools = await self.list_tools()
            return isinstance(tools, list)
        except Exception:
            return False


def build_tool_descriptions(tools: List[Dict[str, Any]]) -> str:
    """Convert MCP tool list into human-readable descriptions for the agent system prompt."""
    lines = []
    for t in tools:
        name = t.get("name", "unknown")
        desc = t.get("description", "")
        params = t.get("inputSchema", {}).get("properties", {})
        param_str = ", ".join(f"{k}: {v.get('type', 'any')}" for k, v in params.items()) if params else ""
        lines.append(f"- mcp__{name}: {desc}" + (f" (params: {param_str})" if param_str else ""))
    return "\n".join(lines)
