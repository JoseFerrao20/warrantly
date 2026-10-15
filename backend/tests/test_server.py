from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.server import create_server


@pytest.fixture
def server_client(tmp_path) -> Iterator[TestClient]:
    """Servidor de produção com um "build" do frontend falso numa pasta temporária."""
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>Warrantly</title>")
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)")
    with TestClient(create_server(tmp_path)) as client:
        yield client


def test_api_is_served_under_api_prefix(server_client: TestClient):
    response = server_client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}
    assert server_client.get("/api/purchases").status_code == 401


def test_frontend_routes_return_index_html(server_client: TestClient):
    for path in ["/", "/entrar", "/compras/3/editar"]:
        response = server_client.get(path)
        assert response.status_code == 200
        assert "<title>Warrantly</title>" in response.text


def test_hashed_assets_are_cached(server_client: TestClient):
    response = server_client.get("/assets/index-abc123.js")

    assert response.status_code == 200
    assert "immutable" in response.headers["cache-control"]


def test_unknown_api_route_is_404_not_index(server_client: TestClient):
    response = server_client.get("/api/nao-existe")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("postgres://u:p@host:5432/db", "postgresql+psycopg://u:p@host:5432/db"),
        ("postgresql://u:p@host/db?sslmode=require", "postgresql+psycopg://u:p@host/db?sslmode=require"),
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
    ],
)
def test_database_url_gets_psycopg_driver(url: str, expected: str):
    assert Settings(database_url=url).database_url == expected


def test_production_refuses_the_example_secret_key():
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(environment="production")

    assert Settings(environment="production", secret_key="x" * 40).environment == "production"


def test_without_frontend_build_only_the_api_is_served():
    with TestClient(create_server(None)) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 404


def test_empty_env_values_count_as_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ALERTS_TOKEN", "")
    monkeypatch.setenv("SMTP_HOST", "")

    settings = Settings()

    assert settings.alerts_token is None
    assert settings.smtp_host is None
