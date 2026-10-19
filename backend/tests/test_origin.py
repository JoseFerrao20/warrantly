from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.config import settings
from app.db import get_session
from app.main import app as api
from app.origin import client_ip
from app.server import create_server

SECRET = "s" * 40
FROM_CLOUDFRONT = {"X-Origin-Verify": SECRET}


@pytest.fixture
def with_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "origin_verify_secret", SECRET)


@pytest.fixture
def server_client(db_session: Session) -> Iterator[TestClient]:
    """O servidor de produção (API em /api), com a sessão de teste."""
    api.dependency_overrides[get_session] = lambda: db_session
    with TestClient(create_server(None)) as client:
        yield client
    api.dependency_overrides.clear()


def register(client: TestClient, email: str, headers: dict[str, str]) -> int:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "palavra-passe-1"},
        headers=headers,
    )
    return response.status_code


@pytest.mark.usefixtures("with_secret")
def test_api_refuses_requests_without_the_cloudfront_secret(server_client: TestClient):
    """Fecha o acesso direto à Function URL: só o CloudFront conhece o segredo."""
    for headers in ({}, {"X-Origin-Verify": "x" * 40}):
        response = server_client.get("/api/health", headers=headers)
        assert response.status_code == 403
        assert response.json() == {"detail": "Acesso direto não permitido"}
        # Os cabeçalhos de segurança também vão na recusa.
        assert response.headers["x-content-type-options"] == "nosniff"

    assert server_client.get("/api/health", headers=FROM_CLOUDFRONT).status_code == 200


@pytest.mark.usefixtures("with_secret")
def test_lambda_paths_work_without_the_secret(server_client: TestClient):
    """A verificação de saúde do adapter e os eventos agendados não passam pelo CloudFront."""
    assert server_client.get("/api/health/live").status_code == 200
    # Sem o contexto do Lambda, a rota recusa por si (403 dela, não do middleware).
    response = server_client.post("/api/internal/events", json={"task": "alerts"})
    assert response.json() != {"detail": "Acesso direto não permitido"}


def test_without_secret_nothing_changes(server_client: TestClient):
    assert server_client.get("/api/health").status_code == 200


@pytest.mark.usefixtures("with_secret")
def test_limits_count_the_ip_cloudfront_saw(server_client: TestClient):
    """Um X-Forwarded-For inventado não muda nada; o X-Viewer-IP (do CloudFront) sim."""
    first = {**FROM_CLOUDFRONT, "X-Viewer-IP": "203.0.113.7"}
    for n in range(10):  # o limite de contas novas por IP
        spoofed = {**first, "X-Forwarded-For": f"198.51.100.{n}"}
        assert register(server_client, f"nova{n}@example.com", spoofed) == 201
    assert register(server_client, "nova10@example.com", first) == 429

    other = {**FROM_CLOUDFRONT, "X-Viewer-IP": "203.0.113.8"}
    assert register(server_client, "nova11@example.com", other) == 201


@pytest.mark.usefixtures("with_secret")
def test_viewer_ip_header_counts_only_with_the_secret():
    """Sem o segredo, o X-Viewer-IP é ignorado: quem chama diretamente podia inventá-lo."""
    scope = {
        "type": "http",
        "headers": [(b"x-viewer-ip", b"203.0.113.7")],
        "client": ("10.0.0.1", 1234),
    }
    assert client_ip(Request(scope)) == "10.0.0.1"
    scope["headers"].append((b"x-origin-verify", SECRET.encode()))
    assert client_ip(Request(scope)) == "203.0.113.7"
