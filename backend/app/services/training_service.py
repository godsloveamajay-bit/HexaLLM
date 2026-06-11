"""
Fine-tuning service using Hugging Face PEFT (LoRA/QLoRA).
Runs as a Celery background task.
"""
import os
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def run_training_job(job_id: int, model_base: str, dataset_path: str, config: dict, output_dir: str):
    """
    Execute a LoRA fine-tuning job. Called by Celery worker.
    Updates job status in the database throughout.
    """
    try:
        import torch
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            TrainingArguments,
            Trainer,
            DataCollatorForSeq2Seq,
        )
        from peft import LoraConfig, get_peft_model, TaskType
        from datasets import load_dataset

        from ..core.database import SessionLocal
        from ..models.model import TrainingJob

        db = SessionLocal()

        def update_job(status: str = None, progress: float = None, logs: str = None, error: str = None):
            job = db.query(TrainingJob).filter(TrainingJob.id == job_id).first()
            if not job:
                return
            if status:
                job.status = status
            if progress is not None:
                job.progress = progress
            if logs:
                job.logs = (job.logs or "") + logs + "\n"
            if error:
                job.error = error
            if status == "running" and not job.started_at:
                job.started_at = datetime.now(timezone.utc)
            if status in ("completed", "failed"):
                job.completed_at = datetime.now(timezone.utc)
            db.commit()

        update_job(status="running", logs="[INFO] Loading tokenizer and model...")

        os.makedirs(output_dir, exist_ok=True)

        tokenizer = AutoTokenizer.from_pretrained(model_base)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        use_cuda = torch.cuda.is_available()
        if config.get("method") == "qlora" and use_cuda:
            from transformers import BitsAndBytesConfig
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
            )
            load_kwargs = {"device_map": "auto", "quantization_config": bnb_config}
        elif use_cuda:
            load_kwargs = {"device_map": "auto", "torch_dtype": torch.bfloat16}
        else:
            # CPU-only box: QLoRA/4-bit needs a GPU (the bitsandbytes here is built
            # without GPU support). Fall back to full-precision LoRA on CPU — works,
            # but slow, so keep base models small (≤1-3B) and datasets tiny.
            load_kwargs = {"torch_dtype": torch.float32}
            update_job(logs="[WARN] No GPU detected — training LoRA on CPU in float32 (slow); QLoRA/4-bit disabled. Use a small base model.")

        model = AutoModelForCausalLM.from_pretrained(model_base, **load_kwargs)
        if not use_cuda:
            model = model.to("cpu")

        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=config.get("lora_r", 16),
            lora_alpha=config.get("lora_alpha", 32),
            lora_dropout=config.get("lora_dropout", 0.05),
            target_modules=["q_proj", "v_proj"],
        )
        model = get_peft_model(model, lora_config)
        update_job(logs="[INFO] LoRA adapter applied. Loading dataset...")

        # Support JSONL, CSV, or text files
        ext = Path(dataset_path).suffix.lower()
        if ext in (".jsonl", ".json"):
            dataset = load_dataset("json", data_files=dataset_path, split="train")
        elif ext == ".csv":
            dataset = load_dataset("csv", data_files=dataset_path, split="train")
        else:
            dataset = load_dataset("text", data_files=dataset_path, split="train")

        max_len = config.get("max_seq_length", 512)

        def tokenize(example):
            text = example.get("text") or example.get("instruction", "") + " " + example.get("output", "")
            return tokenizer(text, truncation=True, max_length=max_len, padding="max_length")

        tokenized = dataset.map(tokenize, batched=True, remove_columns=dataset.column_names)
        update_job(logs=f"[INFO] Dataset loaded: {len(dataset)} examples. Starting training...")

        training_args = TrainingArguments(
            output_dir=output_dir,
            num_train_epochs=config.get("epochs", 3),
            per_device_train_batch_size=config.get("batch_size", 4),
            learning_rate=config.get("learning_rate", 2e-4),
            save_strategy="epoch",
            logging_steps=10,
            fp16=torch.cuda.is_available(),
            report_to="none",
        )

        total_steps = len(tokenized) * config.get("epochs", 3) // config.get("batch_size", 4)

        class ProgressCallback:
            def on_log(self, args, state, control, logs=None, **kwargs):
                if logs and state.global_step:
                    progress = min(state.global_step / max(total_steps, 1), 1.0)
                    loss = logs.get("loss", 0)
                    update_job(
                        progress=progress * 100,
                        logs=f"[STEP {state.global_step}] loss={loss:.4f}",
                    )

        from transformers import TrainerCallback
        class _Callback(TrainerCallback):
            def on_log(self, args, state, control, logs=None, **kwargs):
                if logs and state.global_step:
                    progress = min(state.global_step / max(total_steps, 1), 1.0)
                    loss = logs.get("loss", 0)
                    update_job(
                        progress=progress * 100,
                        logs=f"[STEP {state.global_step}] loss={loss:.4f}",
                    )

        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=tokenized,
            data_collator=DataCollatorForSeq2Seq(tokenizer, model=model, padding=True),
            callbacks=[_Callback()],
        )

        trainer.train()
        model.save_pretrained(output_dir)
        tokenizer.save_pretrained(output_dir)

        update_job(status="completed", progress=100.0, logs="[INFO] Training completed successfully.")
        db.close()

    except Exception as e:
        try:
            update_job(status="failed", error=str(e), logs=f"[ERROR] {e}")
            db.close()
        except Exception:
            pass
        raise
