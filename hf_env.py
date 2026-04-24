from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODELS_DIR = BASE_DIR / "models"
HF_CACHE_DIRNAME = ".hf-cache"
DEFAULT_REQUIRED_MODELS: tuple[tuple[str, str], ...] = (
    ("kha-white/manga-ocr-base", "ocr"),
    ("Helsinki-NLP/opus-mt-ja-es", "translation"),
)


def configure_hf_environment() -> Path:
    models_dir = Path(os.getenv("MANGA_MODELS_DIR", str(DEFAULT_MODELS_DIR))).resolve()
    hf_home = models_dir / HF_CACHE_DIRNAME
    hub_cache = hf_home / "hub"
    transformers_cache = hf_home / "transformers"

    models_dir.mkdir(parents=True, exist_ok=True)
    hf_home.mkdir(parents=True, exist_ok=True)
    hub_cache.mkdir(parents=True, exist_ok=True)
    transformers_cache.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("HF_HOME", str(hf_home))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(hub_cache))
    os.environ.setdefault("TRANSFORMERS_CACHE", str(transformers_cache))

    if os.getenv("HF_TOKEN"):
        return models_dir

    try:
        from huggingface_hub import get_token
    except Exception:
        return models_dir

    token = get_token()
    if token:
        os.environ["HF_TOKEN"] = token

    return models_dir


def configure_runtime_model_access(
    required_models: tuple[tuple[str, str], ...] = DEFAULT_REQUIRED_MODELS,
) -> Path:
    models_dir = configure_hf_environment()

    if not _offline_after_download_enabled():
        os.environ.pop("HF_HUB_OFFLINE", None)
        return models_dir

    models_available = all(
        _is_complete_model_dir(models_dir / category / Path(repo_id))
        for repo_id, category in required_models
    )

    if models_available:
        os.environ["HF_HUB_OFFLINE"] = "1"
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)

    return models_dir


def ensure_local_model(repo_id: str, category: str) -> Path:
    from huggingface_hub import snapshot_download

    models_dir = configure_hf_environment()
    model_dir = models_dir / category / Path(repo_id)

    if _is_complete_model_dir(model_dir):
        return model_dir

    model_dir.mkdir(parents=True, exist_ok=True)

    snapshot_kwargs: dict[str, str] = {
        "repo_id": repo_id,
        "local_dir": str(model_dir),
    }
    hf_token = os.getenv("HF_TOKEN")
    if hf_token:
        snapshot_kwargs["token"] = hf_token

    snapshot_download(**snapshot_kwargs)
    return model_dir


def _is_complete_model_dir(model_dir: Path) -> bool:
    if not model_dir.is_dir():
        return False

    has_config = any((model_dir / file_name).exists() for file_name in (
        "config.json",
        "preprocessor_config.json",
        "processor_config.json",
    ))
    has_tokenizer = any((model_dir / file_name).exists() for file_name in (
        "tokenizer.json",
        "tokenizer_config.json",
        "source.spm",
        "vocab.json",
        "vocab.txt",
    ))
    has_weights = any(any(model_dir.glob(pattern)) for pattern in (
        "*.safetensors",
        "*.bin",
        "*.index.json",
    ))
    return has_config and has_tokenizer and has_weights


def _offline_after_download_enabled() -> bool:
    return os.getenv("MANGA_OFFLINE_AFTER_DOWNLOAD", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }