"""Armazenamento das faturas: em disco (desenvolvimento) ou no S3 (produção na AWS).

Cada ficheiro é guardado com um nome aleatório (a "key"), nunca com o nome enviado pelo
utilizador, para não haver colisões nem caminhos manipulados (`../`). O resto da app só usa
`save`, `load` e `delete`, e não sabe onde os ficheiros ficam (`STORAGE_BACKEND`).
"""

import os
import re
import secrets
from dataclasses import dataclass
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
# Uploads diretos (browser → S3): um token aleatório por ficheiro, guardado por utilizador.
UPLOAD_TOKEN_PATTERN = re.compile(r"^[0-9a-f]{32}$")
UPLOAD_EXPIRES_SECONDS = 300


class UploadTooLargeError(ValueError):
    pass


@dataclass
class UploadTicket:
    """O que o browser precisa para enviar o ficheiro diretamente para o S3 (POST pré-assinado)."""

    token: str
    url: str
    fields: dict[str, str]


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
    # Ficheiros enviados pelo browser e ainda não associados a uma compra. Uma regra do bucket
    # (Terraform) apaga-os ao fim de 1 dia, se nunca forem usados.
    UPLOADS_PREFIX = "uploads/"

    def __init__(self, bucket: str, region: str | None, endpoint_url: str | None) -> None:
        import boto3  # só é preciso com o S3
        from botocore.config import Config

        self.bucket = bucket
        if endpoint_url is None and region:
            # Endereço regional (https://<bucket>.s3.<região>.amazonaws.com): o global pode
            # redirecionar buckets novos, e o browser não segue redirecionamentos num POST com
            # CORS (upload direto). É também o endereço que a CSP do frontend autoriza.
            endpoint_url = f"https://s3.{region}.amazonaws.com"
        self.client = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=endpoint_url,
            config=Config(s3={"addressing_style": "virtual"}),
        )

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

    def _upload_object(self, user_id: int, token: str) -> str:
        if not UPLOAD_TOKEN_PATTERN.match(token):
            raise ValueError(f"Token de upload inválido: {token!r}")
        return f"{self.UPLOADS_PREFIX}{user_id}/{token}"

    def presign_upload(self, user_id: int, token: str, max_bytes: int) -> UploadTicket:
        # O tamanho máximo faz parte da assinatura: o S3 recusa ficheiros maiores.
        post = self.client.generate_presigned_post(
            Bucket=self.bucket,
            Key=self._upload_object(user_id, token),
            Conditions=[["content-length-range", 1, max_bytes]],
            ExpiresIn=UPLOAD_EXPIRES_SECONDS,
        )
        return UploadTicket(token=token, url=post["url"], fields=post["fields"])

    def get_upload(self, user_id: int, token: str, max_bytes: int) -> bytes | None:
        key = self._upload_object(user_id, token)
        try:
            head = self.client.head_object(Bucket=self.bucket, Key=key)
        except self.client.exceptions.ClientError:
            return None
        if head["ContentLength"] > max_bytes:  # não confiar só na condição da assinatura
            raise UploadTooLargeError(key)
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def remove_upload(self, user_id: int, token: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._upload_object(user_id, token))


@cache
def _s3(bucket: str, region: str | None, endpoint_url: str | None) -> S3Storage:
    return S3Storage(bucket, region, endpoint_url)


def backend() -> Storage:
    if settings.storage_backend == "s3":
        if not settings.s3_bucket:  # a validação em config.py já o impede
            raise RuntimeError("STORAGE_BACKEND=s3 sem S3_BUCKET")
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


def direct_uploads() -> S3Storage | None:
    """Com o S3, o browser envia as faturas diretamente para o bucket (sem passar pela API,
    que no Lambda só aceita pedidos até 6 MB). Com a pasta local, não há upload direto."""
    s3 = backend()
    return s3 if isinstance(s3, S3Storage) else None


def new_upload_token() -> str:
    return secrets.token_hex(16)


def extension(key: str) -> str:
    return Path(key).suffix
