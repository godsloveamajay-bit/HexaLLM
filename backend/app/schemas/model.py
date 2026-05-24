from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import datetime


class ModelCreate(BaseModel):
    name: str
    description: Optional[str] = None
    base_model: str
    tags: List[str] = []
    is_public: bool = True
    parameter_count: Optional[str] = None
    license: str = "MIT"
    system_prompt: Optional[str] = None


class ModelOut(BaseModel):
    id: int
    owner_id: int
    name: str
    slug: str
    description: Optional[str]
    base_model: str
    ollama_model_name: Optional[str]
    tags: List[str]
    is_public: bool
    is_fine_tuned: bool
    parameter_count: Optional[str]
    license: str
    system_prompt: Optional[str]
    downloads: int
    likes: int
    created_at: datetime
    owner_username: Optional[str] = None

    class Config:
        from_attributes = True


class TrainingConfig(BaseModel):
    method: str = "lora"  # lora, qlora
    epochs: int = 3
    learning_rate: float = 2e-4
    batch_size: int = 4
    max_seq_length: int = 512
    lora_r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05


class TrainingJobCreate(BaseModel):
    config: TrainingConfig = TrainingConfig()


class TrainingJobOut(BaseModel):
    id: int
    model_id: int
    status: str
    method: str
    progress: float
    logs: str
    error: Optional[str]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True
