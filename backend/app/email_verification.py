"""Confirmar o email da conta com um link enviado no registo (ADR 0008).

Como na recuperação da palavra-passe, o link leva um token assinado (JWT) que não fica guardado
em lado nenhum, e vai no fragmento do URL (`#token=...`), que o browser não envia ao servidor.
O token leva o email: se a conta um dia mudar de email, os links antigos deixam de servir.
Confirmar duas vezes não faz mal, por isso o link não precisa de ser de uso único.
"""

from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.mailer import build_message
from app.models import User
from app.security import ALGORITHM

VERIFY_TOKEN_DAYS = 7
PURPOSE = "verify-email"


def create_verification_token(user: User, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "purpose": PURPOSE,
        "email": user.email,
        "exp": now + timedelta(days=VERIFY_TOKEN_DAYS),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def user_for_token(session: Session, token: str) -> User | None:
    """O utilizador do link, ou None se o link for inválido ou já tiver expirado."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub", "purpose", "email"]},
        )
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError):
        return None
    if payload["purpose"] != PURPOSE:
        return None
    user = session.get(User, user_id)
    if user is None or payload["email"] != user.email:
        return None
    return user


def mark_verified(session: Session, user: User) -> None:
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)
        session.commit()


def verification_link(token: str) -> str:
    return f"{settings.app_url.rstrip('/')}/confirmar-email#token={token}"


def build_verification_email(user: User, token: str) -> EmailMessage:
    body = "\n".join(
        [
            "Olá,",
            "",
            "Criaste uma conta no Warrantly com este email. Abre este link para o confirmar:",
            "",
            verification_link(token),
            "",
            f"O link serve durante {VERIFY_TOKEN_DAYS} dias. Depois de confirmares o email,",
            "podes partilhar as tuas garantias com a família e aceitar os convites que te fizerem.",
            "Se não foste tu, ignora este email.",
            "",
            "Warrantly",
        ]
    )
    return build_message(user.email, "Confirma o teu email no Warrantly", body)
