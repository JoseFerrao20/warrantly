from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import sessions
from app.config import settings
from app.models import RefreshToken, User
from app.security import ALGORITHM, decode_access_token
from tests.conftest import TEST_PASSWORD

MOBILE = {"X-Client": "mobile"}


@pytest.fixture(autouse=True)
def cookie_path(monkeypatch: pytest.MonkeyPatch) -> None:
    # Nos testes, a API está na raiz (sem o /api do servidor de produção e do Vite).
    monkeypatch.setattr(settings, "refresh_cookie_path", "/auth")


def login(client: TestClient, headers: dict[str, str] | None = None):
    return client.post(
        "/auth/login",
        data={"username": "ana@example.com", "password": TEST_PASSWORD},
        headers=headers or {},
    )


def refresh_body(client: TestClient, token: str):
    return client.post("/auth/refresh", json={"refresh_token": token})


def stored_tokens(session: Session, user: User) -> int:
    # Só os deste utilizador: a base de dados de desenvolvimento pode ter sessões dos E2E.
    query = select(func.count()).select_from(RefreshToken).where(RefreshToken.user_id == user.id)
    return session.scalar(query)


# --- App móvel (refresh token no corpo) ----------------------------------------------------


def test_mobile_login_returns_refresh_token(client: TestClient, db_session: Session, user: User):
    response = login(client, MOBILE)

    assert response.status_code == 200
    body = response.json()
    assert decode_access_token(body["access_token"]) == user.id
    assert body["expires_in"] == 15 * 60
    assert len(body["refresh_token"]) >= 40
    assert "set-cookie" not in response.headers
    # Na base de dados só fica o hash.
    stored = db_session.scalar(select(RefreshToken))
    assert stored.token_hash != body["refresh_token"] and len(stored.token_hash) == 64


def test_access_token_lasts_15_minutes(client: TestClient, user: User):
    token = login(client, MOBILE).json()["access_token"]

    payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    lifetime = payload["exp"] - datetime.now(UTC).timestamp()
    assert 14 * 60 < lifetime <= 15 * 60


def test_refresh_rotates_the_token(client: TestClient, user: User):
    first = login(client, MOBILE).json()["refresh_token"]

    response = refresh_body(client, first)

    assert response.status_code == 200
    body = response.json()
    assert decode_access_token(body["access_token"]) == user.id
    assert body["refresh_token"] != first
    assert (
        client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).json()[
            "email"
        ]
        == user.email
    )
    # O novo também serve.
    assert refresh_body(client, body["refresh_token"]).status_code == 200


def test_reused_refresh_token_revokes_the_whole_session(
    client: TestClient, db_session: Session, user: User, monkeypatch
):
    first = login(client, MOBILE).json()["refresh_token"]
    second = refresh_body(client, first).json()["refresh_token"]
    # Mais tarde (fora da margem), alguém usa o token antigo: foi copiado.
    later = datetime.now(UTC) + sessions.REUSE_GRACE + timedelta(seconds=1)
    monkeypatch.setattr(sessions, "_now", lambda: later)

    response = refresh_body(client, first)

    assert response.status_code == 401
    assert response.json() == {"detail": "Sessão terminada. Entra outra vez."}
    assert refresh_body(client, second).status_code == 401  # o legítimo também deixa de servir
    assert stored_tokens(db_session, user) == 0


def test_reuse_within_grace_period_is_not_theft(client: TestClient, user: User):
    """Dois pedidos quase ao mesmo tempo com o mesmo token (dois separadores)."""
    first = login(client, MOBILE).json()["refresh_token"]

    a = refresh_body(client, first)
    b = refresh_body(client, first)

    assert a.status_code == b.status_code == 200
    assert refresh_body(client, a.json()["refresh_token"]).status_code == 200
    assert refresh_body(client, b.json()["refresh_token"]).status_code == 200


def test_old_used_tokens_are_cleaned_up(
    client: TestClient, db_session: Session, user: User, monkeypatch
):
    token = login(client, MOBILE).json()["refresh_token"]
    now = datetime.now(UTC)
    for minutes in range(1, 6):  # cinco renovações, de minuto a minuto
        monkeypatch.setattr(sessions, "_now", lambda m=minutes: now + timedelta(minutes=m))
        token = refresh_body(client, token).json()["refresh_token"]

    # Fica o atual e o último gasto (ainda dentro da margem quando o atual foi emitido).
    assert stored_tokens(db_session, user) == 2


def test_expired_refresh_token(client: TestClient, user: User, monkeypatch):
    token = login(client, MOBILE).json()["refresh_token"]
    later = datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days, seconds=1)
    monkeypatch.setattr(sessions, "_now", lambda: later)

    assert refresh_body(client, token).status_code == 401


@pytest.mark.parametrize("body", [{"refresh_token": "inventado"}, {}, None])
def test_refresh_without_a_valid_token(client: TestClient, body):
    response = (
        client.post("/auth/refresh", json=body)
        if body is not None
        else client.post("/auth/refresh")
    )
    assert response.status_code == 401


def test_logout_revokes_only_this_device(client: TestClient, user: User):
    phone = login(client, MOBILE).json()["refresh_token"]
    tablet = login(client, MOBILE).json()["refresh_token"]

    response = client.post("/auth/logout", json={"refresh_token": phone})

    assert response.status_code == 204
    assert refresh_body(client, phone).status_code == 401
    assert refresh_body(client, tablet).status_code == 200


def test_logout_with_unknown_token_is_harmless(client: TestClient):
    assert client.post("/auth/logout", json={"refresh_token": "x"}).status_code == 204
    assert client.post("/auth/logout").status_code == 204


def test_deleting_the_account_ends_all_sessions(
    client: TestClient, db_session: Session, user: User
):
    body = login(client, MOBILE).json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    client.request("DELETE", "/auth/me", json={"password": TEST_PASSWORD}, headers=headers)

    assert stored_tokens(db_session, user) == 0
    assert refresh_body(client, body["refresh_token"]).status_code == 401


# --- Browser (refresh token num cookie httpOnly) -------------------------------------------


def test_browser_login_sets_an_httponly_cookie(client: TestClient, user: User):
    response = login(client)

    assert response.status_code == 200
    assert "refresh_token" not in response.json()
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("warrantly_refresh=")
    for attribute in ["HttpOnly", "SameSite=strict", "Path=/auth", f"Max-Age={30 * 24 * 3600}"]:
        assert attribute in cookie
    assert "Secure" not in cookie  # em desenvolvimento (http://localhost)


def test_cookie_is_secure_in_production(client: TestClient, user: User, monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")

    assert "Secure" in login(client).headers["set-cookie"]


def test_browser_refresh_uses_and_rotates_the_cookie(client: TestClient, user: User):
    login(client)
    first = client.cookies["warrantly_refresh"]

    response = client.post("/auth/refresh")

    assert response.status_code == 200
    assert decode_access_token(response.json()["access_token"]) == user.id
    assert "refresh_token" not in response.json()  # nunca no corpo para o browser
    assert client.cookies["warrantly_refresh"] != first


def test_browser_refresh_with_bad_cookie_clears_it(client: TestClient):
    client.cookies.set("warrantly_refresh", "inventado", path="/auth")

    response = client.post("/auth/refresh")

    assert response.status_code == 401
    assert 'warrantly_refresh=""' in response.headers["set-cookie"]
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_browser_logout_clears_the_cookie(client: TestClient, user: User):
    login(client)
    token = client.cookies["warrantly_refresh"]

    response = client.post("/auth/logout")

    assert response.status_code == 204
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert refresh_body(client, token).status_code == 401
