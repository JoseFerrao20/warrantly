from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class WarrantyAlert(Base):
    """Registo de um alerta já enviado, para não repetir o mesmo aviso (ex.: o dos 60 dias)."""

    __tablename__ = "warranty_alerts"
    __table_args__ = (UniqueConstraint("purchase_id", "days_before"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_id: Mapped[int] = mapped_column(ForeignKey("purchases.id", ondelete="CASCADE"))
    days_before: Mapped[int] = mapped_column(Integer)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
