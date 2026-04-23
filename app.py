from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from ocr_service import ocr_service


BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Manga OCR Reader")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@app.on_event("startup")
async def startup_event() -> None:
    ocr_service.start_loading()


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"title": "Manga OCR Reader"},
    )


@app.get("/api/status")
async def get_status() -> JSONResponse:
    return JSONResponse(ocr_service.status())


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
