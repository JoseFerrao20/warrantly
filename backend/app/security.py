from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.config import settings

ALGORITHM = "HS256"

password_hash = PasswordHash.recommended()  # Argon2

# Hash de uma palavra-passe qualquer: no login com um email que não existe, verificamos contra
# este hash para a resposta demorar o mesmo e não revelar que emails estão registados.
DUMMY_PASSWORD_HASH = password_hash.hash("dummy-password-for-timing")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: int, session_id: str | None = None) -> str:
    """Token de acesso; `session_id` (claim `sid`) é a sessão de onde veio (ver app/sessions.py)."""
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "exp": expires_at}
    if session_id is not None:
        payload["sid"] = session_id
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


@dataclass(frozen=True)
class AccessClaims:
    user_id: int
    session_id: str | None  # None nos tokens criados sem sessão (testes, tokens antigos)


def decode_access_claims(token: str) -> AccessClaims | None:
    """O utilizador e a sessão do token, ou None se for inválido ou estiver expirado."""
    try:
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]}
        )
        if "purpose" in payload:  # outro tipo de token (ex.: repor a palavra-passe)
            return None
        session_id = payload.get("sid")
        if not isinstance(session_id, str):
            session_id = None
        return AccessClaims(int(payload["sub"]), session_id)
    except (jwt.InvalidTokenError, ValueError):
        return None


def decode_access_token(token: str) -> int | None:
    """Devolve o id do utilizador, ou None se o token for inválido ou estiver expirado."""
    claims = decode_access_claims(token)
    return claims.user_id if claims else None
