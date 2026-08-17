from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from ..core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=True)   # null for OAuth-only accounts
    oauth_provider = Column(String, nullable=True)
    oauth_id = Column(String, nullable=True)
    full_name = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    bio = Column(Text, nullable=True)
    # AI preferences (Settings → AI Assistant)
    ai_instructions = Column(Text, nullable=True)     # injected into every chat's system prompt
    ai_default_model = Column(String, nullable=True)  # default variant for new chats
    ai_temperature = Column(Float, nullable=True)     # default response creativity (0–1)
    ai_max_tokens = Column(Integer, nullable=True)    # max response length (0/null = model default)
    ai_default_kb_id = Column(Integer, nullable=True) # default knowledge base for new chats
    ai_reasoning = Column(Boolean, nullable=True)     # show extended thinking (null/true = on)
    ai_personality = Column(JSON, nullable=True)       # default Personality Engine sliders {trait: 0..100}
    voice_name = Column(String, nullable=True)         # preferred TTS voice for voice mode
    voice_streaming = Column(Boolean, nullable=True)   # stream TTS audio instead of full-blob
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    # Session revocation — bumped on logout to invalidate all issued JWTs at once
    token_version = Column(Integer, default=0)
    # Billing / plan
    plan_id = Column(Integer, ForeignKey("plans.id"), nullable=True)
    paypal_customer_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    api_keys = relationship("APIKey", back_populates="user", cascade="all, delete-orphan")
    models = relationship("AIModel", back_populates="owner", cascade="all, delete-orphan")
    chat_sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")
    agent_runs = relationship("AgentRun", back_populates="user", cascade="all, delete-orphan")
    training_jobs = relationship("TrainingJob", back_populates="user", cascade="all, delete-orphan")
    request_logs = relationship("RequestLog", back_populates="user", cascade="all, delete-orphan")
    knowledge_bases = relationship("KnowledgeBase", back_populates="user", cascade="all, delete-orphan")
    prompt_templates = relationship("PromptTemplate", back_populates="user", cascade="all, delete-orphan")
    memories = relationship("UserMemory", back_populates="user", cascade="all, delete-orphan")
    personas = relationship("SavedPersona", back_populates="user", cascade="all, delete-orphan")
    workflows = relationship("Workflow", back_populates="user", cascade="all, delete-orphan")
    mcp_servers = relationship("MCPServer", back_populates="user", cascade="all, delete-orphan")
    subscription = relationship("Subscription", back_populates="user", uselist=False, cascade="all, delete-orphan")


class APIKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    workspace_id = Column(Integer, nullable=True, index=True)   # optional dev-workspace scoping
    name = Column(String, nullable=False)
    key = Column(String, unique=True, index=True, nullable=False)
    is_active = Column(Boolean, default=True)
    # "Expose as API": optionally bind a key to a saved persona so external
    # callers automatically get that model + system prompt + temperature.
    persona_id = Column(Integer, ForeignKey("saved_personas.id", ondelete="SET NULL"), nullable=True)
    model_name = Column(String, nullable=True)   # served model (snapshot of persona.base_model, or a raw model)
    # Per-key sampling overrides: pin temperature / top_p / max_tokens for every
    # call using this key. When set, they win over the caller's own values.
    temperature = Column(Float, nullable=True)
    top_p = Column(Float, nullable=True)
    max_tokens = Column(Integer, nullable=True)
    # Usage metering for billing / dashboards.
    request_count = Column(Integer, default=0)
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="api_keys")
    persona = relationship("SavedPersona")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String, unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
