"""Limite de tentativas (login, registo, recuperação e confirmação da palavra-passe).

Cada tentativa contada é uma linha em `rate_limit_events`, no Postgres. Em memória não serviria
no Lambda: cada instância teria a sua contagem, e quem tentasse muitas vezes só tinha de cair
em instâncias diferentes.

- Janela deslizante: no máximo `limit` tentativas por chave nos últimos `window` segundos.
- Não se guarda o email nem o IP: só o HMAC-SHA256 da chave com a SECRET_KEY, por isso uma
  cópia da base de dados não diz quem tentou entrar.
- Cada tentativa registada apaga as linhas mais antigas do que a maior janela (1 hora): a
  tabela fica sempre pequena, sem tarefas de limpeza à parte.
- Dois pedidos ao mesmo tempo podem passar uma tentativa a mais (contar e registar não é
  atómico). Para um limite de tentativas chega; um bloqueio custaria mais do que evita.
"""

import hashlib
import hmac
import math
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import RateLimitEvent

MINUTE = 60


def _now() -> datetime:
    return datetime.now(UTC)


class RateLimiter:
    """No máximo `limit` tentativas por chave numa janela deslizante de `window` segundos."""

    def __init__(
        self, name: str, limit: int, window: int, clock: Callable[[], datetime] = _now
    ) -> None:
        self.name = name
        self.limit = limit
        self.window = timedelta(seconds=window)
        self._clock = clock

    def _key_hash(self, key: str) -> str:
        message = f"{self.name}:{key}".encode()
        return hmac.new(settings.secret_key.encode(), message, hashlib.sha256).hexdigest()

    def retry_after(self, session: Session, key: str) -> int | None:
        """Segundos até poder tentar outra vez, ou None se ainda não atingiu o limite."""
        now = self._clock()
        count, oldest = session.execute(
            select(func.count(), func.min(RateLimitEvent.created_at)).where(
                RateLimitEvent.bucket == self.name,
                RateLimitEvent.key_hash == self._key_hash(key),
                RateLimitEvent.created_at > now - self.window,
            )
        ).one()
        if count < self.limit:
            return None
        return max(1, math.ceil((oldest + self.window - now).total_seconds()))

    def hit(self, session: Session, key: str) -> None:
        now = self._clock()
        session.execute(delete(RateLimitEvent).where(RateLimitEvent.created_at < now - MAX_WINDOW))
        session.add(RateLimitEvent(bucket=self.name, key_hash=self._key_hash(key), created_at=now))
        session.commit()  # fica registada mesmo que o pedido acabe num erro a seguir

    def reset(self, session: Session, key: str) -> None:
        session.execute(
            delete(RateLimitEvent).where(
                RateLimitEvent.bucket == self.name, RateLimitEvent.key_hash == self._key_hash(key)
            )
        )
        session.commit()


# Login: falhas por IP e email (o caso normal), por IP (vários emails) e por email
# (de vários IPs: o IP pode ser falsificado com X-Forwarded-For).
login_failures_ip_email = RateLimiter("login-ip-email", limit=5, window=15 * MINUTE)
login_failures_ip = RateLimiter("login-ip", limit=30, window=15 * MINUTE)
login_failures_email = RateLimiter("login-email", limit=20, window=15 * MINUTE)
# Registo: contas novas por IP.
registrations_ip = RateLimiter("register-ip", limit=10, window=60 * MINUTE)
# Palavra-passe errada ao apagar a conta, por utilizador.
password_checks_user = RateLimiter("password-check-user", limit=5, window=15 * MINUTE)
# Pedidos de recuperação da palavra-passe: emails enviados por IP e por endereço.
password_resets_ip = RateLimiter("reset-ip", limit=10, window=60 * MINUTE)
password_resets_email = RateLimiter("reset-email", limit=3, window=60 * MINUTE)
# Convites para partilhar o arquivo (cada um envia um email), por utilizador.
share_invites_user = RateLimiter("share-invite-user", limit=20, window=60 * MINUTE)
# Emails de confirmação pedidos outra vez, por utilizador.
verification_emails_user = RateLimiter("verify-email-user", limit=5, window=60 * MINUTE)

ALL = [
    login_failures_ip_email,
    login_failures_ip,
    login_failures_email,
    registrations_ip,
    password_checks_user,
    password_resets_ip,
    password_resets_email,
    share_invites_user,
    verification_emails_user,
]
# As linhas mais antigas do que a maior janela já não contam para nenhum limite.
MAX_WINDOW = max(limiter.window for limiter in ALL)
