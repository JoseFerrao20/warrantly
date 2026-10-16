"""Sessões longas com refresh tokens.

- O token de acesso (JWT) dura pouco (`ACCESS_TOKEN_EXPIRE_MINUTES`, 15 min). Não fica na base
  de dados, por isso não se pode revogar; dura pouco por isso mesmo.
- O refresh token é um valor aleatório que dura `REFRESH_TOKEN_EXPIRE_DAYS` (30 dias) desde o
  último uso. Na base de dados fica só o hash (SHA-256): uma cópia da base de dados não dá
  acesso a nenhuma sessão.
- **Rotação:** cada `POST /auth/refresh` gasta o refresh token e devolve um novo, da mesma
  família. Se um token já gasto voltar a aparecer, alguém o copiou: a família inteira é
  revogada e a pessoa tem de entrar outra vez nesse aparelho.
- Dois pedidos quase ao mesmo tempo com o mesmo token (dois separadores do browser, por
  exemplo) não são roubo: durante `REUSE_GRACE` segundos, um token gasto ainda dá um novo.
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import RefreshToken
from app.security import create_access_token

REUSE_GRACE = timedelta(seconds=30)


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int  # segundos de vida do token de acesso


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def _issue(session: Session, user_id: int, family: str) -> TokenPair:
    refresh_token = secrets.token_urlsafe(32)
    session.add(
        RefreshToken(
            user_id=user_id,
            family=family,
            token_hash=_hash(refresh_token),
            expires_at=_now() + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    session.commit()
    return TokenPair(
        access_token=create_access_token(user_id),
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


def start_session(session: Session, user_id: int) -> TokenPair:
    """Depois do login: uma família nova (um aparelho)."""
    return _issue(session, user_id, secrets.token_hex(16))


def refresh_session(session: Session, refresh_token: str) -> TokenPair | None:
    """Troca o refresh token por um par novo, ou None se não servir (a pessoa volta a entrar)."""
    stored = session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == _hash(refresh_token))
    )
    now = _now()
    if stored is None or stored.expires_at <= now:
        return None
    if stored.used_at is not None and now - stored.used_at > REUSE_GRACE:
        revoke_family(session, stored.family)  # token gasto outra vez: provavelmente roubado
        return None
    if stored.used_at is None:
        stored.used_at = now
    # Os tokens gastos há mais tempo do que a margem já não servem para nada.
    session.execute(
        delete(RefreshToken).where(
            RefreshToken.family == stored.family, RefreshToken.used_at < now - REUSE_GRACE
        )
    )
    return _issue(session, stored.user_id, stored.family)


def revoke_family(session: Session, family: str) -> None:
    session.execute(delete(RefreshToken).where(RefreshToken.family == family))
    session.commit()


def end_session(session: Session, refresh_token: str) -> None:
    """Sair: revoga a sessão deste aparelho (os outros aparelhos continuam com sessão)."""
    stored = session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == _hash(refresh_token))
    )
    if stored is not None:
        revoke_family(session, stored.family)
