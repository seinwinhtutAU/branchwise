"""Meaning vectors for knowledge search, from Cloudflare Workers AI (`@cf/baai/bge-m3`).

Two sentences that mean the same thing get vectors that point the same way, whatever words or
language they use — which is what keyword search cannot do. The service has a free daily
allowance and the account is the one R2 already uses.

Everything here is optional by design: with no token, or when Cloudflare is unreachable,
`embed_texts` returns None and the caller falls back to keyword search. Nothing in the assistant
may fail because of this module.
"""

import logging
import math
from array import array

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 16
TIMEOUT_SECONDS = 20.0


def _post(url: str, headers: dict, payload: dict, timeout: float) -> httpx.Response:
    """The one network call (a seam for tests)."""
    return httpx.post(url, headers=headers, json=payload, timeout=timeout)


def embedding_model(settings=None) -> str:
    return (settings or get_settings()).embedding_model


def embeddings_enabled(settings=None) -> bool:
    settings = settings or get_settings()
    return bool(
        settings.cloudflare_ai_api_token
        and (settings.cloudflare_account_id or settings.r2_account_id)
    )


def normalise(vector: list[float]) -> list[float]:
    length = math.sqrt(sum(x * x for x in vector))
    return [x / length for x in vector] if length else vector


def pack(vector: list[float]) -> bytes:
    return array("f", vector).tobytes()


def unpack(data: bytes) -> list[float]:
    values = array("f")
    values.frombytes(data)
    return list(values)


def cosine(a: list[float], b: list[float]) -> float:
    """Dot product — the vectors are stored unit length, so this is the cosine."""
    if len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


def embed_texts(texts: list[str], settings=None) -> list[list[float]] | None:
    """One unit-length vector per text, or None if the service is off or fails (all or nothing,
    so the caller never stores half a set)."""
    settings = settings or get_settings()
    if not texts:
        return []
    if not embeddings_enabled(settings):
        return None
    account = settings.cloudflare_account_id or settings.r2_account_id
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{settings.embedding_model}"
    )
    headers = {"Authorization": f"Bearer {settings.cloudflare_ai_api_token}"}
    vectors: list[list[float]] = []
    try:
        for start in range(0, len(texts), BATCH_SIZE):
            batch = texts[start : start + BATCH_SIZE]
            response = _post(url, headers, {"text": batch}, TIMEOUT_SECONDS)
            if response.status_code != 200:
                logger.warning("Embedding request failed with HTTP %s", response.status_code)
                return None
            data = response.json().get("result", {}).get("data")
            if not isinstance(data, list) or len(data) != len(batch):
                logger.warning("Embedding response had an unexpected shape")
                return None
            vectors.extend(normalise([float(x) for x in vector]) for vector in data)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        # The message can name the URL (with the account id) but never carries the token.
        logger.warning("Embedding request failed: %s", type(exc).__name__)
        return None
    return vectors
