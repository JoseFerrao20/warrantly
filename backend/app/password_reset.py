"""Recuperar a palavra-passe com um link enviado por email.

O link leva um token assinado (JWT, válido `RESET_TOKEN_MINUTES`) e não fica guardado em lado
nenhum. Para ser de uso único, o token leva uma "impressão digital" do hash da palavra-passe
atual: depois de a palavra-passe mudar, a impressão deixa de bater certo e o link deixa de
servir. Pela mesma razão, um link antigo deixa de servir se a pessoa mudar a palavra-passe
de outra forma.

O token vai no fragmento do URL (`#token=...`), que o browser não envia ao servidor: não
aparece nos logs do CloudFront nem no cabeçalho Referer.
"""

import hashlib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import jwt
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import settings
from app.mailer import build_message
from app.models import RefreshToken, User
from app.security import ALGORITHM, hash_password

RESET_TOKEN_MINUTES = 60
PURPOSE = "password-reset"


def _fingerprint(user: User) -> str:
    return hashlib.sha256(user.password_hash.encode()).hexdigest()[:16]


def create_reset_token(user: User, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "purpose": PURPOSE,
        "pwd": _fingerprint(user),
        "exp": now + timedelta(minutes=RESET_TOKEN_MINUTES),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def user_for_token(session: Session, token: str) -> User | None:
    """O utilizador do link, ou None se o link for inválido, já tiver expirado ou já usado."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub", "purpose", "pwd"]},
        )
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError):
        return None
    if payload["purpose"] != PURPOSE:
        return None
    user = session.get(User, user_id)
    if user is None or payload["pwd"] != _fingerprint(user):
        return None
    return user


def reset_link(token: str) -> str:
    return f"{settings.app_url.rstrip('/')}/repor-palavra-passe#token={token}"


def build_reset_email(user: User, token: str) -> EmailMessage:
    body = "\n".join(
        [
            "Olá,",
            "",
            "Pediste para repor a palavra-passe do Warrantly.",
            "Abre este link para escolher uma nova:",
            "",
            reset_link(token),
            "",
            f"O link serve uma só vez e durante {RESET_TOKEN_MINUTES} minutos.",
            "Se não foste tu, ignora este email: a tua palavra-passe não muda.",
            "",
            "Warrantly",
        ]
    )
    return build_message(user.email, "Repor a palavra-passe do Warrantly", body)


def reset_password(session: Session, user: User, password: str) -> None:
    """Muda a palavra-passe e termina todas as sessões (quem a roubou deixa de ter acesso)."""
    user.password_hash = hash_password(password)
    session.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
    session.commit()
