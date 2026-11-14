from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime


class ChatMessageIn(BaseModel):
    role: str
    content: str = Field(..., min_length=1, max_length=32000)

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in {"user", "assistant", "system"}:
            raise ValueError("invalid role")
        return v


class ChatRequest(BaseModel):
    model: str = Field(..., min_length=1, max_length=200)
    messages: List[ChatMessageIn] = Field(..., min_length=1, max_length=200)
    system_prompt: Optional[str] = Field(default=None, max_length=8000)
    session_id: Optional[int] = Field(default=None, ge=1)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=32768)
    stream: bool = True
    # Structured output: {"type": "json_object"} or {"type": "json_schema", "json_schema": {...}}.
    response_format: Optional[Dict[str, Any]] = None
    attachment_base64: Optional[str] = Field(default=None, max_length=15_000_000)
    attachment_type: Optional[str] = Field(default=None, pattern="^(image|pdf|text)$")
    attachment_name: Optional[str] = Field(default=None, max_length=255)
    personality: Optional[Dict[str, int]] = None  # Personality Engine sliders (0–100)
    regenerate: bool = False                 # re-roll the last answer: replace it in history, don't re-append the user turn
    web_search: bool = False                 # ground the answer with live web results
    ollama_options: Optional[Dict[str, Any]] = None  # advanced Ollama generation params (Hyper+ plan)
    image_result_base64: Optional[str] = None  # client-generated (Puter) image data URL — skips the server-side Stability call


class ImageIntentIn(BaseModel):
    text: str


class ChatSessionCreate(BaseModel):
    model_name: str
    title: Optional[str] = "New Chat"
    system_prompt: Optional[str] = None


class ChatSessionOut(BaseModel):
    id: int
    title: str
    model_name: str
    system_prompt: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    tokens_used: Optional[int]
    latency_ms: Optional[int]
    steps: Optional[List[dict]] = None
    is_bookmarked: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class AgentTaskCreate(BaseModel):
    task: str
    model: str = "llama3:8B"
    tools: List[str] = ["web_search", "code_exec", "read_file"]
    max_steps: int = 10
    system_prompt: Optional[str] = None
    mcp_server_ids: List[int] = []
    generated_tool_ids: List[int] = []
    subagent_model: Optional[str] = None
    subagent_max_depth: Optional[int] = None
    images: Optional[List[str]] = None  # base64 images for vision-aware runs


class AgentStepOut(BaseModel):
    step: int
    tool: Optional[str]
    input: Optional[str]
    output: Optional[str]
    thought: Optional[str]


class AgentRunOut(BaseModel):
    id: int
    task: str
    model_name: str
    status: str
    steps: List[Dict]
    result: Optional[str]
    error: Optional[str]
    prompt_tokens: int = 0
    completion_tokens: int = 0
    created_at: datetime
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True
