"""Notificações push para a app móvel, pelo serviço de push do Expo.

O Expo recebe as mensagens por HTTP e entrega-as pelo serviço de cada sistema (FCM no
Android, APNs no iOS), por isso o servidor não precisa das credenciais da Google nem da Apple.
Ver o ADR 0003.

Cada envio tem duas respostas:
- o **ticket**, logo na resposta ao envio: o Expo aceitou (ou recusou) a mensagem;
- o **recibo**, uns minutos depois, com o id do ticket: o FCM ou o APNs entregou, ou não.
  Uma app desinstalada às vezes só aparece no recibo (`DeviceNotRegistered`). Os ids dos
  tickets ficam em `push_tickets`, e `check_receipts` vai buscar os recibos (agendado 30
  minutos depois dos alertas, em `infra/app/scheduler.tf`).
"""

import json
import logging
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import PushTicket, PushToken

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
BATCH_SIZE = 100  # máximo de mensagens por pedido ao Expo
RECEIPTS_BATCH_SIZE = 1000  # máximo de ids por pedido de recibos
# O Expo recomenda esperar 15 minutos pelos recibos, e guarda-os pelo menos 24 horas.
RECEIPT_DELAY = timedelta(minutes=15)
RECEIPT_MAX_AGE = timedelta(hours=24)
TIMEOUT_SECONDS = 10
ANDROID_CHANNEL = "alertas"  # o mesmo canal que a app cria (src/lib/push.ts)


@dataclass
class PushMessage:
    token: str
    title: str
    body: str
    data: dict[str, str] = field(default_factory=dict)

    def payload(self) -> dict:
        return {
            "to": self.token,
            "title": self.title,
            "body": self.body,
            "data": self.data,
            "sound": "default",
            "channelId": ANDROID_CHANNEL,
        }


@dataclass
class PushOutcome:
    """O que o Expo respondeu a um envio."""

    invalid: set[str] = field(default_factory=set)  # tokens que já não servem
    tickets: dict[str, str] = field(default_factory=dict)  # id do ticket -> token


def _request(url: str, body: object) -> Any:
    """POST ao Expo; `url` é sempre um dos dois URLs fixos acima."""
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if settings.expo_access_token:
        headers["Authorization"] = f"Bearer {settings.expo_access_token}"
    # URLs fixos (https, o serviço do Expo): o S310 avisa para URLs vindos de fora.
    request = urllib.request.Request(  # noqa: S310 (URLs fixos do Expo)
        url, data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return json.load(response)["data"]


def _post(messages: list[dict]) -> list[dict]:
    return _request(EXPO_PUSH_URL, messages)


def _get_receipts(ticket_ids: list[str]) -> dict[str, dict]:
    return _request(EXPO_RECEIPTS_URL, {"ids": ticket_ids})


def send_push(messages: Iterable[PushMessage]) -> PushOutcome:
    """Envia as mensagens; devolve os tokens que já não servem e os tickets aceites.

    Um push que falha não estraga mais nada: fica registado no log e o alerta segue por email.
    """
    messages = list(messages)
    outcome = PushOutcome()
    for start in range(0, len(messages), BATCH_SIZE):
        batch = messages[start : start + BATCH_SIZE]
        try:
            tickets = _post([m.payload() for m in batch])
        except Exception:
            logger.exception("Falhou o envio de %d notificação(ões) push", len(batch))
            continue
        # O Expo responde com um "ticket" por mensagem, pela mesma ordem.
        for message, ticket in zip(batch, tickets, strict=False):
            if ticket.get("status") == "ok":
                if ticket.get("id"):
                    outcome.tickets[ticket["id"]] = message.token
                continue
            error = (ticket.get("details") or {}).get("error")
            if error == "DeviceNotRegistered":
                outcome.invalid.add(message.token)
            else:
                logger.warning("Push recusado (%s): %s", error, ticket.get("message"))
    return outcome


def save_tickets(session: Session, tickets: dict[str, str]) -> None:
    """Guarda os tickets aceites, para ir buscar os recibos mais tarde."""
    session.add_all(PushTicket(ticket_id=ticket, token=token) for ticket, token in tickets.items())
    session.commit()


@dataclass
class ReceiptsResult:
    checked: int = 0  # recibos recebidos
    delivered: int = 0
    tokens_removed: int = 0  # apps desinstaladas
    errors: int = 0  # outros erros (ficam no log)
    pending: int = 0  # tickets ainda sem recibo, para a próxima vez


def check_receipts(session: Session, now: datetime | None = None) -> ReceiptsResult:
    """Vai buscar os recibos dos pushes enviados há mais de 15 minutos.

    - `DeviceNotRegistered`: a app foi desinstalada; o token é apagado.
    - Outros erros (`MessageTooBig`, `MessageRateExceeded`, `InvalidCredentials`...): ficam no
      log, porque querem dizer que há algo a corrigir do nosso lado.
    - Sem recibo: tenta-se outra vez na próxima corrida, até o ticket ter 24 horas.
    """
    now = now or datetime.now(UTC)
    result = ReceiptsResult()
    # Os demasiado antigos já não têm recibo no Expo.
    session.execute(delete(PushTicket).where(PushTicket.created_at < now - RECEIPT_MAX_AGE))
    tickets = session.scalars(
        select(PushTicket).where(PushTicket.created_at <= now - RECEIPT_DELAY)
    ).all()
    uninstalled: set[str] = set()
    done: list[int] = []
    for start in range(0, len(tickets), RECEIPTS_BATCH_SIZE):
        batch = tickets[start : start + RECEIPTS_BATCH_SIZE]
        try:
            receipts = _get_receipts([t.ticket_id for t in batch])
        except Exception:
            logger.exception("Falhou o pedido de %d recibo(s) de push", len(batch))
            result.pending += len(batch)
            continue
        for ticket in batch:
            receipt = receipts.get(ticket.ticket_id)
            if receipt is None:
                result.pending += 1
                continue
            result.checked += 1
            done.append(ticket.id)
            if receipt.get("status") == "ok":
                result.delivered += 1
                continue
            error = (receipt.get("details") or {}).get("error")
            if error == "DeviceNotRegistered":
                uninstalled.add(ticket.token)
            else:
                result.errors += 1
                logger.error("Push não entregue (%s): %s", error, receipt.get("message"))
    if done:
        session.execute(delete(PushTicket).where(PushTicket.id.in_(done)))
    if uninstalled:
        # Os tickets destes tokens vão com eles (ON DELETE CASCADE).
        session.execute(delete(PushToken).where(PushToken.token.in_(uninstalled)))
        result.tokens_removed = len(uninstalled)
    session.commit()
    logger.info(
        "Recibos de push: %d entregue(s), %d app(s) desinstalada(s), %d erro(s), %d pendente(s)",
        result.delivered,
        result.tokens_removed,
        result.errors,
        result.pending,
    )
    return result
