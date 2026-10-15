"""Alertas por email antes de as garantias expirarem.

Corre uma vez por dia (por exemplo, com cron):

    python -m app.alerts

Para cada utilizador, junta num só email as compras cuja garantia acaba dentro de 60 ou
15 dias e que ainda não tiveram esse aviso. Os avisos enviados ficam registados em
`warranty_alerts`, por isso correr o comando mais de uma vez no mesmo dia não repete emails,
e um dia em que não corra é apanhado no dia seguinte.
"""

import logging
import sys
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.mailer import build_message, send_email
from app.models import Purchase, User, WarrantyAlert

logger = logging.getLogger(__name__)

# Avisos a enviar, em dias antes do fim da garantia (do mais cedo para o mais tarde).
ALERT_DAYS = (60, 15)


@dataclass
class DueAlert:
    purchase: Purchase
    days_left: int
    thresholds: list[int]  # avisos que este email cobre (ex.: [60, 15] se já faltam só 10 dias)


@dataclass
class AlertRunResult:
    emails_sent: int = 0
    purchases_alerted: int = 0
    failed_users: list[str] = field(default_factory=list)


def find_due_alerts(session: Session, today: date) -> dict[User, list[DueAlert]]:
    """Compras com algum aviso por enviar, agrupadas por utilizador."""
    horizon = today + timedelta(days=max(ALERT_DAYS))
    purchases = session.scalars(
        select(Purchase)
        .where(Purchase.warranty_end.between(today, horizon))
        .order_by(Purchase.user_id, Purchase.warranty_end, Purchase.id)
    ).all()
    if not purchases:
        return {}

    sent = defaultdict(set)
    for purchase_id, days_before in session.execute(
        select(WarrantyAlert.purchase_id, WarrantyAlert.days_before).where(
            WarrantyAlert.purchase_id.in_([p.id for p in purchases])
        )
    ):
        sent[purchase_id].add(days_before)

    due: dict[User, list[DueAlert]] = defaultdict(list)
    for purchase in purchases:
        days_left = (purchase.warranty_end - today).days
        pending = [t for t in ALERT_DAYS if days_left <= t and t not in sent[purchase.id]]
        if pending:
            user = session.get(User, purchase.user_id)
            due[user].append(DueAlert(purchase, days_left, pending))
    return dict(due)


def format_days_left(days_left: int) -> str:
    if days_left == 0:
        return "hoje"
    if days_left == 1:
        return "amanhã"
    return f"daqui a {days_left} dias"


def build_alert_email(user: User, alerts: list[DueAlert]) -> EmailMessage:
    if len(alerts) == 1:
        subject = f"A garantia de {alerts[0].purchase.product_name} está a acabar"
    else:
        subject = f"{len(alerts)} garantias estão a acabar"

    intro = "Esta garantia está" if len(alerts) == 1 else "Estas garantias estão"
    lines = ["Olá,", "", f"{intro} quase a acabar:", ""]
    for alert in alerts:
        p = alert.purchase
        lines.append(
            f"- {p.product_name} ({p.store}, comprado a {p.purchase_date:%d/%m/%Y}): "
            f"termina a {p.warranty_end:%d/%m/%Y}, {format_days_left(alert.days_left)}."
        )
    lines += [
        "",
        "Se algum destes produtos tiver um defeito, faz a reclamação à loja antes do fim do prazo.",
        "",
        "Warrantly",
    ]
    return build_message(user.email, subject, "\n".join(lines))


def send_due_alerts(
    session: Session,
    today: date | None = None,
    send: Callable[[EmailMessage], None] = send_email,
) -> AlertRunResult:
    """Envia os alertas devidos. Um email por utilizador; regista cada aviso só depois de enviar."""
    today = today or date.today()
    result = AlertRunResult()
    for user, alerts in find_due_alerts(session, today).items():
        try:
            send(build_alert_email(user, alerts))
            for alert in alerts:
                for days_before in alert.thresholds:
                    session.add(
                        WarrantyAlert(purchase_id=alert.purchase.id, days_before=days_before)
                    )
            session.commit()
        except Exception:
            session.rollback()
            logger.exception("Falhou o alerta para %s", user.email)
            result.failed_users.append(user.email)
            continue
        result.emails_sent += 1
        result.purchases_alerted += len(alerts)
    return result


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if not settings.smtp_host:
        logger.error("Falta definir SMTP_HOST no .env; nenhum alerta foi enviado")
        return 1
    with SessionLocal() as session:
        result = send_due_alerts(session)
    logger.info(
        "Alertas: %d email(s) enviados, %d compra(s), %d falha(s)",
        result.emails_sent,
        result.purchases_alerted,
        len(result.failed_users),
    )
    return 1 if result.failed_users else 0


if __name__ == "__main__":
    sys.exit(main())
