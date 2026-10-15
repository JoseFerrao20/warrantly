from datetime import date
from decimal import Decimal
from email.message import EmailMessage

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import mailer
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
