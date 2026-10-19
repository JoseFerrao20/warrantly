from datetime import date
from decimal import Decimal
from email.message import EmailMessage

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import mailer, push
from app.config import settings
from app.models import Purchase, User

TOKEN = "t" * 40


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> list[EmailMessage]:
    sent: list[EmailMessage] = []
    monkeypatch.setattr(settings, "alerts_token", TOKEN)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(mailer, "send_email", sent.append)
    return sent


def test_route_does_not_exist_without_token(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "alerts_token", None)

    assert client.post("/internal/alerts", headers={"Authorization": "Bearer x"}).status_code == 404


@pytest.mark.parametrize("header", [None, "Bearer errado", f"Token {TOKEN}"])
def test_requires_the_right_token(client: TestClient, configured, header: str | None):
    headers = {"Authorization": header} if header else {}

    assert client.post("/internal/alerts", headers=headers).status_code == 401


def test_requires_smtp(client: TestClient, configured, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "smtp_host", None)

    response = client.post("/internal/alerts", headers={"Authorization": f"Bearer {TOKEN}"})

    assert response.status_code == 503


def test_sends_due_alerts(
    client: TestClient, configured: list[EmailMessage], db_session: Session, user: User
):
    end_soon = date.today().replace(day=1)  # fim da garantia daqui a pouco tempo
    purchase = Purchase(
        user_id=user.id,
        product_name="Torradeira",
        store="Worten",
        purchase_date=end_soon.replace(year=end_soon.year - 1),
        price=Decimal("20"),
        warranty_months=13,
    )
    db_session.add(purchase)
    db_session.flush()

    response = client.post("/internal/alerts", headers={"Authorization": f"Bearer {TOKEN}"})

    assert response.status_code == 200
    assert response.json()["failed_users"] == []
    assert any(m["To"] == user.email for m in configured)


# --- Eventos agendados (EventBridge Scheduler → Lambda Web Adapter) --------------------------

LAMBDA_EVENT = {"x-amzn-lambda-context": '{"request_id": "abc"}'}


def test_scheduled_event_runs_the_alerts(
    client: TestClient, configured: list[EmailMessage], db_session: Session, user: User
):
    end_soon = date.today().replace(day=1)
    db_session.add(
        Purchase(
            user_id=user.id,
            product_name="Torradeira",
            store="Worten",
            purchase_date=end_soon.replace(year=end_soon.year - 1),
            price=Decimal("20"),
            warranty_months=13,
        )
    )
    db_session.flush()

    response = client.post("/internal/events", json={"task": "alerts"}, headers=LAMBDA_EVENT)

    assert response.status_code == 200
    assert response.json()["emails_sent"] == 1
    assert any(m["To"] == user.email for m in configured)


@pytest.mark.parametrize(
    "headers",
    [
        {},  # sem o contexto do Lambda: não veio do Lambda Web Adapter
        # Um pedido HTTP pela Function URL traz o contexto do pedido, mesmo com o do Lambda.
        {**LAMBDA_EVENT, "x-amzn-request-context": '{"http": {"method": "POST"}}'},
    ],
)
def test_scheduled_events_are_refused_from_http(client: TestClient, configured, headers):
    response = client.post("/internal/events", json={"task": "alerts"}, headers=headers)

    assert response.status_code == 403
    assert configured == []


def test_unknown_scheduled_task(client: TestClient, configured):
    response = client.post("/internal/events", json={"task": "outra"}, headers=LAMBDA_EVENT)

    assert response.status_code == 422


def test_scheduled_event_needs_email(client: TestClient, configured, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", None)

    response = client.post("/internal/events", json={"task": "alerts"}, headers=LAMBDA_EVENT)

    assert response.status_code == 503


def test_scheduled_event_checks_push_receipts(client: TestClient, monkeypatch):
    monkeypatch.setattr(push, "_get_receipts", lambda ids: {})

    response = client.post("/internal/events", json={"task": "push-receipts"}, headers=LAMBDA_EVENT)

    assert response.status_code == 200
    assert set(response.json()) == {"checked", "tokens_removed", "errors", "pending"}


def test_push_receipts_need_the_lambda_context(client: TestClient):
    response = client.post("/internal/events", json={"task": "push-receipts"})

    assert response.status_code == 403


def test_push_receipts_when_push_is_disabled(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "push_enabled", False)  # e o no_real_push garante o resto

    response = client.post("/internal/events", json={"task": "push-receipts"}, headers=LAMBDA_EVENT)

    assert response.json() == {"checked": 0, "tokens_removed": 0, "errors": 0, "pending": 0}
