from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from threading import Lock, Thread
from time import perf_counter

from PIL import Image, UnidentifiedImageError
from manga_ocr import MangaOcr


@dataclass(slots=True)
class OcrResult:
    text: str
    elapsed_ms: int


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
            self._model = MangaOcr()
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
