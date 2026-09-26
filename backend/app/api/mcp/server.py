"""MCP (Model Context Protocol) Server Implementation."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional, Callable, Awaitable, Union
from dataclasses import dataclass, field

from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel, Field

from .schemas import (
    JSONRPCRequest, JSONRPCResponse, JSONRPCNotification,
    InitializeParams, InitializeResult, ListToolsResult, Tool,
    CallToolParams, CallToolResult, TextContent,
    MCPErrorCode, MCPError, JSONRPCVersion,
)

logger = logging.getLogger(__name__)


@dataclass
class MCPTool:
    """Represents an MCP tool."""
    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: Callable[[Dict[str, Any]], Awaitable[Any]]


class MCPServer:
    """MCP Server implementation with tool registry."""

    def __init__(self, name: str = "HexaLLM", version: str = "1.0.0"):
        self.name = name
        self.version = version
        self.tools: Dict[str, MCPTool] = {}
        self.initialized = False
        self.client_info: Optional[Dict[str, str]] = None

    def register_tool(
        self,
        name: str,
        description: str,
        input_schema: Dict[str, Any],
        handler: Callable[[Dict[str, Any]], Awaitable[Any]],
    ) -> None:
        """Register a new tool."""
        self.tools[name] = MCPTool(
            name=name,
            description=description,
            input_schema=input_schema,
            handler=handler,
        )
        logger.info(f"Registered MCP tool: {name}")

    def unregister_tool(self, name: str) -> bool:
        """Unregister a tool."""
        if name in self.tools:
            del self.tools[name]
            logger.info(f"Unregistered MCP tool: {name}")
            return True
        return False

    def get_tools(self) -> List[Dict[str, Any]]:
        """Get list of available tools."""
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
            }
            for tool in self.tools.values()
        ]

    async def handle_request(self, request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle incoming JSON-RPC request."""
        try:
            req = JSONRPCRequest(**request)
        except Exception as e:
            return self._error_response(
                None, MCPErrorCode.PARSE_ERROR, f"Invalid request: {e}"
            )

        if req.method == "initialize":
            return await self._handle_initialize(req)
        elif req.method == "initialized":
            self.initialized = True
            return None  # Notification, no response
        elif req.method == "tools/list":
            return await self._handle_list_tools(req)
        elif req.method == "tools/call":
            return await self._handle_call_tool(req)
        elif req.method == "ping":
            return self._success_response(req.id, {})
        else:
            return self._error_response(
                req.id, MCPErrorCode.METHOD_NOT_FOUND, f"Method not found: {req.method}"
            )

    async def _handle_initialize(self, req: JSONRPCRequest) -> Dict[str, Any]:
        """Handle initialize request."""
        try:
            params = InitializeParams(**req.params) if req.params else InitializeParams(
                protocolVersion="2024-11-05"
            )
        except Exception as e:
            return self._error_response(
                req.id, MCPErrorCode.INVALID_PARAMS, f"Invalid initialize params: {e}"
            )

        self.client_info = params.clientInfo
        self.initialized = True

        result = InitializeResult(
            protocolVersion="2024-11-05",
            capabilities={
                "tools": {},
                "logging": {},
            },
            serverInfo={"name": self.name, "version": self.version},
        )
        return self._success_response(req.id, result.model_dump())

    async def _handle_list_tools(self, req: JSONRPCRequest) -> Dict[str, Any]:
        """Handle tools/list request."""
        if not self.initialized:
            return self._error_response(
                req.id, MCPErrorCode.SERVER_NOT_INITIALIZED, "Server not initialized"
            )

        result = ListToolsResult(tools=[
            Tool(name=t.name, description=t.description, inputSchema=t.input_schema)
            for t in self.tools.values()
        ])
        return self._success_response(req.id, result.model_dump())

    async def _handle_call_tool(self, req: JSONRPCRequest) -> Dict[str, Any]:
        """Handle tools/call request."""
        if not self.initialized:
            return self._error_response(
                req.id, MCPErrorCode.SERVER_NOT_INITIALIZED, "Server not initialized"
            )

        try:
            params = CallToolParams(**req.params) if req.params else CallToolParams(name="")
        except Exception as e:
            return self._error_response(
                req.id, MCPErrorCode.INVALID_PARAMS, f"Invalid call params: {e}"
            )

        tool = self.tools.get(params.name)
        if not tool:
            return self._error_response(
                req.id, MCPErrorCode.UNKNOWN_TOOL, f"Unknown tool: {params.name}"
            )

        try:
            result = await tool.handler(params.arguments or {})
            content = [{"type": "text", "text": str(result)}]
            result_obj = CallToolResult(content=[{"type": "text", "text": str(result)}])
            return self._success_response(req.id, result_obj.model_dump())
        except Exception as e:
            logger.error(f"Tool execution error: {e}", exc_info=True)
            return self._error_response(
                req.id, MCPErrorCode.TOOL_EXECUTION_ERROR, f"Tool execution failed: {e}"
            )

    def _success_response(self, id: Optional[Union[str, int]], result: Any) -> Dict[str, Any]:
        """Create success response."""
        return {
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }

    def _error_response(
        self, id: Optional[Union[str, int]], code: int, message: str, data: Any = None
    ) -> Dict[str, Any]:
        """Create error response."""
        return {
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": code,
                "message": message,
                "data": data,
            },
        }

    async def handle_sse(self, request: Request) -> AsyncGenerator[str, None]:
        """Handle SSE connection for MCP transport."""
        queue: asyncio.Queue = asyncio.Queue()

        async def send_event(data: Dict[str, Any]) -> None:
            await queue.put(data)

        # Send initialization event
        yield f"data: {json.dumps({'type': 'connected'})}\n\n"

        try:
            while True:
                await asyncio.sleep(30)
                yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass


# Global MCP server instance
mcp_server = MCPServer(name="HexaLLM", version="14.0.5")


def create_mcp_app(mcp_server: "MCPServer") -> FastAPI:
    """Create FastAPI app with MCP endpoints."""
    app = FastAPI(title="HexaLLM MCP Server")

    @app.post("/mcp")

    @app.get("/mcp/sse")
    async def mcp_sse(request: Request):
        """SSE endpoint for MCP transport."""
        return EventSourceResponse(mcp_server.handle_sse(request))

    @app.get("/mcp/tools")
    async def list_tools():
        """List available tools (HTTP endpoint for debugging)."""
        return {"tools": mcp_server.get_tools()}

    @app.get("/health")
    async def health():
        return {"status": "ok", "server": "HexaLLM MCP"}

    return app
