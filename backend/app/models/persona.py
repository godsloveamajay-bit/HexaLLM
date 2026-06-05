from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, JSON, Float
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from ..core.database import Base


class SavedPersona(Base):
    __tablename__ = "saved_personas"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    emoji = Column(String, default="🤖")
    base_model = Column(String, nullable=False)
    system_prompt = Column(Text, nullable=True)
    tools = Column(JSON, default=list)
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=True)
    use_memory = Column(Boolean, default=False)
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, nullable=True)
    personality = Column(JSON, nullable=True)  # Personality Engine sliders {trait: 0..100}
    is_public = Column(Boolean, default=False)
    is_favorite = Column(Boolean, default=False)
    uses = Column(Integer, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="personas")
