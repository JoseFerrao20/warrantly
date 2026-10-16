"""Armazenamento das faturas: em disco (desenvolvimento) ou no S3 (produção na AWS).

Cada ficheiro é guardado com um nome aleatório (a "key"), nunca com o nome enviado pelo
utilizador, para não haver colisões nem caminhos manipulados (`../`). O resto da app só usa
`save`, `load` e `delete`, e não sabe onde os ficheiros ficam (`STORAGE_BACKEND`).
"""

import os
import re
import secrets
from functools import cache
from io import BytesIO
from pathlib import Path
from typing import Protocol

import pillow_heif
from PIL import Image, ImageOps

from app.config import settings

pillow_heif.register_heif_opener()

# Tipos aceites, reconhecidos pelos primeiros bytes do ficheiro (não pelo Content-Type enviado).
INVOICE_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


# Fotografias HEIC/HEIF (iPhone): "ftyp" seguido de uma destas marcas. Não se guardam assim
# (a maioria dos browsers não as mostra): são convertidas para JPEG no upload.
HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}
HEIC = "image/heic"


def detect_content_type(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp" and data[8:12] in HEIF_BRANDS:
        return HEIC
    return None


def heic_to_jpeg(data: bytes) -> bytes:
    """Converte uma fotografia HEIC para JPEG, já rodada conforme a orientação da câmara."""
    with Image.open(BytesIO(data)) as image:
        rotated = ImageOps.exif_transpose(image).convert("RGB")
    buffer = BytesIO()
    rotated.save(buffer, format="JPEG", quality=85, optimize=True)
    return buffer.getvalue()


# Só keys geradas por `new_key` (hex + extensão conhecida): nada de caminhos.
KEY_PATTERN = re.compile(r"^[0-9a-f]{32}\.(pdf|jpg|png|webp)$")


def new_key(content_type: str) -> str:
    return secrets.token_hex(16) + INVOICE_TYPES[content_type]


def _check_key(key: str) -> str:
    if not KEY_PATTERN.match(key):
        raise ValueError(f"Key de fatura inválida: {key!r}")
    return key


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes | None: ...
    def remove(self, key: str) -> None: ...


class LocalStorage:
    """Ficheiros numa pasta (`UPLOAD_DIR`). Lê a pasta das definições a cada uso (testes)."""

    def _path(self, key: str) -> Path:
        return settings.upload_dir / _check_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        path = self._path(key)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)  # o ficheiro só aparece com o nome final quando está completo

    def get(self, key: str) -> bytes | None:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            return None

    def remove(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class S3Storage:
    """Objetos num bucket do S3 (`S3_BUCKET`), com o prefixo `faturas/`.

    As credenciais vêm do ambiente, como em qualquer cliente da AWS: na AWS, do papel (IAM
    role) do serviço; em desenvolvimento, de `AWS_PROFILE` ou das variáveis `AWS_*`.
    `S3_ENDPOINT_URL` permite usar um S3 compatível local (MinIO ou LocalStack).
    """

    PREFIX = "faturas/"

    def __init__(self, bucket: str, region: str | None, endpoint_url: str | None) -> None:
        import boto3  # só é preciso com o S3

        self.bucket = bucket
        self.client = boto3.client("s3", region_name=region, endpoint_url=endpoint_url)

    def _object(self, key: str) -> str:
        return self.PREFIX + _check_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket, Key=self._object(key), Body=data, ContentType=content_type
        )

    def get(self, key: str) -> bytes | None:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=self._object(key))
        except self.client.exceptions.NoSuchKey:
            return None
        return response["Body"].read()

    def remove(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._object(key))


@cache
def _s3(bucket: str, region: str | None, endpoint_url: str | None) -> S3Storage:
    return S3Storage(bucket, region, endpoint_url)


def backend() -> Storage:
    if settings.storage_backend == "s3":
        assert settings.s3_bucket  # garantido pela validação em config.py
        return _s3(settings.s3_bucket, settings.aws_region, settings.s3_endpoint_url)
    return LocalStorage()


def save(data: bytes, content_type: str) -> str:
    """Guarda o ficheiro e devolve a key com que ficou."""
    key = new_key(content_type)
    backend().put(key, data, content_type)
    return key


def load(key: str) -> bytes | None:
    """Conteúdo do ficheiro, ou None se já não existir."""
    return backend().get(key)


def delete(key: str | None) -> None:
    if key:
        backend().remove(key)


def extension(key: str) -> str:
    return Path(key).suffix
