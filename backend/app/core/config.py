from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "HexaLLM AI Platform"
    VERSION: str = "14.0.2"
    DEBUG: bool = False

    DATABASE_URL: str = "sqlite:///./hexallm.db"
    REDIS_URL: str = "redis://localhost:6379/0"

    SECRET_KEY: str = "change-me-in-production-use-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    OLLAMA_BASE_URL: str = "http://localhost:11434"

    # Stability AI — image-generation API key (https://platform.stability.ai).
    STABILITY_API_KEY: str = ""

    MODELS_DIR: str = "./models"
    DATASETS_DIR: str = "./datasets"
    UPLOADS_DIR: str = "./uploads"

    MAX_UPLOAD_SIZE_MB: int = 500

    # OAuth providers — leave client ID blank to disable that provider
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""

    YAHOO_CLIENT_ID: str = ""
    YAHOO_CLIENT_SECRET: str = ""

    # Apple Sign In — requires Apple Developer account
    APPLE_CLIENT_ID: str = ""       # Services ID (com.example.app)
    APPLE_TEAM_ID: str = ""
    APPLE_KEY_ID: str = ""
    APPLE_PRIVATE_KEY: str = ""     # PEM private key, newlines replaced with \n

    # Samsung Account — requires Samsung Developer account
    SAMSUNG_CLIENT_ID: str = ""
    SAMSUNG_CLIENT_SECRET: str = ""

    # SMTP — leave blank to disable email sending (reset links logged to console instead)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@hexallm.local"
    APP_URL: str = "https://ai.hexallm.co.uk"

    # PayPal — leave blank to disable billing features
    PAYPAL_CLIENT_ID: str = ""
    PAYPAL_CLIENT_SECRET: str = ""
    PAYPAL_WEBHOOK_ID: str = ""
    PAYPAL_SANDBOX: bool = True

    class Config:
        env_file = ".env"
        case_sensitive = True
        # Ignore .env keys that aren't declared here (e.g. TAVILY_API_KEY, which is
        # read via os.getenv) instead of crashing startup with extra_forbidden.
        extra = "ignore"


settings = Settings()
