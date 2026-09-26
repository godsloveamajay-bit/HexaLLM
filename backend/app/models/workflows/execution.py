"""Workflow execution models."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON, Enum, Index, Float
from sqlalchemy.orm import relationship

from app.core.database import Base
import enum


class ExecutionStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"


class NodeExecutionStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


class WorkflowExecution(Base):
    __tablename__ = "workflow_executions"

    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Execution identity
    execution_id = Column(String(64), unique=True, index=True)  # UUID
    
    # Execution state
    status = Column(Enum(ExecutionStatus), default=ExecutionStatus.PENDING, index=True)
    current_node_id = Column(Integer, ForeignKey("workflow_nodes.id", ondelete="SET NULL"), nullable=True)
    
    # Input/Output
    input_data = Column(JSON, nullable=True)
    output_data = Column(JSON, nullable=True)
    variables = Column(JSON, nullable=True)  # Runtime variables
    
    # Metrics
    total_tokens = Column(Integer, default=0)
    total_cost_usd = Column(Float, default=0.0)
    total_latency_ms = Column(Integer, default=0)
    
    # Error handling
    error_message = Column(Text, nullable=True)
    error_node_id = Column(Integer, ForeignKey("workflow_nodes.id", ondelete="SET NULL"), nullable=True)
    retry_count = Column(Integer, default=0)
    
    # Timing
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    workflow = relationship("Workflow", back_populates="executions")
    current_node = relationship("WorkflowNode", foreign_keys=[current_node_id])
    error_node = relationship("WorkflowNode", foreign_keys=[error_node_id])
    node_executions = relationship("NodeExecution", back_populates="execution", cascade="all, delete-orphan", order_by="NodeExecution.started_at")
    
    __table_args__ = (
        Index("ix_workflow_execution_workflow_status", "workflow_id", "status"),
        Index("ix_workflow_execution_user_date", "created_at"),
    )


class NodeExecution(Base):
    __tablename__ = "node_executions"

    id = Column(Integer, primary_key=True, index=True)
    execution_id = Column(Integer, ForeignKey("workflow_executions.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id = Column(Integer, ForeignKey("workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Execution state
    status = Column(Enum(NodeExecutionStatus), default=NodeExecutionStatus.PENDING, index=True)
    attempt = Column(Integer, default=1)
    
    # Input/Output
    input_data = Column(JSON, nullable=True)
    output_data = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Metrics
    tokens_used = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)
    latency_ms = Column(Integer, default=0)
    
    # Retry handling
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    
    # Timing
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    execution = relationship("WorkflowExecution", back_populates="node_executions")
    node = relationship("WorkflowNode", back_populates="executions")
    
    __table_args__ = (
        Index("ix_node_execution_execution_status", "execution_id", "status"),
        Index("ix_node_execution_node_status", "node_id", "status"),
    )
