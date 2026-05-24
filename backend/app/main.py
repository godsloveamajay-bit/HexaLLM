import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .core.config import settings
from .core.database import Base, engine
from .models import user, model, chat, knowledge  # ensure all models are imported for create_all
from .api import auth, models, chat as chat_api, agents, analytics, knowledge as knowledge_api


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    for d in [settings.MODELS_DIR, settings.DATASETS_DIR, settings.UPLOADS_DIR]:
        os.makedirs(d, exist_ok=True)
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="Open-source AI platform for creating, training, and sharing LLMs",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(models.router, prefix="/api/v1")
app.include_router(chat_api.router, prefix="/api/v1")
app.include_router(agents.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(knowledge_api.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    from .services.ollama_service import ollama
    ollama_ok = await ollama.health_check()
    return {
        "status": "ok",
        "version": settings.VERSION,
        "ollama": "connected" if ollama_ok else "disconnected",
    }
