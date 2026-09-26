"""Installed plugin records.

The filesystem is the source of truth for *which* plugins exist (see
plugin_service); this table records the admin's decisions about them — whether
each one is enabled, and any install-time errors — so the UI can show a stable
list even if the directory is edited underneath it.
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, JSON,
)

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


class PluginCallLog(Base):
    """One row per plugin tool invocation.

    Doubles as the audit trail and as the source of truth for rate limiting —
    counting recent rows is what enforces a quota, so a limit survives a
    restart and can't be bypassed by failing calls. Args and output are stored
    truncated, and args are redacted for tools that declare secrets.
    """

    __tablename__ = "plugin_call_logs"

    id = Column(Integer, primary_key=True, index=True)
    plugin_name = Column(String, nullable=False, index=True)
    tool_name = Column(String, nullable=False, index=True)
    # NULL for calls with no authenticated actor (e.g. a background workflow
    # whose owner is unknown), which still count toward the per-plugin limit.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    isolation = Column(String, nullable=True)
    # ok | error | blocked | rate_limited
    status = Column(String, nullable=False, index=True, default="ok")
    latency_ms = Column(Integer, default=0)
    # Cost in USD **as declared by the plugin**. The host cannot verify this:
    # a plugin calling a third-party API spends money the backend never sees.
    # Treat it as a budgeting aid for plugins you trust, not an accounting
    # record. A sandboxed plugin with no `network` permission should report 0.
    cost_usd = Column(Float, default=0.0, nullable=False)
    # Bytes the plugin returned, for the per-call output cap.
    output_bytes = Column(Integer, default=0, nullable=False)
    args_preview = Column(Text, nullable=True)
    output_preview = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    # True when args contained a declared secret name and were masked.
    args_redacted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    __table_args__ = (
        # The hot query is "calls for this plugin since T" and "for this user
        # since T", so index both.
        Index("ix_plugin_log_plugin_created", "plugin_name", "created_at"),
        Index("ix_plugin_log_user_created", "user_id", "created_at"),
    )

    def __repr__(self):  # pragma: no cover - debug aid
        return f"<PluginCallLog {self.plugin_name}.{self.tool_name} {self.status}>"
