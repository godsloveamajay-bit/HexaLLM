"""MCP API Router for main FastAPI app."""
from fastapi import APIRouter, Request, Response
from sse_starlette.sse import EventSourceResponse

from .server import mcp_server

router = APIRouter(prefix="/mcp-server", tags=["mcp"])


@router.post("")
async def mcp_endpoint(request: Request):
    """Handle JSON-RPC MCP requests."""
    try:
        body = await request.body()
        import json
        body_json = json.loads(body)
    except Exception as e:
        return Response(content=f"JSON parse error: {e}", status_code=400)
    result = await mcp_server.handle_request(body_json)
    if result is None:
        return Response(status_code=204)
    return result


@router.get("/sse")
async def mcp_sse(request: Request):
    """SSE endpoint for MCP transport."""
    from sse_starlette.sse import EventSourceResponse
    return EventSourceResponse(mcp_server.handle_sse(request))


@router.get("/tools")
async def list_tools():
    """List available tools."""
    return {"tools": mcp_server.get_tools()}

@router.get("/health")
async def health():
    return {"status": "ok", "server": "HexaLLM MCP"}
