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
- Cada família é uma sessão (`UserSession`): o aparelho, quando começou e a última renovação.
  A página da conta lista-as e deixa terminar as dos outros aparelhos. O token de acesso leva
  o id da sessão (`sid`), e uma sessão terminada recusa-o logo (`dependencies`).
"""

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import RefreshToken, UserSession
from app.observability import metric
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
    """Um refresh token novo da sessão `family` (que já tem de existir)."""
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
        access_token=create_access_token(user_id, family),
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
    )


def start_session(session: Session, user_id: int, device: str) -> TokenPair:
    """Depois do login: uma sessão nova (um aparelho)."""
    family = secrets.token_hex(16)
    session.add(UserSession(user_id=user_id, family=family, device=device[:100]))
    session.flush()  # a sessão tem de existir antes do refresh token (chave estrangeira)
    return _issue(session, user_id, family)


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
        metric("RefreshTokenReuse")
        return None
    if stored.used_at is None:
        stored.used_at = now
    session.execute(
        update(UserSession).where(UserSession.family == stored.family).values(last_used_at=now)
    )
    # Os tokens gastos há mais tempo do que a margem já não servem para nada.
    session.execute(
        delete(RefreshToken).where(
            RefreshToken.family == stored.family, RefreshToken.used_at < now - REUSE_GRACE
        )
    )
    return _issue(session, stored.user_id, stored.family)


def revoke_family(session: Session, family: str) -> None:
    # Os refresh tokens da sessão vão com ela (ON DELETE CASCADE).
    session.execute(delete(UserSession).where(UserSession.family == family))
    session.commit()


def end_session(session: Session, refresh_token: str) -> None:
    """Sair: revoga a sessão deste aparelho (os outros aparelhos continuam com sessão)."""
    stored = session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == _hash(refresh_token))
    )
    if stored is not None:
        revoke_family(session, stored.family)


def _expired_before(now: datetime) -> datetime:
    """Uma sessão sem renovações desde esta data já expirou (os refresh tokens duram N dias)."""
    return now - timedelta(days=settings.refresh_token_expire_days)


def list_sessions(session: Session, user_id: int) -> list[UserSession]:
    """As sessões ativas, da mais recente para a mais antiga. Apaga as que já expiraram."""
    now = _now()
    session.execute(
        delete(UserSession).where(
            UserSession.user_id == user_id, UserSession.last_used_at <= _expired_before(now)
        )
    )
    session.commit()
    query = (
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.last_used_at.desc(), UserSession.id.desc())
    )
    return list(session.scalars(query))


def end_user_session(session: Session, user_id: int, session_id: int) -> bool:
    """Termina uma sessão da pessoa (noutro aparelho). False se não existir ou for de outra."""
    result = session.execute(
        delete(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id)
    )
    session.commit()
    return result.rowcount > 0


def end_other_sessions(session: Session, user_id: int, keep_family: str | None) -> int:
    """Termina todas as sessões da pessoa menos a deste aparelho. Devolve quantas terminou."""
    query = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_family is not None:
        query = query.where(UserSession.family != keep_family)
    result = session.execute(query)
    session.commit()
    return result.rowcount


# --- Descrição do aparelho -------------------------------------------------------------------

# Por ordem: o Edge e o Opera também dizem "Chrome", e o Chrome também diz "Safari".
_BROWSERS = [
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Firefox/", "Firefox"),
    ("FxiOS/", "Firefox"),
    ("CriOS/", "Chrome"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
]
_SYSTEMS = [
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("CrOS", "ChromeOS"),
    ("Linux", "Linux"),
]
_UNSAFE = re.compile(r"[^\w .,()+\-/]", re.UNICODE)


def describe_device(user_agent: str | None, device_name: str | None = None) -> str:
    """Uma descrição curta do aparelho, para a lista de sessões ("Firefox no Windows").

    A app móvel manda o nome do telemóvel em `X-Device-Name` ("Pixel 8 (Android)"); no browser,
    usa-se o User-Agent. Só serve para a pessoa reconhecer o aparelho: não é uma prova de nada.
    """
    if device_name:
        name = " ".join(_UNSAFE.sub("", device_name).split())[:80]
        if name:
            return f"App Warrantly: {name}"
    agent = user_agent or ""
    browser = next((label for marker, label in _BROWSERS if marker in agent), None)
    system = next((label for marker, label in _SYSTEMS if marker in agent), None)
    if browser and system:
        return f"{browser} no {system}"
    return browser or system or "Aparelho desconhecido"
