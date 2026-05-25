from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_NAME: str = "NebulaX AI Platform"
    VERSION: str = "0.4.0"
    DEBUG: bool = False

    DATABASE_URL: str = "sqlite:///./nebulaxai.db"
    REDIS_URL: str = "redis://localhost:6379/0"

    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    OLLAMA_BASE_URL: str = "http://localhost:11434"

    MODELS_DIR: str = "./models"
    DATASETS_DIR: str = "./datasets"
    UPLOADS_DIR: str = "./uploads"

    MAX_UPLOAD_SIZE_MB: int = 500

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
