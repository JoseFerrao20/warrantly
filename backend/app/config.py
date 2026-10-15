from pathlib import Path

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

    # Chave para assinar os tokens (HS256 pede pelo menos 32 bytes). Em produção, gerar com:
    # python -c "import secrets; print(secrets.token_urlsafe(32))"
    secret_key: str = Field(
        default="dev-only-insecure-secret-key-change-me-in-production", min_length=32
    )
    access_token_expire_minutes: int = 60

    # Pasta onde ficam as faturas (relativa à pasta onde a API arranca) e tamanho máximo.
    upload_dir: Path = Path("uploads")
    max_invoice_bytes: int = 10 * 1024 * 1024

    # Email (alertas de garantia). Sem SMTP_HOST, os alertas não são enviados.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = True
    mail_from: str = "Warrantly <alertas@warrantly.local>"

    # Token para correr os alertas por HTTP (POST /internal/alerts), usado pelo agendamento
    # diário no GitHub Actions. Sem token, a rota não existe.
    alerts_token: str | None = Field(default=None, min_length=32)

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
    def check_production(self) -> "Settings":
        if self.environment == "production" and self.secret_key.startswith("dev-only-"):
            raise ValueError(
                "Em produção, define SECRET_KEY com um valor gerado (não o de exemplo)"
            )
        return self


settings = Settings()
