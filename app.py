from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from ocr_service import ocr_service
from translation_service import translation_service


BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Manga OCR Reader")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class TranslateRequest(BaseModel):
    text: str


@app.on_event("startup")
async def startup_event() -> None:
    ocr_service.start_loading()
    translation_service.start_loading()
    print("Go to http://127.0.0.1:8000/")


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"title": "Manga OCR Reader"},
    )


@app.get("/api/status")
async def get_status() -> JSONResponse:
    ocr_status = ocr_service.status()
    return JSONResponse({
        **ocr_status,
        "translation": translation_service.status(),
    })


@app.post("/api/ocr")
async def post_ocr(image: UploadFile = File(...)) -> JSONResponse:
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="No image was provided.")

    status = ocr_service.status()
    if not status["ready"]:
        detail = "OCR model is still loading. Wait until the status shows ready."
        if status["error"]:
            detail = f"OCR model failed to load: {status['error']}"
        raise HTTPException(status_code=503, detail=detail)

    try:
        result = ocr_service.recognize_bytes(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive API boundary
        raise HTTPException(status_code=500, detail="OCR processing failed.") from exc

    return JSONResponse(
        {
            "text": result.text,
            "elapsedMs": result.elapsed_ms,
        }
    )


@app.post("/api/translate")
async def post_translate(payload: TranslateRequest) -> JSONResponse:
    source_text = payload.text.strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="No text was provided for translation.")

    status = translation_service.status()
    if not status["ready"]:
        detail = "Translation model is still loading. Wait until the status shows ready."
        if status["error"]:
            detail = f"Translation model failed to load: {status['error']}"
        raise HTTPException(status_code=503, detail=detail)

    try:
        result = translation_service.translate_text(source_text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive API boundary
        raise HTTPException(status_code=500, detail="Translation processing failed.") from exc

    return JSONResponse(
        {
            "text": result.text,
            "elapsedMs": result.elapsed_ms,
            "targetLabel": status["targetLabel"],
            "modelName": status["modelName"],
        }
    )
