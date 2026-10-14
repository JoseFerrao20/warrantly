from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Purchase, User
from app.security import ALGORITHM, decode_access_token
from tests.conftest import TEST_PASSWORD


def register(client: TestClient, email: str = "nova@example.com", password: str = "12345678"):
    return client.post("/auth/register", json={"email": email, "password": password})


def login(client: TestClient, email: str, password: str):
    return client.post("/auth/login", data={"username": email, "password": password})


def test_register_creates_user_without_exposing_password(client: TestClient):
    response = register(client, email="Nova@Example.com")

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "nova@example.com"
    assert set(body) == {"id", "email", "created_at"}


def test_register_rejects_duplicate_email_ignoring_case(client: TestClient):
    register(client, email="nova@example.com")

    response = register(client, email="NOVA@example.com")

    assert response.status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "não-é-email", "password": "12345678"},
        {"email": "nova@example.com", "password": "curta"},
        {"email": "nova@example.com"},
    ],
)
def test_register_rejects_invalid_data(client: TestClient, payload: dict):
    assert client.post("/auth/register", json=payload).status_code == 422


def test_login_returns_token_for_user(client: TestClient, user: User):
    response = login(client, "ANA@example.com", TEST_PASSWORD)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert decode_access_token(body["access_token"]) == user.id


@pytest.mark.parametrize(
    ("email", "password"),
    [("ana@example.com", "errada-123"), ("ninguem@example.com", TEST_PASSWORD)],
)
def test_login_rejects_wrong_credentials(client: TestClient, user: User, email: str, password: str):
    response = login(client, email, password)

    assert response.status_code == 401
    assert response.json()["detail"] == "Email ou palavra-passe incorretos"


def test_register_then_login_then_me(client: TestClient):
    register(client, email="fluxo@example.com", password="uma-boa-password")
    token = login(client, "fluxo@example.com", "uma-boa-password").json()["access_token"]

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == "fluxo@example.com"


def test_me_requires_token(client: TestClient):
    response = client.get("/auth/me")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def make_token(sub: str, expires_in: timedelta, key: str = settings.secret_key) -> str:
    payload = {"sub": sub, "exp": datetime.now(UTC) + expires_in}
    return jwt.encode(payload, key, algorithm=ALGORITHM)


@pytest.mark.parametrize(
    "token",
    [
        "isto-nao-e-um-token",
        make_token("1", timedelta(minutes=-1)),  # expirado
        make_token("1", timedelta(minutes=5), key="outra-chave-com-pelo-menos-32-bytes!!"),
        make_token("abc", timedelta(minutes=5)),  # sub não numérico
        make_token("999999", timedelta(minutes=5)),  # utilizador não existe
    ],
)
def test_me_rejects_invalid_tokens(client: TestClient, token: str):
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_deleting_user_deletes_their_purchases(
    auth_client: TestClient, user: User, db_session: Session
):
    created = auth_client.post(
        "/purchases",
        json={"product_name": "X", "store": "Y", "purchase_date": "2026-01-01", "price": "1"},
    ).json()

    db_session.delete(user)
    db_session.flush()

    assert db_session.get(Purchase, created["id"]) is None
