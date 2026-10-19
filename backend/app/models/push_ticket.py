from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PushTicket(Base):
    """Um push aceite pelo Expo, à espera do recibo de entrega (ver `app.push.check_receipts`).

    O Expo responde ao envio com um "ticket" (aceitei a mensagem) e só uns minutos depois tem
    o recibo (o FCM ou o APNs entregou, ou não). Guarda-se o id do ticket com o token, para
    apagar o token se o recibo disser que a app já não está instalada.
    """

    __tablename__ = "push_tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(64), unique=True)
    # Se o token for apagado (a pessoa saiu da app ou apagou a conta), o ticket vai com ele.
    token: Mapped[str] = mapped_column(
        ForeignKey("push_tokens.token", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
