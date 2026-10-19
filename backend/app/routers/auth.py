import logging
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import mailer, password_reset, rate_limit, sessions, storage
from app.config import settings
from app.dependencies import CurrentSessionId, CurrentUser, SessionDep
from app.models import Purchase, User
from app.observability import metric
from app.schemas import (
    AccountDelete,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    SessionRead,
    SessionsEnded,
    Token,
    UserCreate,
    UserRead,
    UserUpdate,
)
from app.security import DUMMY_PASSWORD_HASH, hash_password, verify_password

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# No browser, o refresh token vai neste cookie: httpOnly (o JavaScript não o lê, por isso um
# XSS não o rouba), SameSite=Strict (outros sites não o enviam) e só para /api/auth.
REFRESH_COOKIE = "warrantly_refresh"
# A app móvel não tem cookies: pede o refresh token no corpo da resposta com este cabeçalho.
MOBILE_CLIENT = "mobile"


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=settings.refresh_token_expire_days * 24 * 3600,
        path=settings.refresh_cookie_path,
        httponly=True,
        samesite="strict",
        secure=settings.environment == "production",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE,
        path=settings.refresh_cookie_path,
        httponly=True,
        samesite="strict",
        secure=settings.environment == "production",
    )


def token_response(pair: sessions.TokenPair, response: Response, in_body: bool) -> Token:
    """Na app móvel, o refresh token vai no corpo; no browser, no cookie."""
    if in_body:
        return Token(
            access_token=pair.access_token,
            expires_in=pair.expires_in,
            refresh_token=pair.refresh_token,
        )
    set_refresh_cookie(response, pair.refresh_token)
    return Token(access_token=pair.access_token, expires_in=pair.expires_in)


def client_ip(request: Request) -> str:
    # Atrás do proxy do Fly, o uvicorn (--proxy-headers) já põe aqui o IP do cliente.
    return request.client.host if request.client else "desconhecido"


def check_limits(session: Session, *checks: tuple[rate_limit.RateLimiter, str]) -> None:
    """429 (com Retry-After) se alguma das chaves já atingiu o limite."""
    if not settings.rate_limits:
        return
    waits = [
        wait for limiter, key in checks if (wait := limiter.retry_after(session, key)) is not None
    ]
    if waits:
        wait = max(waits)
        minutes = max(1, round(wait / 60))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiadas tentativas. Tenta outra vez dentro de {minutes} min.",
            headers={"Retry-After": str(wait)},
        )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, request: Request, session: SessionDep) -> User:
    ip = client_ip(request)
    check_limits(session, (rate_limit.registrations_ip, ip))
    rate_limit.registrations_ip.hit(session, ip)
    user = User(
        email=data.email.lower(),
        password_hash=hash_password(data.password),
        full_name=data.full_name.strip() if data.full_name else None,
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Já existe uma conta com este email"
        ) from None
    session.refresh(user)
    return user


@router.post("/login", response_model=Token, response_model_exclude_none=True)
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    request: Request,
    response: Response,
    session: SessionDep,
    x_client: Annotated[str | None, Header()] = None,
    user_agent: Annotated[str | None, Header()] = None,
    x_device_name: Annotated[str | None, Header()] = None,
) -> Token:
    """Login no formato OAuth2 (`username` = email e `password`), para funcionar no /docs.

    Devolve o token de acesso e começa uma sessão longa (refresh token, ver `app.sessions`):
    no browser, num cookie httpOnly; na app móvel (`X-Client: mobile`), no corpo.
    Depois de várias falhas seguidas, responde 429 durante algum tempo (ver `rate_limit`).
    """
    email = form.username.lower()
    ip = client_ip(request)
    limits = [
        (rate_limit.login_failures_ip_email, f"{ip} {email}"),
        (rate_limit.login_failures_ip, ip),
        (rate_limit.login_failures_email, email),
    ]
    check_limits(session, *limits)
    user = session.scalar(select(User).where(User.email == email))
    password_ok = verify_password(
        form.password, user.password_hash if user else DUMMY_PASSWORD_HASH
    )
    if user is None or not password_ok:
        metric("LoginFailed")
        for limiter, key in limits:
            limiter.hit(session, key)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Email ou palavra-passe incorretos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    rate_limit.login_failures_ip_email.reset(session, f"{ip} {email}")
    metric("LoginSucceeded")
    device = sessions.describe_device(user_agent, x_device_name)
    pair = sessions.start_session(session, user.id, device)
    return token_response(pair, response, in_body=x_client == MOBILE_CLIENT)


@router.post("/refresh", response_model=Token, response_model_exclude_none=True)
def refresh(
    response: Response,
    session: SessionDep,
    data: RefreshRequest | None = None,
    warrantly_refresh: Annotated[str | None, Cookie()] = None,
) -> Token | JSONResponse:
    """Troca o refresh token (do corpo ou do cookie) por um token de acesso e um refresh novo."""
    in_body = data is not None and data.refresh_token is not None
    refresh_token = data.refresh_token if in_body else warrantly_refresh
    pair = sessions.refresh_session(session, refresh_token) if refresh_token else None
    if pair is None:
        error = JSONResponse(
            {"detail": "Sessão terminada. Entra outra vez."},
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
        if not in_body:
            clear_refresh_cookie(error)  # um cookie que já não serve sai do browser
        return error
    return token_response(pair, response, in_body)


@router.get("/sessions", response_model=list[SessionRead])
def list_sessions(
    user: CurrentUser, session: SessionDep, current_id: CurrentSessionId
) -> list[SessionRead]:
    """As sessões abertas (aparelhos com login feito), com a deste pedido marcada."""
    return [
        SessionRead.model_validate(item).model_copy(update={"current": item.family == current_id})
        for item in sessions.list_sessions(session, user.id)
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def end_session_by_id(session_id: int, user: CurrentUser, session: SessionDep) -> Response:
    """Termina a sessão de um aparelho: os tokens dela (refresh e acesso) deixam de servir."""
    if not sessions.end_user_session(session, user.id, session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/end-others", response_model=SessionsEnded)
def end_other_sessions(
    user: CurrentUser, session: SessionDep, current_id: CurrentSessionId
) -> SessionsEnded:
    """Sair de todos os outros aparelhos (este continua com sessão)."""
    ended = sessions.end_other_sessions(session, user.id, keep_family=current_id)
    if ended:
        logger.info("Terminadas %d sessões noutros aparelhos", ended)
    return SessionsEnded(ended=ended)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    session: SessionDep,
    data: RefreshRequest | None = None,
    warrantly_refresh: Annotated[str | None, Cookie()] = None,
) -> Response:
    """Sair neste aparelho: o refresh token deixa de servir (o de acesso expira sozinho)."""
    refresh_token = (data.refresh_token if data else None) or warrantly_refresh
    if refresh_token:
        sessions.end_session(session, refresh_token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response)
    return response


# A mesma resposta exista ou não a conta: não revela que emails estão registados.
RESET_REQUESTED = (
    "Se existir uma conta com este email, enviámos um link para repor a palavra-passe. "
    "Vê a caixa de correio (e o spam)."
)


@router.post("/password-reset", status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(
    data: PasswordResetRequest, request: Request, session: SessionDep
) -> dict[str, str]:
    """Envia um link para repor a palavra-passe (válido 1 hora, de uso único)."""
    if not mailer.is_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="O envio de emails não está configurado"
        )
    email = data.email.lower()
    ip = client_ip(request)
    limits = [(rate_limit.password_resets_ip, ip), (rate_limit.password_resets_email, email)]
    check_limits(session, *limits)
    for limiter, key in limits:
        limiter.hit(session, key)
    user = session.scalar(select(User).where(User.email == email))
    metric("PasswordResetRequested")
    if user is not None:
        token = password_reset.create_reset_token(user)
        try:
            mailer.send_email(password_reset.build_reset_email(user, token))
        except Exception:
            # A resposta não muda (não revela que a conta existe); o erro fica no log.
            logger.exception("Falhou o email de recuperação da palavra-passe")
    return {"detail": RESET_REQUESTED}


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
def confirm_password_reset(data: PasswordResetConfirm, session: SessionDep) -> Response:
    """Muda a palavra-passe com o token do link e termina todas as sessões da conta."""
    user = password_reset.user_for_token(session, data.token)
    if user is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="O link é inválido ou já expirou. Pede um novo."
        )
    password_reset.reset_password(session, user, data.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserRead)
def me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserRead)
def update_me(data: UserUpdate, user: CurrentUser, session: SessionDep) -> User:
    if "full_name" in data.model_fields_set:
        user.full_name = data.full_name.strip() if data.full_name else None
    session.commit()
    session.refresh(user)
    return user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(data: AccountDelete, user: CurrentUser, session: SessionDep) -> Response:
    """Apaga a conta, as compras, os alertas e os ficheiros das faturas. Pede a palavra-passe."""
    key = str(user.id)
    check_limits(session, (rate_limit.password_checks_user, key))
    if not verify_password(data.password, user.password_hash):
        rate_limit.password_checks_user.hit(session, key)
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Palavra-passe incorreta")
    invoice_keys = list(
        session.scalars(
            select(Purchase.invoice_key).where(
                Purchase.user_id == user.id, Purchase.invoice_key.is_not(None)
            )
        )
    )
    session.delete(user)  # compras, alertas e sessões saem pelo ON DELETE CASCADE
    session.commit()
    for key in invoice_keys:
        storage.delete(key)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_refresh_cookie(response)
    return response
