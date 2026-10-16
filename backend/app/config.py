import os
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração lida das variáveis de ambiente (e do .env na raiz do repositório)."""

    # env_ignore_empty: "ALERTS_TOKEN=" (vazio, como no .env.example) conta como não definido.
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"), extra="ignore", env_ignore_empty=True
    )

    # "production" ativa as verificações de segurança abaixo.
    environment: str = "development"

    database_url: str = "postgresql+psycopg://warrantly:warrantly@localhost:5432/warrantly"
    # "queue": pool de ligações normal; "null": sem pool (Lambda + pooler do Neon).
    database_pool: Literal["queue", "null"] = "queue"

    # Chave para assinar os tokens (HS256 pede pelo menos 32 bytes). Em produção, gerar com:
    # python -c "import secrets; print(secrets.token_urlsafe(32))"
    secret_key: str = Field(
        default="dev-only-insecure-secret-key-change-me-in-production", min_length=32
    )
    access_token_expire_minutes: int = 60

    # Onde ficam as faturas: "local" (pasta UPLOAD_DIR) ou "s3" (bucket S3_BUCKET na AWS).
    storage_backend: Literal["local", "s3"] = "local"
    s3_bucket: str | None = None
    aws_region: str | None = None
    s3_endpoint_url: str | None = None  # só para um S3 local (MinIO ou LocalStack)

    # Pasta onde ficam as faturas (relativa à pasta onde a API arranca) e tamanho máximo.
    upload_dir: Path = Path("uploads")
    max_invoice_bytes: int = 10 * 1024 * 1024

    # Email (alertas de garantia): "smtp" (SMTP_*) ou "ses" (Amazon SES pela API, na AWS).
    # Com SMTP e sem SMTP_HOST, os alertas não são enviados.
    mail_backend: Literal["smtp", "ses"] = "smtp"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = True
    mail_from: str = "Warrantly <alertas@warrantly.local>"

    # Notificações push da app móvel (serviço do Expo). O token de acesso é opcional: com ele
    # ligado na conta do Expo, só este servidor consegue enviar para os tokens da app.
    push_enabled: bool = True
    expo_access_token: str | None = None

    # Token para correr os alertas por HTTP (POST /internal/alerts), usado pelo agendamento
    # diário no GitHub Actions. Sem token, a rota não existe.
    alerts_token: str | None = Field(default=None, min_length=32)

    # Limite de tentativas no login, no registo e ao apagar a conta (ver app/rate_limit.py).
    # Só se desliga nos testes E2E, que criam muitas contas seguidas a partir do mesmo IP.
    rate_limits: bool = True

    # Pasta com o build do frontend (frontend/dist). Em produção, a API serve-o na raiz.
    static_dir: Path | None = None

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, url: str) -> str:
        """Os alojamentos dão URLs "postgres://..."; o SQLAlchemy precisa do driver psycopg."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url.removeprefix(prefix)
        return url

    @model_validator(mode="after")
    def check_storage(self) -> "Settings":
        if self.storage_backend == "s3" and not self.s3_bucket:
            raise ValueError("Com STORAGE_BACKEND=s3, define S3_BUCKET")
        return self

    @model_validator(mode="after")
    def check_production(self) -> "Settings":
        if self.environment == "production" and self.secret_key.startswith("dev-only-"):
            raise ValueError(
                "Em produção, define SECRET_KEY com um valor gerado (não o de exemplo)"
            )
        return self


def load_ssm_parameters(path: str) -> None:
    """Segredos guardados no SSM Parameter Store (ex.: /warrantly/prod/SECRET_KEY).

    Cada parâmetro debaixo de `path` passa a variável de ambiente com o mesmo nome, se ainda
    não estiver definida. Assim os segredos não ficam nas variáveis do Lambda nem no estado do
    Terraform: só o papel IAM do Lambda os pode ler.
    """
    import boto3

    client = boto3.client("ssm", region_name=os.environ.get("AWS_REGION"))
    for page in client.get_paginator("get_parameters_by_path").paginate(
        Path=path, WithDecryption=True
    ):
        for parameter in page["Parameters"]:
            name = parameter["Name"].rsplit("/", 1)[-1]
            os.environ.setdefault(name, parameter["Value"])


if ssm_path := os.environ.get("SSM_PARAMETERS_PATH"):
    load_ssm_parameters(ssm_path)

settings = Settings()
