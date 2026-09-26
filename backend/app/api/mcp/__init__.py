"""MCP (Model Context Protocol) API — HexaLLM as an MCP *server*.

Exposes HexaLLM's own capabilities (chat, image, web search, files, shell) to
external MCP clients over JSON-RPC / SSE at `/api/v1/mcp-server`.

Note: `/api/v1/mcp` is a *different* feature — the MCP **client** registry for
connecting HexaLLM to external MCP servers. It lives in `api/mcp_clients.py`.
"""
from .server import create_mcp_app, MCPServer, mcp_server

from .integration import register_hexallm_tools

# Register HexaLLM tools on the shared server instance (idempotent).
register_hexallm_tools(mcp_server)

# Standalone ASGI app (for mounting on a dedicated port) + router for main.py.
mcp_app = create_mcp_app(mcp_server)

from .router import router as mcp_router

__all__ = ["mcp_server", "mcp_app", "mcp_router", "register_hexallm_tools"]
