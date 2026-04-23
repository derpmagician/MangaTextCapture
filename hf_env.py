from __future__ import annotations

import os


def configure_hf_environment() -> None:
    if os.getenv("HF_TOKEN"):
        return

    try:
        from huggingface_hub import get_token
    except Exception:
        return

    token = get_token()
    if token:
        os.environ["HF_TOKEN"] = token