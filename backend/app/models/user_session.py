from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class UserSession(Base):
    """Uma sessão: um login num aparelho, que dura enquanto os refresh tokens forem renovados.

    `family` é o identificador da sessão: os refresh tokens dela (`RefreshToken.family`) e o
    `sid` dos tokens de acesso. Apagar a sessão apaga os refresh tokens (cascade) e recusa os
    tokens de acesso que ainda não expiraram (ver `dependencies.get_current_user`).
    """

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family: Mapped[str] = mapped_column(String(32), unique=True)
    # Descrição curta do aparelho ("Chrome no Windows", "Pixel 8 (Android)"); sem o IP.
    device: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
