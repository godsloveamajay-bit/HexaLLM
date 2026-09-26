"""Workflow and node models."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index, JSON, Boolean
from sqlalchemy.orm import relationship

from app.core.database import Base


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    version = Column(Integer, default=1)
    
    # Serialized workflow definition
    definition = Column(JSON, nullable=False)  # nodes, edges, input/output schemas
    
    # Metadata
    is_active = Column(Boolean, default=True)
    is_public = Column(Boolean, default=False)
    is_template = Column(Boolean, default=False)
    tags = Column(JSON, nullable=True)  # List of tags

    # ── Legacy task-runner fields ────────────────────────────────────────────
    # Kept so the existing Workflows page (task → single agent run) keeps
    # working against the same table. Nullable: visual-DAG workflows leave
    # them empty.
    task = Column(Text, nullable=True)
    model = Column(String(255), nullable=True)
    tools = Column(JSON, default=list)
    system_prompt = Column(Text, nullable=True)
    max_steps = Column(Integer, default=10)
    schedule = Column(String(255), nullable=True)  # cron expression or "manual"
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    run_count = Column(Integer, default=0)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_result = Column(Text, nullable=True)
    last_error = Column(Text, nullable=True)
    
    # Ownership
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Optional legacy column — populated when a workflow was created before
    # the owner_id migration. Kept so old rows stay readable.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    # `user` is kept as the canonical name because the rest of the codebase
    # (and User.workflows) refers to the relationship by that name.
    user = relationship("User", foreign_keys=[owner_id], back_populates="workflows")
    nodes = relationship("WorkflowNode", back_populates="workflow", cascade="all, delete-orphan")
    edges = relationship("WorkflowEdge", back_populates="workflow", cascade="all, delete-orphan")
    executions = relationship("WorkflowExecution", back_populates="workflow", cascade="all, delete-orphan")


class WorkflowNode(Base):
    __tablename__ = "workflow_nodes"

    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Node identity within workflow
    node_id = Column(String(100), nullable=False, index=True)  # e.g., "n1", "llm_1"
    
    # Node type and configuration
    node_type = Column(String(50), nullable=False, index=True)  # llm, tool, condition, loop, parallel, human, transform, subworkflow
    config = Column(JSON, nullable=False)  # Node-specific configuration
    
    # Input/output mapping
    input_mapping = Column(JSON, nullable=True)  # Maps workflow inputs to node inputs
    output_schema = Column(JSON, nullable=True)  # Expected output structure
    
    # Position for UI
    position_x = Column(Integer, default=0)
    position_y = Column(Integer, default=0)
    
    # Metadata
    is_active = Column(Boolean, default=True)
    is_public = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    workflow = relationship("Workflow", back_populates="nodes")
    outgoing_edges = relationship("WorkflowEdge", foreign_keys="WorkflowEdge.from_node_id", back_populates="from_node")
    incoming_edges = relationship("WorkflowEdge", foreign_keys="WorkflowEdge.to_node_id", back_populates="to_node")
    executions = relationship("NodeExecution", back_populates="node", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_workflow_node_workflow_node_id", "workflow_id", "node_id", unique=True),
    )


class WorkflowEdge(Base):
    __tablename__ = "workflow_edges"

    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Connection
    from_node_id = Column(Integer, ForeignKey("workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    to_node_id = Column(Integer, ForeignKey("workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Port mapping
    from_output = Column(String(100), default="output")  # Output port name from source
    to_input = Column(String(100), default="input")      # Input port name on target
    
    # Edge metadata
    label = Column(String(100), nullable=True)
    style = Column(JSON, nullable=True)  # UI styling (color, dashed, etc.)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    workflow = relationship("Workflow", back_populates="edges")
    from_node = relationship("WorkflowNode", foreign_keys=[from_node_id], back_populates="outgoing_edges")
    to_node = relationship("WorkflowNode", foreign_keys=[to_node_id], back_populates="incoming_edges")

    __table_args__ = (
        Index("ix_workflow_edge_workflow_from_to", "workflow_id", "from_node_id", "to_node_id", unique=True),
    )
