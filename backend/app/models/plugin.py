"""Installed plugin records.

The filesystem is the source of truth for *which* plugins exist (see
plugin_service); this table records the admin's decisions about them — whether
each one is enabled, and any install-time errors — so the UI can show a stable
list even if the directory is edited underneath it.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, JSON

from ..core.database import Base


class PluginInstall(Base):
    __tablename__ = "plugin_installs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    version = Column(String, nullable=True)
    author = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    # Where it came from: "local" or a URL/registry ref.
    source = Column(String, nullable=True, default="local")
    # "sandbox" (subprocess) or "inprocess" (admin-trusted direct import).
    isolation = Column(String, nullable=False, default="sandbox")
    is_enabled = Column(Boolean, default=False, nullable=False)
    # Cached copy of the parsed manifest, for the UI.
    manifest = Column(JSON, nullable=True)
    # Populated when the plugin failed to load or a tool call blew up.
    last_error = Column(Text, nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    installed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self):  # pragma: no cover - debug aid
        return f"<PluginInstall {self.name} enabled={self.is_enabled}>"
