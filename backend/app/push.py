"""Notificações push para a app móvel, pelo serviço de push do Expo.

O Expo recebe as mensagens por HTTP e entrega-as pelo serviço de cada sistema (FCM no
Android, APNs no iOS), por isso o servidor não precisa das credenciais da Google nem da Apple.
Ver o ADR 0003.
"""

import json
import logging
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass, field

from app.config import settings

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
BATCH_SIZE = 100  # máximo de mensagens por pedido ao Expo
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


def _post(messages: list[dict]) -> list[dict]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if settings.expo_access_token:
        headers["Authorization"] = f"Bearer {settings.expo_access_token}"
    request = urllib.request.Request(
        EXPO_PUSH_URL, data=json.dumps(messages).encode(), headers=headers, method="POST"
    )
    # URL fixo (https, o serviço do Expo): o S310 avisa para URLs vindos de fora.
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return json.load(response)["data"]


def send_push(messages: Iterable[PushMessage]) -> set[str]:
    """Envia as mensagens e devolve os tokens que já não servem (app desinstalada).

    Um push que falha não estraga mais nada: fica registado no log e o alerta segue por email.
    """
    messages = list(messages)
    invalid: set[str] = set()
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
                continue
            error = (ticket.get("details") or {}).get("error")
            if error == "DeviceNotRegistered":
                invalid.add(message.token)
            else:
                logger.warning("Push recusado (%s): %s", error, ticket.get("message"))
    return invalid
