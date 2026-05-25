from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.mcp_server import MCPServer
from ..services.mcp_service import MCPClient

router = APIRouter(prefix="/mcp", tags=["mcp"])


class MCPServerCreate(BaseModel):
    name: str
    description: Optional[str] = None
    url: str
    env_vars: Dict[str, str] = {}


class MCPServerUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    env_vars: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None


class MCPServerOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    url: str
    is_active: bool
    last_ping_at: Optional[str]
    tools_cache: Optional[List[Dict[str, Any]]]
    created_at: str

    class Config:
        from_attributes = True


def _serialize(s: MCPServer) -> MCPServerOut:
    return MCPServerOut(
        id=s.id,
        name=s.name,
        description=s.description,
        url=s.url,
        is_active=s.is_active,
        last_ping_at=s.last_ping_at.isoformat() if s.last_ping_at else None,
        tools_cache=s.tools_cache,
        created_at=s.created_at.isoformat(),
    )


@router.get("", response_model=List[MCPServerOut])
def list_mcp_servers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return [_serialize(s) for s in db.query(MCPServer).filter(
        MCPServer.user_id == current_user.id
    ).order_by(MCPServer.created_at.desc()).all()]


@router.post("", response_model=MCPServerOut, status_code=201)
def create_mcp_server(
    data: MCPServerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = MCPServer(
        user_id=current_user.id,
        name=data.name,
        description=data.description,
        url=data.url,
        env_vars=data.env_vars,
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return _serialize(server)


@router.patch("/{server_id}", response_model=MCPServerOut)
def update_mcp_server(
    server_id: int,
    data: MCPServerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = db.query(MCPServer).filter(
        MCPServer.id == server_id, MCPServer.user_id == current_user.id
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(server, k, v)
    server.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(server)
    return _serialize(server)


@router.delete("/{server_id}", status_code=204)
def delete_mcp_server(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = db.query(MCPServer).filter(
        MCPServer.id == server_id, MCPServer.user_id == current_user.id
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    db.delete(server)
    db.commit()


@router.post("/{server_id}/ping")
async def ping_mcp_server(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = db.query(MCPServer).filter(
        MCPServer.id == server_id, MCPServer.user_id == current_user.id
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    client = MCPClient(server.url)
    try:
        tools = await client.list_tools()
        server.tools_cache = tools
        server.last_ping_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "ok", "tool_count": len(tools), "tools": tools}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@router.post("/{server_id}/call")
async def call_mcp_tool(
    server_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = db.query(MCPServer).filter(
        MCPServer.id == server_id, MCPServer.user_id == current_user.id
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    tool_name = body.get("tool")
    arguments = body.get("arguments", {})
    if not tool_name:
        raise HTTPException(status_code=400, detail="'tool' field required")

    client = MCPClient(server.url)
    try:
        result = await client.call_tool(tool_name, arguments)
        return {"result": result}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"MCP call failed: {e}")
