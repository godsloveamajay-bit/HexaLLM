"""Admin-configured per-model (variant) sampling defaults.

Admins can override the sampling baked into a variant (temperature, top_p,
max_tokens, num_ctx) without redeploying. Null fields mean "use the variant
default". Applied in model_router.route() so every caller — chat, agents,
OpenAI-compat — sees the same overrides.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, DateTime
from ..core.database import Base


class ModelSettings(Base):
    __tablename__ = "model_settings"

    id = Column(Integer, primary_key=True, index=True)
    variant_id = Column(String, unique=True, index=True, nullable=False)
    temperature = Column(Float, nullable=True)
    top_p = Column(Float, nullable=True)
    max_tokens = Column(Integer, nullable=True)
    num_ctx = Column(Integer, nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )