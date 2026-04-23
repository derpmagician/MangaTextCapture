from __future__ import annotations

import os
from dataclasses import dataclass
from threading import Lock, Thread
from time import perf_counter
from typing import Any

from hf_env import configure_hf_environment


DEFAULT_TRANSLATION_MODEL = "Helsinki-NLP/opus-mt-ja-es"
DEFAULT_TARGET_LABEL = "Español"


@dataclass(slots=True)
class TranslationResult:
    text: str
    elapsed_ms: int


class TranslationService:
    def __init__(self) -> None:
        self._model_name = os.getenv("MANGA_TRANSLATION_MODEL", DEFAULT_TRANSLATION_MODEL)
        self._target_label = os.getenv("MANGA_TRANSLATION_TARGET_LABEL", DEFAULT_TARGET_LABEL)
        self._tokenizer: Any | None = None
        self._model: Any | None = None
        self._device: Any | None = None
        self._translate_lock = Lock()
        self._load_lock = Lock()
        self._is_loading = False
        self._load_error: str | None = None

    def start_loading(self) -> None:
        with self._load_lock:
            if self._model is not None or self._is_loading:
                return

            self._is_loading = True
            worker = Thread(target=self._load_model, daemon=True)
            worker.start()

    def _load_model(self) -> None:
        try:
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            configure_hf_environment()
            hf_token = os.getenv("HF_TOKEN")
            load_kwargs = {"token": hf_token} if hf_token else {}

            tokenizer = AutoTokenizer.from_pretrained(self._model_name, **load_kwargs)
            model = AutoModelForSeq2SeqLM.from_pretrained(self._model_name, **load_kwargs)
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            model.to(device)
            model.eval()

            self._tokenizer = tokenizer
            self._model = model
            self._device = device
            self._load_error = None
        except Exception as exc:  # pragma: no cover - surfaced via status route
            self._load_error = str(exc)
            self._tokenizer = None
            self._model = None
            self._device = None
        finally:
            self._is_loading = False

    def status(self) -> dict[str, str | bool | None]:
        return {
            "ready": self._model is not None,
            "loading": self._is_loading,
            "error": self._load_error,
            "modelName": self._model_name,
            "targetLabel": self._target_label,
        }

    def translate_text(self, text: str) -> TranslationResult:
        if self._model is None or self._tokenizer is None or self._device is None:
            raise RuntimeError("Translation model is not ready yet.")

        lines = text.splitlines()
        non_empty = [line.strip() for line in lines if line.strip()]
        if not non_empty:
            raise ValueError("No text was provided for translation.")

        started = perf_counter()
        with self._translate_lock:
            translated_lines = self._translate_batch(non_empty)
        elapsed_ms = int((perf_counter() - started) * 1000)

        translated_iter = iter(translated_lines)
        merged_lines = [next(translated_iter) if line.strip() else "" for line in lines]
        return TranslationResult(text="\n".join(merged_lines), elapsed_ms=elapsed_ms)

    def _translate_batch(self, texts: list[str]) -> list[str]:
        import torch

        encoded = self._tokenizer(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
        )
        encoded = {name: tensor.to(self._device) for name, tensor in encoded.items()}

        with torch.no_grad():
            generated = self._model.generate(**encoded)

        return self._tokenizer.batch_decode(generated, skip_special_tokens=True)


translation_service = TranslationService()