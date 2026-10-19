from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RefreshToken(Base):
    """Refresh token de uma sessão (ver app/sessions.py). Guarda-se só o hash do token.

    Cada uso troca o token por um novo da mesma `family` (a sessão de um aparelho). Um token
    já usado que volte a aparecer indica roubo, e a família inteira é revogada.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family: Mapped[str] = mapped_column(
        ForeignKey("user_sessions.family", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
