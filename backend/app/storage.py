"""Armazenamento das faturas em disco.

Cada ficheiro é guardado com um nome aleatório (a "key"), nunca com o nome enviado pelo
utilizador, para não haver colisões nem caminhos manipulados (`../`).
"""

import os
import secrets
from pathlib import Path

from app.config import settings

# Tipos aceites, reconhecidos pelos primeiros bytes do ficheiro (não pelo Content-Type enviado).
INVOICE_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def detect_content_type(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _path(key: str) -> Path:
    return settings.upload_dir / key


def save(data: bytes, content_type: str) -> str:
    """Guarda o ficheiro e devolve a key com que ficou."""
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(16) + INVOICE_TYPES[content_type]
    tmp = _path(key + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, _path(key))  # o ficheiro só aparece com o nome final quando está completo
    return key


def path_for(key: str) -> Path:
    return _path(key)


def delete(key: str | None) -> None:
    if key:
        _path(key).unlink(missing_ok=True)
