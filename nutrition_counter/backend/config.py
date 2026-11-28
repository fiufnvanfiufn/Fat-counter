"""Server-only Gemini configuration. Secrets never belong in browser assets."""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    api_key: str = field(default="", repr=False)
    model: str = "gemini-3.1-flash-lite"
    timeout_seconds: float = 30.0
    knowledge_path: Path | None = None

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", self.model):
            raise ValueError("GEMINI_MODEL должен содержать только имя модели без URL и префикса models/.")
        if not math.isfinite(self.timeout_seconds) or not 1 <= self.timeout_seconds <= 120:
            raise ValueError("GEMINI_TIMEOUT_SECONDS должен быть числом от 1 до 120.")


def load_settings(env_file: Path | None = None) -> Settings:
    """Load backend/.env explicitly; shell variables take precedence over that file."""
    load_dotenv(env_file or Path(__file__).with_name(".env"), override=False)
    try:
        timeout = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "30"))
    except ValueError:
        raise ValueError("GEMINI_TIMEOUT_SECONDS должен быть числом от 1 до 120.") from None
    knowledge = os.getenv("KNOWLEDGE_CORPUS", "").strip()
    knowledge_path = None
    if knowledge:
        knowledge_path = Path(knowledge)
        if not knowledge_path.is_absolute():
            knowledge_path = Path(__file__).parent / knowledge_path
    return Settings(
        api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        model=os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite").strip(),
        timeout_seconds=timeout,
        knowledge_path=knowledge_path,
    )
