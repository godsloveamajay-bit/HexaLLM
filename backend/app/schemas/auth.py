from pydantic import BaseModel, EmailStr
from typing import Optional, Dict, List
from datetime import datetime


class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class PlanBrief(BaseModel):
    id: int
    name: str
    slug: str

    class Config:
        from_attributes = True


class SubscriptionBrief(BaseModel):
    id: int
    plan: Optional[PlanBrief]
    status: str
    interval: str
    current_period_end: Optional[datetime]
    cancel_at_period_end: bool

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    bio: Optional[str]
    is_admin: bool
    created_at: datetime
    # AI preferences
    ai_instructions: Optional[str] = None
    ai_default_model: Optional[str] = None
    ai_temperature: Optional[float] = None
    ai_max_tokens: Optional[int] = None
    ai_default_kb_id: Optional[int] = None
    ai_reasoning: Optional[bool] = None
    ai_personality: Optional[Dict[str, int]] = None
    # Billing
    plan_id: Optional[int] = None
    subscription: Optional[SubscriptionBrief] = None

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    ai_instructions: Optional[str] = None
    ai_default_model: Optional[str] = None
    ai_temperature: Optional[float] = None
    ai_max_tokens: Optional[int] = None
    ai_default_kb_id: Optional[int] = None
    ai_reasoning: Optional[bool] = None
    ai_personality: Optional[Dict[str, int]] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class APIKeyCreate(BaseModel):
    name: str
    persona_id: Optional[int] = None   # bind to a saved persona ("Expose as API")
    model: Optional[str] = None        # or expose a raw model directly


class APIKeyOut(BaseModel):
    id: int
    name: str
    key: str
    is_active: bool
    workspace_id: Optional[int] = None
    persona_id: Optional[int] = None
    persona_name: Optional[str] = None
    model_name: Optional[str] = None
    request_count: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    created_at: datetime
    last_used_at: Optional[datetime]

    class Config:
        from_attributes = True
