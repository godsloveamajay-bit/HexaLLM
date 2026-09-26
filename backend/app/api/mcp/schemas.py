"""MCP (Model Context Protocol) types and schemas."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field
from enum import Enum


class JSONRPCVersion(str, Enum):
    V2 = "2.0"


class MCPErrorCode(int, Enum):
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603
    SERVER_NOT_INITIALIZED = -32000
    UNKNOWN_TOOL = -32001
    TOOL_EXECUTION_ERROR = -32002


class MCPError(BaseModel):
    code: int
    message: str
    data: Optional[Any] = None


class JSONRPCRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: Optional[Union[str, int]] = None
    method: str
    params: Optional[Dict[str, Any]] = None


class JSONRPCResponse(BaseModel):
    jsonrpc: str = "2.0"
    id: Optional[Union[str, int]] = None
    result: Optional[Any] = None
    error: Optional[MCPError] = None


class JSONRPCNotification(BaseModel):
    jsonrpc: str = "2.0"
    method: str
    params: Optional[Dict[str, Any]] = None


# MCP Protocol Types
class InitializeParams(BaseModel):
    protocolVersion: str
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    clientInfo: Optional[Dict[str, str]] = None


class InitializeResult(BaseModel):
    protocolVersion: str = "2024-11-05"
    capabilities: Dict[str, Any] = Field(default_factory=dict)
    serverInfo: Dict[str, str] = Field(default_factory=dict)


class Tool(BaseModel):
    name: str
    description: str
    inputSchema: Dict[str, Any] = Field(default_factory=dict)


class ListToolsResult(BaseModel):
    tools: List[Tool]


class CallToolParams(BaseModel):
    name: str
    arguments: Optional[Dict[str, Any]] = None


class CallToolResult(BaseModel):
    content: List[Dict[str, Any]]
    isError: bool = False


class TextContent(BaseModel):
    type: str = "text"
    text: str


class ImageContent(BaseModel):
    type: str = "image"
    data: str
    mimeType: str


class EmbeddedResource(BaseModel):
    type: str = "resource"
    resource: Dict[str, Any]


# SSE Transport Types
class SSEEvent(BaseModel):
    event: Optional[str] = None
    data: str
    id: Optional[str] = None
    retry: Optional[int] = None
