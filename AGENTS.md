# Manga-OCR Agent Notes

Use this file for repo-specific guidance. For setup, usage, model layout, and environment variable details, read [README.md](README.md).

## Run Commands

- Install dependencies with `./.venv/Scripts/python.exe -m pip install -r requirements.txt`.
- Start the app with `./.venv/Scripts/python.exe -m uvicorn app:app --reload`.
- The app serves at `http://127.0.0.1:8000` by default.

## Architecture

- `app.py` is the FastAPI entrypoint. It mounts `static/`, renders `templates/index.html`, starts background model loading at startup, and exposes `/api/status`, `/api/ocr`, and `/api/translate`.
- `ocr_service.py` owns OCR model lifecycle and inference. It loads `kha-white/manga-ocr-base` in a background thread, serializes inference with a lock, and normalizes OCR output while preserving line breaks.
- `translation_service.py` owns translation model lifecycle and inference. It loads the Marian model in a background thread, batch-translates only non-empty lines, and preserves blank lines in the returned text.
- `hf_env.py` centralizes Hugging Face cache/model directory setup, local model checks, and the offline-after-download behavior.
- `templates/index.html`, `static/app.js`, and `static/app.css` form a vanilla JS single-page UI. `static/app.js` keeps most client state in a single `state` object and polls `/api/status` while models are loading.

## Project Conventions

- Keep backend changes thread-safe. Both OCR and translation services use background loading plus locks; keep that pattern unless the task explicitly changes concurrency.
- Prefer small changes in the owning layer: API work in `app.py`, model/runtime work in `ocr_service.py` or `translation_service.py`, Hugging Face/model path work in `hf_env.py`, and UI behavior in `static/app.js` plus `templates/index.html` and `static/app.css`.
- Preserve the Spanish UI copy unless the task explicitly asks to change language.
- Avoid editing or deleting files under `models/` unless the task is specifically about local model assets.
- When touching layout around the reader grid or canvas viewport, preserve the `min-width: 0` behavior on grid children. Removing it can reintroduce recursive canvas growth during zoom.

## Runtime Notes

- The project is designed to reuse locally downloaded models. Once required models exist under `models/` or `MANGA_MODELS_DIR`, startup may set `HF_HUB_OFFLINE=1` automatically.
- Useful environment variables are `MANGA_MODELS_DIR`, `MANGA_TRANSLATION_MODEL`, `MANGA_TRANSLATION_TARGET_LABEL`, `MANGA_OFFLINE_AFTER_DOWNLOAD`, and `HF_TOKEN`.
- First startup can take several minutes while models download and warm up.

## Validation

- There is no automated test suite in this repo today.
- After backend changes, run the dev server and verify `/api/status` first.
- After OCR or translation changes, manually verify the upload or paste flow, selection, OCR request, and translation request in the browser.
- After layout changes, manually verify zoom controls and canvas sizing on the main page.