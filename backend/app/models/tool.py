from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from ..core.database import Base


class GeneratedTool(Base):
    """An agent tool whose Python implementation was written by the LLM and
    approved by a human. Approved + enabled tools become selectable in Agents
    and run inside the same Docker sandbox as the built-in code_exec tool."""

    __tablename__ = "generated_tools"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)             # snake_case identifier the agent calls
    description = Column(Text, nullable=False)         # shown to the LLM (what it does + input format)
    input_description = Column(Text, default="")       # human-facing note on the expected input
    code = Column(Text, nullable=False)                # python defining `def run(input): ...`
    prompt = Column(Text, default="")                  # the user's request that generated it
    status = Column(String, default="pending")         # pending | approved | rejected
    enabled = Column(Boolean, default=True)            # toggle off without deleting
    run_count = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    approved_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User")
