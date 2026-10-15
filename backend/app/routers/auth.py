from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import rate_limit, storage
from app.config import settings
from app.dependencies import CurrentUser, SessionDep
from app.models import Purchase, User
from app.schemas import AccountDelete, Token, UserCreate, UserRead, UserUpdate
from app.security import DUMMY_PASSWORD_HASH, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def client_ip(request: Request) -> str:
    # Atrás do proxy do Fly, o uvicorn (--proxy-headers) já põe aqui o IP do cliente.
    return request.client.host if request.client else "desconhecido"


def check_limits(*checks: tuple[rate_limit.RateLimiter, str]) -> None:
    """429 (com Retry-After) se alguma das chaves já atingiu o limite."""
    if not settings.rate_limits:
        return
    waits = [wait for limiter, key in checks if (wait := limiter.retry_after(key)) is not None]
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
    check_limits((rate_limit.registrations_ip, ip))
    rate_limit.registrations_ip.hit(ip)
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


@router.post("/login", response_model=Token)
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()], request: Request, session: SessionDep
) -> Token:
    """Login no formato OAuth2 (`username` = email e `password`), para funcionar no /docs.

    Depois de várias falhas seguidas, responde 429 durante algum tempo (ver `rate_limit`).
    """
    email = form.username.lower()
    ip = client_ip(request)
    limits = [
        (rate_limit.login_failures_ip_email, f"{ip} {email}"),
        (rate_limit.login_failures_ip, ip),
        (rate_limit.login_failures_email, email),
    ]
    check_limits(*limits)
    user = session.scalar(select(User).where(User.email == email))
    password_ok = verify_password(
        form.password, user.password_hash if user else DUMMY_PASSWORD_HASH
    )
    if user is None or not password_ok:
        for limiter, key in limits:
            limiter.hit(key)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Email ou palavra-passe incorretos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    rate_limit.login_failures_ip_email.reset(f"{ip} {email}")
    return Token(access_token=create_access_token(user.id))


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
    check_limits((rate_limit.password_checks_user, key))
    if not verify_password(data.password, user.password_hash):
        rate_limit.password_checks_user.hit(key)
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Palavra-passe incorreta")
    invoice_keys = list(
        session.scalars(
            select(Purchase.invoice_key).where(
                Purchase.user_id == user.id, Purchase.invoice_key.is_not(None)
            )
        )
    )
    session.delete(user)  # compras e alertas saem pelo ON DELETE CASCADE da base de dados
    session.commit()
    for key in invoice_keys:
        storage.delete(key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
