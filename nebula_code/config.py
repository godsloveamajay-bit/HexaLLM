import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

CONFIG_DIR = Path.home() / ".nebula"
CONFIG_FILE = CONFIG_DIR / "config.json"

_FIELDS = {"model", "ollama_url", "nebulax_url", "nebulax_token", "max_steps", "temperature"}


@dataclass
class Config:
    model: str = "llama3.2:3b"
    ollama_url: str = "http://localhost:11434"
    nebulax_url: Optional[str] = None
    nebulax_token: Optional[str] = None
    max_steps: int = 20
    temperature: float = 0.1


def load_config() -> Config:
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text())
            return Config(**{k: v for k, v in data.items() if k in _FIELDS})
        except Exception:
            pass
    return Config()


def save_config(cfg: Config) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(asdict(cfg), indent=2))
