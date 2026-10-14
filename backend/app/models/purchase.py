from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Computed, Date, DateTime, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

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
        Computed("(purchase_date + make_interval(months => warranty_months))::date", persisted=True),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<Purchase id={self.id} product_name={self.product_name!r} warranty_end={self.warranty_end}>"
