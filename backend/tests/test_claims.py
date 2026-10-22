from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.claims import build_claim, format_price
from app.models import Purchase, User
from tests.conftest import auth_headers, make_user

PDF = b"%PDF-1.7\n%%EOF\n"


def make_purchase(session: Session, user: User, **overrides) -> Purchase:
    data = {
        "user_id": user.id,
        "product_name": "Máquina de lavar Bosch",
        "store": "Worten",
        "purchase_date": date(2023, 11, 3),
        "price": Decimal("429.00"),
        "warranty_months": 36,
    }
    purchase = Purchase(**(data | overrides))
    session.add(purchase)
    session.flush()
    session.refresh(purchase)
    return purchase


@pytest.mark.parametrize(
    ("price", "expected"),
    [(Decimal("429"), "429,00 €"), (Decimal("1234.5"), "1 234,50 €"), (Decimal("0.99"), "0,99 €")],
)
def test_format_price(price: Decimal, expected: str):
    assert format_price(price) == expected


def test_claim_letter_within_warranty(db_session: Session, user: User):
    user.full_name = "José Ferrão"
    purchase = make_purchase(
        db_session, user, invoice_number="FT 2023/48213", store_nif="503630330"
    )

    subject, body = build_claim(
        purchase, user, "Não centrifuga e dá o erro E18.", today=date(2026, 10, 15)
    )

    assert subject == "Reclamação ao abrigo da garantia: Máquina de lavar Bosch"
    assert body.startswith("Exmos. Senhores Worten,")
    assert "Decreto-Lei n.º 84/2021, de 18 de outubro" in body
    assert "ainda dentro do prazo de garantia (válida até 03/11/2026)" in body
    assert "- Data de compra: 03/11/2023" in body
    assert "- Preço: 429,00 €" in body
    assert "- Fatura n.º FT 2023/48213\n- NIF do vendedor: 503630330" in body
    assert "Descrição da avaria:\nNão centrifuga e dá o erro E18." in body
    assert "Junto cópia da fatura" not in body  # sem ficheiro carregado
    assert body.endswith("Com os melhores cumprimentos,\nJosé Ferrão\nana@example.com")


def test_claim_letter_after_warranty_and_with_invoice_file(db_session: Session, user: User):
    user.full_name = "José Ferrão"
    purchase = make_purchase(db_session, user, invoice_key="abc.pdf")

    _, body = build_claim(purchase, user, "Avaria.", today=date(2026, 11, 4))

    assert "dentro do prazo" not in body
    assert "Fatura n.º" not in body
    assert "NIF do vendedor" not in body
    assert "Junto cópia da fatura de compra." in body


def test_claim_endpoint(auth_client: TestClient, db_session: Session, user: User):
    user.full_name = "José Ferrão"
    purchase = make_purchase(db_session, user, purchase_date=date.today(), invoice_number="FT 1")

    response = auth_client.post(
        f"/purchases/{purchase.id}/claim", json={"description": "Não liga."}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["within_warranty"] is True
    assert body["subject"] == "Reclamação ao abrigo da garantia: Máquina de lavar Bosch"
    assert "Não liga." in body["body"] and "José Ferrão" in body["body"]


def test_claim_mentions_uploaded_invoice(auth_client: TestClient, db_session: Session, user: User):
    user.full_name = "José Ferrão"
    purchase = make_purchase(db_session, user)
    auth_client.put(
        f"/purchases/{purchase.id}/invoice", files={"file": ("f.pdf", PDF, "application/pdf")}
    )

    body = auth_client.post(f"/purchases/{purchase.id}/claim", json={"description": "X"}).json()

    assert "Junto cópia da fatura de compra." in body["body"]


def test_claim_expired_purchase_is_flagged(
    auth_client: TestClient, db_session: Session, user: User
):
    user.full_name = "José Ferrão"
    purchase = make_purchase(db_session, user, purchase_date=date(2020, 1, 1))

    body = auth_client.post(f"/purchases/{purchase.id}/claim", json={"description": "X"}).json()

    assert body["within_warranty"] is False


def test_claim_requires_full_name(auth_client: TestClient, db_session: Session, user: User):
    purchase = make_purchase(db_session, user)

    response = auth_client.post(f"/purchases/{purchase.id}/claim", json={"description": "X"})

    assert response.status_code == 422
    assert "nome" in response.json()["detail"]


@pytest.mark.parametrize("description", ["", "x" * 2001])
def test_claim_rejects_invalid_description(
    auth_client: TestClient, db_session: Session, user: User, description: str
):
    user.full_name = "José Ferrão"
    purchase = make_purchase(db_session, user)

    response = auth_client.post(
        f"/purchases/{purchase.id}/claim", json={"description": description}
    )

    assert response.status_code == 422


def test_claim_on_other_users_purchase_is_404(auth_client: TestClient, db_session: Session):
    other = make_user(db_session, "rui@example.com")
    other.full_name = "Rui"
    theirs = make_purchase(db_session, other)

    assert (
        auth_client.post(f"/purchases/{theirs.id}/claim", json={"description": "X"}).status_code
        == 404
    )
    assert (
        auth_client.post(
            f"/purchases/{theirs.id}/claim", json={"description": "X"}, headers=auth_headers(other)
        ).status_code
        == 200
    )


def test_invoice_number_on_purchase_api(auth_client: TestClient):
    created = auth_client.post(
        "/purchases",
        json={
            "product_name": "TV",
            "store": "Fnac",
            "purchase_date": "2026-01-10",
            "price": "399",
            "invoice_number": "FT 2026/1",
        },
    ).json()
    assert created["invoice_number"] == "FT 2026/1"

    cleared = auth_client.patch(f"/purchases/{created['id']}", json={"invoice_number": None})
    assert cleared.status_code == 200 and cleared.json()["invoice_number"] is None
