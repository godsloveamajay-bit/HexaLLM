import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import inspect, text
from .core.config import settings
from .core.database import Base, engine
from .models import user, chat, template, memory, billing, workspace  # noqa: F401
from .api import (
    auth, models, chat as chat_api, image as image_api,
    templates as templates_api, memory as memory_api,
    transcribe as transcribe_api, billing as billing_api,
    admin as admin_api, agents as agents_api, mcp as mcp_api,
    workflows as workflows_api, knowledge as knowledge_api,
    tools as tools_api, personas as personas_api,
    analytics as analytics_api, downloads as downloads_api, workspaces as workspaces_api,
    tasks as tasks_api, dev as dev_api,
    openai_compat as openai_compat_api, cli_tunnel as cli_tunnel_api,
    voice as voice_api,
)


def _migrate_db():
    inspector = inspect(engine)
    with engine.begin() as conn:
        existing_cols = {c["name"] for c in inspector.get_columns("chat_sessions")}
        if "share_token" not in existing_cols:
            conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN share_token VARCHAR"))
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_chat_sessions_share_token "
                "ON chat_sessions (share_token)"
            ))

        user_cols = {c["name"] for c in inspector.get_columns("users")}
        if "oauth_provider" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN oauth_provider VARCHAR"))
        if "oauth_id" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN oauth_id VARCHAR"))
        # AI preferences (Settings → AI Assistant)
        if "ai_instructions" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_instructions TEXT"))
        if "ai_default_model" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_default_model VARCHAR"))
        if "ai_temperature" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_temperature FLOAT"))
        if "ai_max_tokens" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_max_tokens INTEGER"))
        if "ai_default_kb_id" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_default_kb_id INTEGER"))
        if "ai_reasoning" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_reasoning BOOLEAN"))
        if "ai_personality" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN ai_personality JSON"))
        if "voice_name" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN voice_name VARCHAR"))
        if "voice_streaming" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN voice_streaming BOOLEAN"))

        # Drop the NOT NULL constraint on hashed_password by recreating the table.
        # SQLite cannot ALTER a column constraint, so we use the recommended rename approach.
        # Only needed if the column was originally created NOT NULL.
        hashed_pw_col = next((c for c in inspector.get_columns("users") if c["name"] == "hashed_password"), None)
        if hashed_pw_col and not hashed_pw_col.get("nullable", True):
            conn.execute(text("PRAGMA foreign_keys = OFF"))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS users_new (
                    id INTEGER PRIMARY KEY,
                    email VARCHAR NOT NULL UNIQUE,
                    username VARCHAR NOT NULL UNIQUE,
                    hashed_password VARCHAR,
                    oauth_provider VARCHAR,
                    oauth_id VARCHAR,
                    full_name VARCHAR,
                    avatar_url VARCHAR,
                    bio TEXT,
                    is_active BOOLEAN DEFAULT 1,
                    is_admin BOOLEAN DEFAULT 0,
                    created_at DATETIME,
                    updated_at DATETIME
                )
            """))
            conn.execute(text("""
                INSERT INTO users_new SELECT
                    id, email, username, hashed_password, oauth_provider, oauth_id,
                    full_name, avatar_url, bio, is_active, is_admin, created_at, updated_at
                FROM users
            """))
            conn.execute(text("DROP TABLE users"))
            conn.execute(text("ALTER TABLE users_new RENAME TO users"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_id ON users (id)"))
            conn.execute(text("PRAGMA foreign_keys = ON"))

        # Billing tables — created by Base.metadata.create_all, but add user cols
        user_cols = {c["name"] for c in inspector.get_columns("users")}
        if "plan_id" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN plan_id INTEGER"))
        if "paypal_customer_id" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN paypal_customer_id VARCHAR"))
        if "token_version" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0"))

        # Dev workspaces — api_keys gains an optional workspace_id column
        key_cols = {c["name"] for c in inspector.get_columns("api_keys")}
        if "workspace_id" not in key_cols:
            conn.execute(text("ALTER TABLE api_keys ADD COLUMN workspace_id INTEGER"))
        # Per-key sampling overrides (OpenAI-compat)
        if "temperature" not in key_cols:
            conn.execute(text("ALTER TABLE api_keys ADD COLUMN temperature FLOAT"))
        if "top_p" not in key_cols:
            conn.execute(text("ALTER TABLE api_keys ADD COLUMN top_p FLOAT"))
        if "max_tokens" not in key_cols:
            conn.execute(text("ALTER TABLE api_keys ADD COLUMN max_tokens INTEGER"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_db()
    for d in [settings.MODELS_DIR, settings.DATASETS_DIR, settings.UPLOADS_DIR]:
        os.makedirs(d, exist_ok=True)
    yield


# Rate limiter — shared across the app, keyed by remote IP
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="Open-source AI platform for creating, training, and sharing LLMs",
    lifespan=lifespan,
    # Disable the default docs in production; keep for self-hosted use
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# Attach rate limiter state and error handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Middleware stack (innermost first) ────────────────────────────────────────

# GZip all responses ≥ 1 KB — reduces JSON payload by ~70%
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        ["*"] if settings.DEBUG else
        [
            settings.APP_URL,
            "http://localhost:3000", "http://localhost:5173", "http://localhost:8080",
            "https://dev.hexallm.co.uk",
        ]
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # Don't add HSTS here — nginx handles TLS termination
    return response


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router,           prefix="/api/v1")
app.include_router(models.router,         prefix="/api/v1")
app.include_router(chat_api.router,       prefix="/api/v1")
app.include_router(image_api.router,      prefix="/api/v1")
app.include_router(templates_api.router,  prefix="/api/v1")
app.include_router(memory_api.router,     prefix="/api/v1")
app.include_router(transcribe_api.router, prefix="/api/v1")
app.include_router(voice_api.router,        prefix="/api/v1")
app.include_router(tasks_api.router,          prefix="/api/v1")
app.include_router(dev_api.router,          prefix="/api/v1")
app.include_router(billing_api.router,    prefix="/api/v1")
app.include_router(admin_api.router,      prefix="/api/v1")
app.include_router(agents_api.router,     prefix="/api/v1")
app.include_router(mcp_api.router,        prefix="/api/v1")
app.include_router(workflows_api.router,  prefix="/api/v1")
app.include_router(knowledge_api.router,  prefix="/api/v1")
app.include_router(tools_api.router,      prefix="/api/v1")
app.include_router(personas_api.router,   prefix="/api/v1")
app.include_router(analytics_api.router,  prefix="/api/v1")
app.include_router(downloads_api.router,  prefix="/api/v1")
app.include_router(workspaces_api.router, prefix="/api/v1")
# OpenAI-compatible API — clean /v1 base (frontend advertises ${origin}/v1)
# plus /api/v1/openai back-compat alias. Mounted after the chat router so the
# dedicated OpenAI paths don't collide with the UI ones.
app.include_router(openai_compat_api.router, prefix="/v1")
app.include_router(openai_compat_api.router, prefix="/api/v1/openai")
app.include_router(cli_tunnel_api.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    from .services.ollama_service import ollama
    ollama_ok = await ollama.health_check()
    return {
        "status": "ok",
        "version": settings.VERSION,
        "ollama": "connected" if ollama_ok else "disconnected",
    }
