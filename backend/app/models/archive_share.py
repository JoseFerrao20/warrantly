from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ArchiveShare(Base):
    """Partilha do arquivo de garantias com outra pessoa (ver docs/adr/0007).

    O convite fica com o email (em minúsculas), exista ou não uma conta com ele: quem convida
    não fica a saber se a pessoa já usa o Warrantly. O convite é para a conta com esse email,
    que o aceita (`member_id` e `accepted_at`) ou recusa (a linha é apagada).
    """

    __tablename__ = "archive_shares"
    __table_args__ = (UniqueConstraint("owner_id", "email", name="uq_archive_shares_owner_email"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    member_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
