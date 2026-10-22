import io
from datetime import date
from decimal import Decimal

import pytest
import segno
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.invoice_scan import ocr_available, parse_invoice_text, scan_invoice

TODAY = date(2026, 10, 15)

WORTEN = """WORTEN EQUIPAMENTOS PARA O LAR, S.A.
Rua X, 1000-100 Lisboa
NIF 503630330
apoio.cliente@worten.pt
FATURA-RECIBO FR 0123/456789
Data de emissão: 03-11-2023
Qtd Descrição Preço
1 x Máquina de Lavar Roupa Bosch WAN28280ES 8kg 429,00
Subtotal 348,78
IVA 23% 80,22
TOTAL A PAGAR 429,00 €
Multibanco 429,00
"""


def test_parses_a_typical_invoice():
    result = parse_invoice_text(WORTEN, TODAY)

    assert result.store == "Worten"
    assert result.product_name == "Máquina de Lavar Roupa Bosch WAN28280ES 8kg"
    assert result.purchase_date == date(2023, 11, 3)
    assert result.price == Decimal("429.00")
    assert result.invoice_number == "FR 0123/456789"
    assert result.store_email == "apoio.cliente@worten.pt"


def test_unknown_store_from_company_suffix_and_thousands_separator():
    text = """Electro Silva & Filhos, Lda.
Fatura FT A2024/77
Data: 2024-02-14
Frigorífico Combinado XPTO .......... 1.234,50 €
Total (EUR) 1.234,50
"""
    result = parse_invoice_text(text, TODAY)

    assert result.store == "Electro Silva & Filhos"
    assert result.invoice_number == "FT A2024/77"
    assert result.purchase_date == date(2024, 2, 14)
    assert result.price == Decimal("1234.50")
    assert result.product_name == "Frigorífico Combinado XPTO"


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        ("Data: 3/11/2023", date(2023, 11, 3)),
        ("Data da fatura 03.11.23", date(2023, 11, 3)),
        ("Lisboa, 14 de fevereiro de 2026", date(2026, 2, 14)),
        ("Lisboa, 3 de março de 2025", date(2025, 3, 3)),
        ("Data: 2027-01-01", None),  # no futuro: não é a data da compra
        ("Data: 31-02-2024", None),  # não existe
    ],
)
def test_dates(line: str, expected: date | None):
    assert parse_invoice_text(line, TODAY).purchase_date == expected


def test_labelled_date_wins_over_other_dates():
    text = "Válido até 31-12-2025\nData de emissão: 10-01-2025\n"
    assert parse_invoice_text(text, TODAY).purchase_date == date(2025, 1, 10)


def test_total_ignores_subtotal_and_vat():
    text = "Subtotal 100,00\nTotal IVA 23,00\nDesconto 5,00\nTotal 118,00 €\n"
    assert parse_invoice_text(text, TODAY).price == Decimal("118.00")


def test_euro_sign_misread_by_ocr():
    assert parse_invoice_text("TOTAL A PAGAR 429,008", TODAY).price == Decimal("429.00")


def test_nothing_found_in_unrelated_text():
    result = parse_invoice_text("Olá mundo\nisto não é uma fatura\n", TODAY)

    assert result.store is None
    assert result.product_name is None
    assert result.purchase_date is None
    assert result.price is None
    assert result.invoice_number is None
    assert result.store_email is None


def make_pdf(lines: list[str], qr: str | None = None) -> bytes:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    if qr is not None:  # como os programas de faturação: o QR como imagem no fim da página
        pdf.drawImage(ImageReader(qr_image(qr)), 60, 80, width=120, height=120)
    y = 800
    for line in lines:
        pdf.drawString(60, y, line)
        y -= 20
    pdf.save()
    return buffer.getvalue()


def scan(client: TestClient, data: bytes, filename: str):
    return client.post(
        "/purchases/scan-invoice", files={"file": (filename, data, "application/octet-stream")}
    )


def test_scan_pdf_with_text(auth_client: TestClient):
    pdf = make_pdf(WORTEN.splitlines())

    response = scan(auth_client, pdf, "fatura.pdf")

    assert response.status_code == 200
    body = response.json()
    assert body["text_found"] is True
    assert body["store"] == "Worten"
    assert body["purchase_date"] == "2023-11-03"
    assert body["price"] == "429.00"
    assert body["invoice_number"] == "FR 0123/456789"


@pytest.mark.skipif(not ocr_available(), reason="Tesseract não instalado")
def test_scan_photo_with_ocr(auth_client: TestClient):
    image = Image.new("RGB", (1000, 360), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=30)
    lines = ["WORTEN", "Data de emissão: 03-11-2023", "TOTAL A PAGAR 429,00 EUR"]
    for i, line in enumerate(lines):
        draw.text((40, 40 + i * 70), line, fill="black", font=font)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    response = scan(auth_client, buffer.getvalue(), "foto.png")

    assert response.status_code == 200
    body = response.json()
    assert body["ocr_available"] is True
    assert body["store"] == "Worten"
    assert body["purchase_date"] == "2023-11-03"
    assert body["price"] == "429.00"


def test_scan_without_tesseract_returns_no_suggestions(auth_client: TestClient, monkeypatch):
    monkeypatch.setattr("app.invoice_scan.shutil.which", lambda _: None)
    buffer = io.BytesIO()
    Image.new("RGB", (100, 100), "white").save(buffer, format="PNG")

    body = scan(auth_client, buffer.getvalue(), "foto.png").json()

    assert body["text_found"] is False
    assert body["ocr_available"] is False
    assert body["price"] is None


def test_scan_rejects_other_file_types(auth_client: TestClient):
    response = scan(auth_client, b"<html>nada</html>", "x.html")
    assert response.status_code == 415


def test_scan_requires_authentication(client: TestClient):
    assert scan(client, make_pdf(["x"]), "f.pdf").status_code == 401


# --- Código QR da AT ---------------------------------------------------------------------------

# O QR da mesma fatura da Worten, mas com a data e o total certos (o texto acima tem outros,
# para se ver qual ganha).
WORTEN_QR = (
    "A:503630330*B:999999990*C:PT*D:FR*E:N*F:20231105*G:FR 0123/456790*H:JJ3XY2KD-456790"
    "*I1:PT*I7:398.37*I8:91.63*N:91.63*O:490.00*Q:Ab1z*R:1234"
)


def qr_image(text: str) -> Image.Image:
    buffer = io.BytesIO()
    segno.make(text, error="m", micro=False).save(buffer, kind="png", scale=4, border=4)
    return Image.open(buffer).convert("RGB")


def png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_qr_wins_over_text_for_date_total_and_number():
    result = scan_invoice(make_pdf(WORTEN.splitlines(), qr=WORTEN_QR), "application/pdf", TODAY)

    assert result.from_qr is True
    assert result.purchase_date == date(2023, 11, 5)
    assert result.price == Decimal("490.00")
    assert result.invoice_number == "FR 0123/456790"
    # O QR não tem a loja, o artigo nem o email: continuam a vir do texto.
    assert result.store == "Worten"
    assert result.product_name == "Máquina de Lavar Roupa Bosch WAN28280ES 8kg"
    assert result.store_email == "apoio.cliente@worten.pt"


def test_qr_drawn_in_the_pdf():
    # Os programas de faturação desenham o QR (vetorial), não o põem como imagem.
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    for i, line in enumerate(WORTEN.splitlines()):
        pdf.drawString(60, 800 - i * 20, line)
    widget = QrCodeWidget(WORTEN_QR, barLevel="M")
    x0, y0, x1, y1 = widget.getBounds()
    size = 85  # pontos: 30 mm, o mínimo da especificação da AT
    drawing = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, pdf, 60, 60)
    pdf.save()

    result = scan_invoice(buffer.getvalue(), "application/pdf", TODAY)

    assert result.from_qr is True
    assert result.price == Decimal("490.00")
    assert result.store == "Worten"


def test_photo_with_only_the_qr_works_without_tesseract(auth_client: TestClient, monkeypatch):
    monkeypatch.setattr("app.invoice_scan.shutil.which", lambda _: None)
    page = Image.new("RGB", (1200, 1600), "white")
    page.paste(qr_image(WORTEN_QR), (400, 1000))

    body = scan(auth_client, png(page), "talao.png").json()

    assert body["text_found"] is True
    assert body["ocr_available"] is False
    assert body["purchase_date"] == "2023-11-05"
    assert body["price"] == "490.00"
    assert body["invoice_number"] == "FR 0123/456790"
    assert body["store"] is None


@pytest.mark.parametrize(
    "qr",
    [
        WORTEN_QR.replace("D:FR", "D:NC"),  # nota de crédito: não é a compra
        WORTEN_QR.replace("E:N", "E:A"),  # fatura anulada
        "https://www.worten.pt/promocoes",  # QR de outra coisa
    ],
)
def test_other_qr_codes_are_ignored(qr: str):
    result = scan_invoice(make_pdf(WORTEN.splitlines(), qr=qr), "application/pdf", TODAY)

    assert result.from_qr is False
    assert result.purchase_date == date(2023, 11, 3)
    assert result.price == Decimal("429.00")


def test_future_date_in_qr_is_not_suggested():
    qr = WORTEN_QR.replace("F:20231105", "F:20271105")

    result = scan_invoice(png(qr_image(qr)), "image/png", TODAY)

    assert result.from_qr is True
    assert result.purchase_date is None
    assert result.price == Decimal("490.00")
