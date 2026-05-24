import os
import re
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.config import settings
from ..models.user import User
from ..models.model import AIModel, TrainingJob
from ..schemas.model import ModelCreate, ModelOut, TrainingJobCreate, TrainingJobOut
from ..services.ollama_service import ollama
from ..services import model_router

router = APIRouter(prefix="/models", tags=["models"])


def make_slug(name: str, user_id: int) -> str:
    slug = re.sub(r"[^a-z0-9-]", "-", name.lower()).strip("-")
    return f"{user_id}-{slug}"


@router.get("", response_model=List[ModelOut])
def list_models(
    search: Optional[str] = None,
    tag: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    if current_user.is_admin:
        q = db.query(AIModel)
    else:
        q = db.query(AIModel).filter(
            (AIModel.is_public == True) | (AIModel.owner_id == current_user.id)
        )
    if search:
        q = q.filter(AIModel.name.ilike(f"%{search}%"))
    models = q.order_by(AIModel.downloads.desc()).all()

    result = []
    for m in models:
        out = ModelOut.model_validate(m)
        out.owner_username = m.owner.username if m.owner else None
        result.append(out)
    return result


@router.get("/my", response_model=List[ModelOut])
def my_models(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    models = db.query(AIModel).filter(AIModel.owner_id == current_user.id).all()
    result = []
    for m in models:
        out = ModelOut.model_validate(m)
        out.owner_username = current_user.username
        result.append(out)
    return result


@router.post("", response_model=ModelOut, status_code=201)
def create_model(
    data: ModelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    slug = make_slug(data.name, current_user.id)
    if db.query(AIModel).filter(AIModel.slug == slug).first():
        slug = slug + "-1"

    model = AIModel(
        owner_id=current_user.id,
        name=data.name,
        slug=slug,
        description=data.description,
        base_model=data.base_model,
        ollama_model_name=data.base_model,
        tags=data.tags,
        is_public=data.is_public,
        parameter_count=data.parameter_count,
        license=data.license,
        system_prompt=data.system_prompt,
    )
    db.add(model)
    db.commit()
    db.refresh(model)

    out = ModelOut.model_validate(model)
    out.owner_username = current_user.username
    return out


@router.get("/{model_id}", response_model=ModelOut)
def get_model(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    model = db.query(AIModel).filter(AIModel.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if not model.is_public and model.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    out = ModelOut.model_validate(model)
    out.owner_username = model.owner.username if model.owner else None
    return out


@router.delete("/{model_id}", status_code=204)
def delete_model(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    model = db.query(AIModel).filter(AIModel.id == model_id, AIModel.owner_id == current_user.id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    db.delete(model)
    db.commit()


@router.post("/{model_id}/like", status_code=200)
def like_model(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    model = db.query(AIModel).filter(AIModel.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    model.likes += 1
    db.commit()
    return {"likes": model.likes}


# ── Training ──────────────────────────────────────────────────────────────────

@router.post("/{model_id}/dataset", status_code=200)
async def upload_dataset(
    model_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    model = db.query(AIModel).filter(AIModel.id == model_id, AIModel.owner_id == current_user.id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    os.makedirs(settings.DATASETS_DIR, exist_ok=True)
    dest = Path(settings.DATASETS_DIR) / f"{model_id}_{file.filename}"

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return {"path": str(dest), "filename": file.filename}


@router.post("/{model_id}/train", response_model=TrainingJobOut, status_code=201)
def start_training(
    model_id: int,
    data: TrainingJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    model = db.query(AIModel).filter(AIModel.id == model_id, AIModel.owner_id == current_user.id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    dataset_path = str(Path(settings.DATASETS_DIR) / f"{model_id}_dataset.jsonl")
    if not os.path.exists(dataset_path):
        # look for any file matching the model id
        candidates = list(Path(settings.DATASETS_DIR).glob(f"{model_id}_*"))
        if not candidates:
            raise HTTPException(status_code=400, detail="No dataset uploaded for this model. Upload a dataset first.")
        dataset_path = str(candidates[0])

    job = TrainingJob(
        user_id=current_user.id,
        model_id=model_id,
        method=data.config.method,
        dataset_path=dataset_path,
        config=data.config.model_dump(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    output_dir = str(Path(settings.MODELS_DIR) / f"ft_{model_id}_{job.id}")

    try:
        from celery import Celery
        from ..core.config import settings as s
        celery_app = Celery(broker=s.REDIS_URL, backend=s.REDIS_URL)

        @celery_app.task
        def train_task(job_id, model_base, dataset_path, config, output_dir):
            from ..services.training_service import run_training_job
            run_training_job(job_id, model_base, dataset_path, config, output_dir)

        task = train_task.delay(job.id, model.base_model, dataset_path, data.config.model_dump(), output_dir)
        job.celery_task_id = task.id
        db.commit()
    except Exception:
        # Fall back to background task if Celery/Redis not available
        from ..services.training_service import run_training_job
        background_tasks.add_task(run_training_job, job.id, model.base_model, dataset_path, data.config.model_dump(), output_dir)

    db.refresh(job)
    return job


@router.get("/{model_id}/jobs", response_model=List[TrainingJobOut])
def list_training_jobs(model_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    jobs = db.query(TrainingJob).filter(
        TrainingJob.model_id == model_id,
        TrainingJob.user_id == current_user.id,
    ).order_by(TrainingJob.created_at.desc()).all()
    return jobs


@router.get("/{model_id}/jobs/{job_id}", response_model=TrainingJobOut)
def get_training_job(model_id: int, job_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    job = db.query(TrainingJob).filter(
        TrainingJob.id == job_id,
        TrainingJob.model_id == model_id,
        TrainingJob.user_id == current_user.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ── Ollama passthrough ────────────────────────────────────────────────────────

@router.get("/ollama/list")
async def ollama_list():
    models = await ollama.list_models()
    return {"models": models}


@router.get("/nebulax/variants")
async def list_nebulax_variants():
    """List the NebulaX virtual models and which underlying bases are ready."""
    available = {m["name"] for m in await ollama.list_models()}
    out = []
    for vid, v in model_router.VARIANTS.items():
        candidates = v.all_candidates()
        ready = [c for c in candidates if c in available]
        out.append({
            "id": v.id,
            "label": v.label,
            "description": v.description,
            "default_model": v.default_model,
            "candidates": candidates,
            "available_bases": ready,
            "ready": len(ready) > 0,
            "missing_bases": [c for c in candidates if c not in available],
        })
    return {"variants": out}


@router.post("/ollama/pull")
async def ollama_pull(body: dict, current_user: User = Depends(get_current_user)):
    model_name = body.get("model")
    if not model_name:
        raise HTTPException(status_code=400, detail="model required")

    async def stream():
        async for line in ollama.pull_model(model_name):
            yield line + "\n"

    return StreamingResponse(stream(), media_type="text/plain")
