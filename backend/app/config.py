from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração lida das variáveis de ambiente (e do .env na raiz do repositório)."""

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "postgresql+psycopg://warrantly:warrantly@localhost:5432/warrantly"

    # Chave para assinar os tokens (HS256 pede pelo menos 32 bytes). Em produção, gerar com:
    # python -c "import secrets; print(secrets.token_urlsafe(32))"
    secret_key: str = Field(
        default="dev-only-insecure-secret-key-change-me-in-production", min_length=32
    )
    access_token_expire_minutes: int = 60


settings = Settings()
