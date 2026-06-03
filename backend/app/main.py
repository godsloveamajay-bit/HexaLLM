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
from .models import user, model, chat, knowledge, template, memory, persona, workflow, mcp_server  # noqa: F401
from .api import (
    auth, models, chat as chat_api, agents, analytics,
    knowledge as knowledge_api, image as image_api, video as video_api,
    templates as templates_api, memory as memory_api,
    personas as personas_api, workflows as workflows_api,
    openai_compat, mcp as mcp_api, cli_tunnel as cli_tunnel_api,
    downloads as downloads_api, transcribe as transcribe_api,
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

        if "saved_personas" in inspector.get_table_names():
            persona_cols = {c["name"] for c in inspector.get_columns("saved_personas")}
            if "is_favorite" not in persona_cols:
                conn.execute(text("ALTER TABLE saved_personas ADD COLUMN is_favorite BOOLEAN DEFAULT 0"))
            if "last_used_at" not in persona_cols:
                conn.execute(text("ALTER TABLE saved_personas ADD COLUMN last_used_at DATETIME"))

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
    allow_origins=["*"],
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
app.include_router(agents.router,         prefix="/api/v1")
app.include_router(analytics.router,      prefix="/api/v1")
app.include_router(knowledge_api.router,  prefix="/api/v1")
app.include_router(image_api.router,      prefix="/api/v1")
app.include_router(video_api.router,       prefix="/api/v1")
app.include_router(templates_api.router,  prefix="/api/v1")
app.include_router(memory_api.router,     prefix="/api/v1")
app.include_router(personas_api.router,   prefix="/api/v1")
app.include_router(workflows_api.router,  prefix="/api/v1")
app.include_router(mcp_api.router,        prefix="/api/v1")
app.include_router(openai_compat.router,  prefix="/api/v1")
app.include_router(cli_tunnel_api.router, prefix="/api/v1")
app.include_router(downloads_api.router,  prefix="/api/v1")
app.include_router(transcribe_api.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    from .services.ollama_service import ollama
    ollama_ok = await ollama.health_check()
    return {
        "status": "ok",
        "version": settings.VERSION,
        "ollama": "connected" if ollama_ok else "disconnected",
    }
