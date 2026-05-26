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
    knowledge as knowledge_api, image as image_api,
    templates as templates_api, memory as memory_api,
    personas as personas_api, workflows as workflows_api,
    openai_compat, mcp as mcp_api, cli_tunnel as cli_tunnel_api,
    downloads as downloads_api,
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
app.include_router(templates_api.router,  prefix="/api/v1")
app.include_router(memory_api.router,     prefix="/api/v1")
app.include_router(personas_api.router,   prefix="/api/v1")
app.include_router(workflows_api.router,  prefix="/api/v1")
app.include_router(mcp_api.router,        prefix="/api/v1")
app.include_router(openai_compat.router,  prefix="/api/v1")
app.include_router(cli_tunnel_api.router, prefix="/api/v1")
app.include_router(downloads_api.router,  prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    from .services.ollama_service import ollama
    ollama_ok = await ollama.health_check()
    return {
        "status": "ok",
        "version": settings.VERSION,
        "ollama": "connected" if ollama_ok else "disconnected",
    }
