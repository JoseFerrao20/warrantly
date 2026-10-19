from datetime import datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RateLimitEvent(Base):
    """Uma tentativa contada por um limite (ver app/rate_limit.py).

    Fica na base de dados, e não em memória, para o limite valer para todas as instâncias do
    Lambda. Não se guarda o email nem o IP: só um HMAC da chave, com a SECRET_KEY.
    """

    __tablename__ = "rate_limit_events"
    __table_args__ = (Index("ix_rate_limit_events_lookup", "bucket", "key_hash", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    bucket: Mapped[str] = mapped_column(String(40))  # o nome do limite (ex.: "login-ip")
    key_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
