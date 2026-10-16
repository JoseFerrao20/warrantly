"""Limite de tentativas em memória (login, registo, confirmação da palavra-passe).

Chega para uma só instância da API (como no Fly, com uma máquina). Com várias instâncias,
cada uma conta à parte, e o limite passaria para um sítio partilhado (Redis ou Postgres).
"""

import math
import threading
import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    """No máximo `limit` eventos por chave numa janela deslizante de `window` segundos."""

    def __init__(
        self, limit: int, window: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.limit = limit
        self.window = window
        self._clock = clock
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()  # as rotas síncronas correm em várias threads

    def _prune(self, key: str, now: float) -> deque[float] | None:
        events = self._events.get(key)
        if events is None:
            return None
        while events and events[0] <= now - self.window:
            events.popleft()
        if not events:
            del self._events[key]
            return None
        return events

    def retry_after(self, key: str) -> int | None:
        """Segundos até poder tentar outra vez, ou None se ainda não atingiu o limite."""
        with self._lock:
            now = self._clock()
            events = self._prune(key, now)
            if events is None or len(events) < self.limit:
                return None
            return max(1, math.ceil(events[0] + self.window - now))

    def hit(self, key: str) -> None:
        with self._lock:
            now = self._clock()
            self._prune(key, now)
            self._events.setdefault(key, deque()).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._events.clear()


MINUTE = 60

# Login: falhas por IP e email (o caso normal), por IP (vários emails) e por email
# (de vários IPs: o IP pode ser falsificado com X-Forwarded-For).
login_failures_ip_email = RateLimiter(limit=5, window=15 * MINUTE)
login_failures_ip = RateLimiter(limit=30, window=15 * MINUTE)
login_failures_email = RateLimiter(limit=20, window=15 * MINUTE)
# Registo: contas novas por IP.
registrations_ip = RateLimiter(limit=10, window=60 * MINUTE)
# Palavra-passe errada ao apagar a conta, por utilizador.
password_checks_user = RateLimiter(limit=5, window=15 * MINUTE)
# Pedidos de recuperação da palavra-passe: emails enviados por IP e por endereço.
password_resets_ip = RateLimiter(limit=10, window=60 * MINUTE)
password_resets_email = RateLimiter(limit=3, window=60 * MINUTE)

ALL = [
    login_failures_ip_email,
    login_failures_ip,
    login_failures_email,
    registrations_ip,
    password_checks_user,
    password_resets_ip,
    password_resets_email,
]


def reset_all() -> None:
    for limiter in ALL:
        limiter.clear()
