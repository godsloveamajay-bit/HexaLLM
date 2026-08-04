from celery import Celery
from .core.config import settings

celery_app = Celery(
    "hexallm",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)


@celery_app.task(bind=True, name="train_model")
def train_model_task(self, job_id: int, model_base: str, dataset_path: str, config: dict, output_dir: str):
    from .services.training_service import run_training_job
    run_training_job(job_id, model_base, dataset_path, config, output_dir)
