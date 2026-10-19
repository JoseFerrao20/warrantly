from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    """Utilizador da app. O email é guardado sempre em minúsculas."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # Nome usado para assinar as reclamações (opcional).
    full_name: Mapped[str | None] = mapped_column(String(200))
    # Quando a pessoa abriu o link de confirmação enviado no registo (ver ADR 0008). Sem ele,
    # não partilha o arquivo nem vê os convites feitos para este email.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r}>"
