from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from ..core.database import Base


class MCPServer(Base):
    __tablename__ = "mcp_servers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    url = Column(String, nullable=False)          # SSE endpoint, e.g. http://localhost:3001/sse
    command = Column(String, nullable=True)       # stdio command alternative, e.g. "npx @modelcontextprotocol/server-github"
    env_vars = Column(JSON, default=dict)         # env vars passed to stdio server
    is_active = Column(Boolean, default=True)
    last_ping_at = Column(DateTime(timezone=True), nullable=True)
    tools_cache = Column(JSON, nullable=True)     # cached tools list from last connect
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="mcp_servers")
