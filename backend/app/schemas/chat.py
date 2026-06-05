from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import datetime


class ChatMessageIn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: List[ChatMessageIn]
    system_prompt: Optional[str] = None
    session_id: Optional[int] = None
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    stream: bool = True
    knowledge_base_id: Optional[int] = None
    top_k: int = 4
    attachment_base64: Optional[str] = None  # data URL or raw base64
    attachment_type: Optional[str] = None    # "image" | "pdf" | "text"
    attachment_name: Optional[str] = None
    cli_session_id: Optional[str] = None     # nebula daemon session for live tool execution
    personality: Optional[Dict[str, int]] = None  # Personality Engine sliders (0–100)
    regenerate: bool = False                 # re-roll the last answer: replace it in history, don't re-append the user turn


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
