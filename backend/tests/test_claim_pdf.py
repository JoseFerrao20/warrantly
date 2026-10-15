from datetime import date
from decimal import Decimal
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen.canvas import Canvas
from sqlalchemy.orm import Session

from app.claim_pdf import long_date
from app.models import Purchase, User
from tests.conftest import auth_headers, make_user


def invoice_pdf(pages: int = 1) -> bytes:
    buffer = BytesIO()
    canvas = Canvas(buffer)
    for n in range(pages):
        canvas.drawString(100, 700, f"FATURA FT 2023/48213 pagina {n + 1}")
        canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def invoice_png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (600, 800), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def make_purchase(session: Session, user: User) -> Purchase:
    purchase = Purchase(
        user_id=user.id,
        product_name="Máquina de lavar Bosch",
        store="Worten",
        purchase_date=date.today(),
        price=Decimal("1234.50"),
        warranty_months=36,
        invoice_number="FT 2023/48213",
    )
    session.add(purchase)
    session.flush()
    return purchase


def claim_pdf(client: TestClient, purchase_id: int, **kwargs):
    return client.post(
        f"/purchases/{purchase_id}/claim.pdf",
        json={"description": "Não centrifuga e dá o erro E18."},
        **kwargs,
    )


def pdf_text(data: bytes) -> tuple[int, str]:
    reader = PdfReader(BytesIO(data))
    return len(reader.pages), "\n".join(page.extract_text() for page in reader.pages)


@pytest.fixture
def named_user(user: User) -> User:
    user.full_name = "José Ferrão"
    return user


def test_long_date():
    assert long_date(date(2026, 3, 9)) == "9 de março de 2026"


def test_pdf_without_invoice_has_only_the_letter(
    auth_client: TestClient, db_session: Session, named_user: User
):
    purchase = make_purchase(db_session, named_user)

    response = claim_pdf(auth_client, purchase.id)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == (
        f'attachment; filename="reclamacao-{purchase.id}.pdf"'
    )
    assert response.headers["x-invoice-included"] == "false"
    pages, text = pdf_text(response.content)
    assert pages == 1
    for expected in [
        "José Ferrão",
        "ana@example.com",
        "Assunto:",
        "Exmos. Senhores Worten,",
        "Decreto-Lei n.º 84/2021",
        "Preço: 1 234,50 €",
        "Fatura n.º FT 2023/48213",
        "Não centrifuga e dá o erro E18.",
        long_date(date.today()),
    ]:
        assert expected in text


def test_pdf_appends_pdf_invoice(auth_client: TestClient, db_session: Session, named_user: User):
    purchase = make_purchase(db_session, named_user)
    auth_client.put(
        f"/purchases/{purchase.id}/invoice",
        files={"file": ("fatura.pdf", invoice_pdf(pages=2), "application/pdf")},
    )

    response = claim_pdf(auth_client, purchase.id)

    assert response.headers["x-invoice-included"] == "true"
    pages, text = pdf_text(response.content)
    assert pages == 3
    assert "FATURA FT 2023/48213 pagina 2" in text
    assert "Junto cópia da fatura de compra." in text


def test_pdf_appends_image_invoice_as_a_page(
    auth_client: TestClient, db_session: Session, named_user: User
):
    purchase = make_purchase(db_session, named_user)
    auth_client.put(
        f"/purchases/{purchase.id}/invoice",
        files={"file": ("foto.png", invoice_png(), "image/png")},
    )

    response = claim_pdf(auth_client, purchase.id)

    assert response.headers["x-invoice-included"] == "true"
    assert pdf_text(response.content)[0] == 2


def test_unreadable_invoice_still_returns_the_letter(
    auth_client: TestClient, db_session: Session, named_user: User
):
    purchase = make_purchase(db_session, named_user)
    auth_client.put(
        f"/purchases/{purchase.id}/invoice",
        files={"file": ("estragado.pdf", b"%PDF-1.4 isto nao e um pdf", "application/pdf")},
    )

    response = claim_pdf(auth_client, purchase.id)

    assert response.status_code == 200
    assert response.headers["x-invoice-included"] == "false"
    assert pdf_text(response.content)[0] == 1


def test_pdf_escapes_markup_in_description(
    auth_client: TestClient, db_session: Session, named_user: User
):
    purchase = make_purchase(db_session, named_user)

    response = auth_client.post(
        f"/purchases/{purchase.id}/claim.pdf",
        json={"description": "Erro <b>E18</b> & ruído <script>"},
    )

    assert response.status_code == 200
    assert "Erro <b>E18</b> & ruído <script>" in pdf_text(response.content)[1]


def test_pdf_requires_full_name(auth_client: TestClient, db_session: Session, user: User):
    purchase = make_purchase(db_session, user)

    assert claim_pdf(auth_client, purchase.id).status_code == 422


def test_pdf_of_other_users_purchase_is_404(auth_client: TestClient, db_session: Session):
    other = make_user(db_session, "rui@example.com")
    other.full_name = "Rui"
    theirs = make_purchase(db_session, other)

    assert claim_pdf(auth_client, theirs.id).status_code == 404
    assert claim_pdf(auth_client, theirs.id, headers=auth_headers(other)).status_code == 200
