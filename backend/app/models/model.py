from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON, Float
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from ..core.database import Base


class AIModel(Base):
    __tablename__ = "ai_models"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    description = Column(Text, nullable=True)
    base_model = Column(String, nullable=False)  # e.g. "llama3.2:3b"
    ollama_model_name = Column(String, nullable=True)  # name registered in Ollama
    tags = Column(JSON, default=list)
    is_public = Column(Boolean, default=True)
    is_fine_tuned = Column(Boolean, default=False)
    parameter_count = Column(String, nullable=True)  # "3B", "7B", etc.
    license = Column(String, default="MIT")
    system_prompt = Column(Text, nullable=True)
    downloads = Column(Integer, default=0)
    likes = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="models")
    training_jobs = relationship("TrainingJob", back_populates="model", cascade="all, delete-orphan")


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    model_id = Column(Integer, ForeignKey("ai_models.id"), nullable=False)
    status = Column(String, default="pending")  # pending, running, completed, failed
    method = Column(String, default="lora")  # lora, qlora, full
    dataset_path = Column(String, nullable=True)
    config = Column(JSON, default=dict)  # epochs, lr, batch_size, etc.
    progress = Column(Float, default=0.0)
    logs = Column(Text, default="")
    error = Column(Text, nullable=True)
    celery_task_id = Column(String, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="training_jobs")
    model = relationship("AIModel", back_populates="training_jobs")
