from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from threading import Lock, Thread
from time import perf_counter
import re

import jaconv
from PIL import Image, UnidentifiedImageError
from manga_ocr import MangaOcr

from hf_env import ensure_local_model


@dataclass(slots=True)
class OcrResult:
    text: str
    elapsed_ms: int


def post_process_preserve_lines(text: str) -> str:
    lines = text.splitlines()
    normalized_lines = []
    for line in lines:
        # Remove spaces between Japanese/CJK characters (tokenizer artifact)
        line = re.sub(r'(?<=[^\x00-\x7F])\s+(?=[^\x00-\x7F])', '', line)
        line = " ".join(line.split())
        normalized_lines.append(line)
    text = "\n".join(normalized_lines).strip()
    text = text.replace("…", "...")
    text = re.sub("[・.]{2,}", lambda match: "." * (match.end() - match.start()), text)
    text = jaconv.h2z(text, ascii=True, digit=True)
    return text


class MangaOcrWithLineBreaks(MangaOcr):
    def __call__(self, img_or_path):
        if isinstance(img_or_path, (str, Path)):
            img = Image.open(img_or_path)
        elif isinstance(img_or_path, Image.Image):
            img = img_or_path
        else:
            raise ValueError(f"img_or_path must be a path or PIL.Image, instead got: {img_or_path}")

        img = img.convert("L").convert("RGB")
        x = self._preprocess(img)
        x = self.model.generate(x[None].to(self.model.device), max_length=300)[0].cpu()  # type: ignore[operator]
        x = self.tokenizer.decode(x, skip_special_tokens=True)
        return post_process_preserve_lines(x)


class OcrService:
    def __init__(self) -> None:
        self._model: MangaOcr | None = None
        self._lock = Lock()
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
            model_path = ensure_local_model("kha-white/manga-ocr-base", "ocr")
            self._model = MangaOcrWithLineBreaks(pretrained_model_name_or_path=str(model_path))
            self._load_error = None
        except Exception as exc:  # pragma: no cover - surfaced via status route
            self._load_error = str(exc)
        finally:
            self._is_loading = False

    def status(self) -> dict[str, str | bool | None]:
        return {
            "ready": self._model is not None,
            "loading": self._is_loading,
            "error": self._load_error,
        }

    def recognize_bytes(self, image_bytes: bytes) -> OcrResult:
        if self._model is None:
            raise RuntimeError("OCR model is not ready yet.")

        try:
            with Image.open(BytesIO(image_bytes)) as source_image:
                image = source_image.convert("RGB")
        except UnidentifiedImageError as exc:
            raise ValueError("Unsupported or invalid image.") from exc

        started = perf_counter()
        with self._lock:
            text = self._model(image)
        elapsed_ms = int((perf_counter() - started) * 1000)
        return OcrResult(text=text, elapsed_ms=elapsed_ms)


ocr_service = OcrService()
