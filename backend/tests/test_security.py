"""Limites de tentativas, tamanho dos pedidos e cabeçalhos de segurança."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import rate_limit
from app.config import settings
from app.models import User
from app.rate_limit import RateLimiter
from app.server import SECURITY_HEADERS, create_server
from tests.conftest import TEST_PASSWORD, make_user


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_rate_limiter_sliding_window():
    clock = FakeClock()
    limiter = RateLimiter(limit=2, window=60, clock=clock)

    limiter.hit("a")
    assert limiter.retry_after("a") is None
    clock.now += 10
    limiter.hit("a")
    assert limiter.retry_after("a") == 50  # o primeiro evento sai da janela daqui a 50 s
    assert limiter.retry_after("b") is None  # outras chaves não contam

    clock.now += 50
    assert limiter.retry_after("a") is None
    limiter.hit("a")
    assert limiter.retry_after("a") == 10

    limiter.reset("a")
    assert limiter.retry_after("a") is None


def login(client: TestClient, email: str, password: str):
    return client.post("/auth/login", data={"username": email, "password": password})


def test_login_is_blocked_after_repeated_failures(client: TestClient, user: User):
    for _ in range(5):
        assert login(client, user.email, "errada-123").status_code == 401

    response = login(client, user.email, TEST_PASSWORD)  # nem a palavra-passe certa passa

    assert response.status_code == 429
    assert "Demasiadas tentativas" in response.json()["detail"]
    assert 0 < int(response.headers["retry-after"]) <= 15 * 60


def test_successful_login_clears_the_failures(client: TestClient, user: User):
    for _ in range(4):
        login(client, user.email, "errada-123")
    assert login(client, user.email, TEST_PASSWORD).status_code == 200

    for _ in range(4):
        assert login(client, user.email, "errada-123").status_code == 401
    assert login(client, user.email, TEST_PASSWORD).status_code == 200


def test_login_limit_per_email_counts_unknown_emails_too(client: TestClient):
    for _ in range(5):
        assert login(client, "nao-existe@example.com", "x").status_code == 401

    assert login(client, "nao-existe@example.com", "x").status_code == 429


def test_login_limit_per_ip_across_emails(client: TestClient, db_session: Session):
    for i in range(30):
        assert login(client, f"pessoa{i}@example.com", "x").status_code == 401

    other = make_user(db_session, "rui@example.com")
    assert login(client, other.email, TEST_PASSWORD).status_code == 429


def test_register_is_limited_per_ip(client: TestClient):
    for i in range(10):
        response = client.post(
            "/auth/register", json={"email": f"nova{i}@example.com", "password": "segredo-123"}
        )
        assert response.status_code == 201

    response = client.post(
        "/auth/register", json={"email": "mais@example.com", "password": "segredo-123"}
    )
    assert response.status_code == 429


def test_delete_account_password_is_limited(auth_client: TestClient):
    for _ in range(5):
        response = auth_client.request("DELETE", "/auth/me", json={"password": "errada-123"})
        assert response.status_code == 403

    response = auth_client.request("DELETE", "/auth/me", json={"password": TEST_PASSWORD})
    assert response.status_code == 429


def test_rate_limits_can_be_disabled(client: TestClient, user: User, monkeypatch):
    monkeypatch.setattr(settings, "rate_limits", False)
    for _ in range(10):
        assert login(client, user.email, "errada-123").status_code == 401
    assert login(client, user.email, TEST_PASSWORD).status_code == 200


@pytest.mark.parametrize("chunked", [False, True])
def test_oversized_request_is_rejected(auth_client: TestClient, chunked: bool):
    purchase = auth_client.post(
        "/purchases",
        json={"product_name": "TV", "store": "Fnac", "purchase_date": "2026-01-10", "price": "1"},
    ).json()
    size = settings.max_invoice_bytes + 2 * 1024 * 1024
    boundary = "limite"
    body = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n"
        ).encode()
        + b"%PDF"
        + b"0" * size
    )

    def chunks():
        for start in range(0, len(body), 1024 * 1024):
            yield body[start : start + 1024 * 1024]

    response = auth_client.put(
        f"/purchases/{purchase['id']}/invoice",
        content=chunks() if chunked else body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "O pedido é demasiado grande"}


def test_security_headers_on_frontend_and_api(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>Warrantly</title>")
    with TestClient(create_server(tmp_path)) as client:
        for path in ["/", "/compras/3", "/api/health", "/api/purchases"]:
            response = client.get(path)
            for name, value in SECURITY_HEADERS.items():
                assert response.headers[name] == value, (path, name)

    csp = SECURITY_HEADERS["Content-Security-Policy"]
    assert "script-src 'self';" in csp  # sem 'unsafe-inline' nos scripts
    assert "frame-ancestors 'none'" in csp


def test_limiters_start_empty_in_each_test():
    # A fixture reset_rate_limits limpa tudo; aqui só confirmamos que não ficou nada.
    assert all(not limiter._events for limiter in rate_limit.ALL)
