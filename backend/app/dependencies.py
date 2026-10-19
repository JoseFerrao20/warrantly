from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import User, UserSession
from app.security import decode_access_claims

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

SessionDep = Annotated[Session, Depends(get_session)]


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], session: SessionDep) -> User:
    claims = decode_access_claims(token)
    user = session.get(User, claims.user_id) if claims is not None else None
    # Uma sessão terminada (sair, "terminar sessão" noutro aparelho, palavra-passe reposta)
    # recusa logo os tokens de acesso dela, sem esperar que expirem.
    if user is not None and claims.session_id is not None:
        alive = session.scalar(
            select(UserSession.id).where(
                UserSession.family == claims.session_id, UserSession.user_id == user.id
            )
        )
        if alive is None:
            user = None
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_session_id(token: Annotated[str, Depends(oauth2_scheme)]) -> str | None:
    """A sessão do token de acesso (para marcar "este aparelho" na lista de sessões)."""
    claims = decode_access_claims(token)
    return claims.session_id if claims else None


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentSessionId = Annotated[str | None, Depends(get_current_session_id)]
