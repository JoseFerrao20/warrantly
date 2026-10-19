from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.user import User

# Garantia legal de bens novos em Portugal: 3 anos (Decreto-Lei n.º 84/2021).
DEFAULT_WARRANTY_MONTHS = 36


class Purchase(Base):
    """Uma compra registada, com o prazo de garantia associado."""

    __tablename__ = "purchases"
    __table_args__ = (
        CheckConstraint("price >= 0", name="price_not_negative"),
        CheckConstraint("warranty_months > 0", name="warranty_months_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Cada compra pertence a um utilizador; apagar o utilizador apaga as compras dele.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    product_name: Mapped[str] = mapped_column(String(200))
    store: Mapped[str] = mapped_column(String(200))
    category: Mapped[str | None] = mapped_column(String(100))
    purchase_date: Mapped[date] = mapped_column(Date)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    warranty_months: Mapped[int] = mapped_column(
        Integer, default=DEFAULT_WARRANTY_MONTHS, server_default=str(DEFAULT_WARRANTY_MONTHS)
    )
    # Calculada pelo Postgres (data da compra + meses de garantia), indexada para o painel
    # ordenar pela garantia que expira primeiro.
    warranty_end: Mapped[date] = mapped_column(
        Date,
        Computed(
            "(purchase_date + make_interval(months => warranty_months))::date", persisted=True
        ),
        index=True,
    )
    # Email da loja para onde enviar reclamações (o utilizador envia-o do seu próprio email).
    store_email: Mapped[str | None] = mapped_column(String(320))
    # Número da fatura (ex.: "FT 2023/48213"), citado na reclamação.
    invoice_number: Mapped[str | None] = mapped_column(String(100))
    # Fatura (opcional): o ficheiro fica no disco com o nome `invoice_key`; guardamos também o nome
    # original, o tipo e o tamanho para a mostrar e devolver.
    invoice_key: Mapped[str | None] = mapped_column(String(64))
    invoice_filename: Mapped[str | None] = mapped_column(String(255))
    invoice_content_type: Mapped[str | None] = mapped_column(String(100))
    invoice_size: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # A dona da compra; com a partilha do arquivo (ADR 0007), quem vê a compra pode não ser ela.
    owner: Mapped["User"] = relationship(lazy="joined", innerjoin=True)

    @property
    def owner_name(self) -> str:
        return self.owner.full_name or self.owner.email

    def __repr__(self) -> str:
        return (
            f"<Purchase id={self.id} product_name={self.product_name!r} "
            f"warranty_end={self.warranty_end}>"
        )
