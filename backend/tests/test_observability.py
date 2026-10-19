import json
import logging
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import observability
from app.alerts import send_due_alerts
from app.models import User
from app.observability import JsonFormatter, RequestContextMiddleware, metric
from app.push import PushOutcome
from tests.conftest import TEST_PASSWORD
from tests.test_alerts import TODAY, Outbox, purchase_ending


def as_json(record: logging.LogRecord) -> dict:
    return json.loads(JsonFormatter().format(record))


def metrics(caplog: pytest.LogCaptureFixture) -> dict[str, list[float]]:
    """Métricas EMF escritas durante o teste: {nome: [valores]}."""
    found: dict[str, list[float]] = {}
    for record in caplog.records:
        if emf := getattr(record, "emf", None):
            [definition] = emf["_aws"]["CloudWatchMetrics"]
            name = definition["Metrics"][0]["Name"]
            found.setdefault(name, []).append(emf[name])
    return found


def access_logs(caplog: pytest.LogCaptureFixture) -> list[dict]:
    return [as_json(r) for r in caplog.records if r.name == "app.requests" and not r.exc_info]


@pytest.fixture(autouse=True)
def capture(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="app")


# --- Logs em JSON e id do pedido ------------------------------------------------------------


def test_json_log_line_has_request_id_and_extra_fields():
    token = observability.request_id.set("abc12345")
    try:
        record = logging.makeLogRecord(
            {
                "name": "app.x",
                "levelname": "WARNING",
                "msg": "Olá %s",
                "args": ("mundo",),
                "rota": "/x",
            }
        )
        entry = as_json(record)
    finally:
        observability.request_id.reset(token)

    assert entry["message"] == "Olá mundo"
    assert entry["level"] == "WARNING"
    assert entry["request_id"] == "abc12345"
    assert entry["rota"] == "/x"
    assert entry["time"].endswith("+00:00")


def test_every_response_has_a_request_id_and_one_access_log(
    auth_client: TestClient, user: User, caplog
):
    response = auth_client.get("/purchases/999")

    assert response.status_code == 404
    rid = response.headers["x-request-id"]
    assert len(rid) == 32
    [log] = [line for line in access_logs(caplog) if line["route"] == "/purchases/{purchase_id}"]
    # A rota é o modelo, sem o id: os logs agrupam-se e não guardam dados de ninguém.
    assert log["method"] == "GET"
    assert log["status"] == 404
    assert log["request_id"] == rid
    assert log["duration_ms"] >= 0


def test_reuses_the_cloudfront_request_id(client: TestClient):
    response = client.get("/health/live", headers={"X-Amz-Cf-Id": "Cf_Id-123456789=="})

    assert response.headers["x-request-id"] == "Cf_Id-123456789=="


@pytest.mark.parametrize("bad", ["curto", "tem espacos e quebras", "x" * 200])
def test_ignores_unsafe_request_ids(client: TestClient, bad: str):
    response = client.get("/health/live", headers={"X-Request-ID": bad})

    assert response.headers["x-request-id"] != bad
    assert len(response.headers["x-request-id"]) == 32


def test_unhandled_error_is_logged_and_counted(caplog):
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get("/rebenta/{n}")
    def explode(n: int):
        raise RuntimeError("avaria")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/rebenta/1")

    assert response.status_code == 500
    error = next(r for r in caplog.records if r.name == "app.requests" and r.exc_info)
    assert "RuntimeError: avaria" in as_json(error)["exception"]
    assert metrics(caplog)["ServerErrors"] == [1]
    assert access_logs(caplog)[-1]["status"] == 500


# --- Métricas (EMF) -------------------------------------------------------------------------


def test_metric_is_embedded_metric_format(caplog):
    metric("InvoiceFieldsSuggested", 3, content_type="application/pdf")

    [record] = [r for r in caplog.records if r.name == "app.metrics"]
    emf = json.loads(JsonFormatter().format(record))
    assert emf["_aws"]["CloudWatchMetrics"] == [
        {
            "Namespace": "Warrantly",
            "Dimensions": [[]],
            "Metrics": [{"Name": "InvoiceFieldsSuggested", "Unit": "Count"}],
        }
    ]
    assert emf["InvoiceFieldsSuggested"] == 3
    assert emf["content_type"] == "application/pdf"
    assert isinstance(emf["_aws"]["Timestamp"], int)


def test_login_metrics(client: TestClient, user: User, caplog):
    client.post("/auth/login", data={"username": user.email, "password": "errada-123"})
    client.post("/auth/login", data={"username": user.email, "password": TEST_PASSWORD})

    assert metrics(caplog)["LoginFailed"] == [1]
    assert metrics(caplog)["LoginSucceeded"] == [1]


def test_alert_metrics(db_session: Session, user: User, caplog):
    purchase_ending(db_session, user, date(2026, 11, 1))

    send_due_alerts(db_session, TODAY, send=Outbox(), push=lambda messages: PushOutcome())

    found = metrics(caplog)
    assert found["AlertEmailsSent"] == [1]
    assert found["AlertPushesSent"] == [0]
    assert found["AlertFailures"] == [0]


def test_text_logs_in_development(capsys, monkeypatch):
    monkeypatch.setattr(observability.settings, "log_format", "text")
    observability.configure_logging()
    logging.getLogger("app.teste").warning("cuidado")

    assert "WARNING app.teste: cuidado" in capsys.readouterr().out


def test_json_logs_in_production(capsys, monkeypatch):
    monkeypatch.setattr(observability.settings, "log_format", "json")
    observability.configure_logging()
    try:
        logging.getLogger("app.teste").warning("cuidado")
        line = capsys.readouterr().out.strip().splitlines()[-1]
    finally:
        monkeypatch.undo()
        observability.configure_logging()

    assert json.loads(line)["message"] == "cuidado"
