import csv
import io
import json
import zipfile
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import storage
from app.export import _slug
from app.models import Purchase, User
from tests.conftest import make_user

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def make_purchase(session: Session, user: User, **overrides) -> Purchase:
    data = {
        "user_id": user.id,
        "product_name": "Máquina de lavar Bosch",
        "store": "Worten",
        "purchase_date": date.today() - timedelta(days=30),
        "price": Decimal("1234.50"),
        "warranty_months": 36,
    } | overrides
    purchase = Purchase(**data)
    session.add(purchase)
    session.flush()
    session.refresh(purchase)
    return purchase


def attach_invoice(session: Session, purchase: Purchase, data: bytes, content_type: str) -> None:
    purchase.invoice_key = storage.save(data, content_type)
    purchase.invoice_filename = "fatura original.pdf"
    purchase.invoice_content_type = content_type
    purchase.invoice_size = len(data)
    session.flush()


def export(client: TestClient) -> zipfile.ZipFile:
    response = client.get("/purchases/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    return zipfile.ZipFile(io.BytesIO(response.content))


def read_csv(archive: zipfile.ZipFile) -> list[list[str]]:
    raw = archive.read("compras.csv")
    assert raw.startswith(b"\xef\xbb\xbf")  # BOM, para o Excel ler UTF-8
    return list(csv.reader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";"))


def test_export_without_purchases(auth_client: TestClient, user: User):
    response = auth_client.get("/purchases/export")

    assert response.status_code == 200
    disposition = response.headers["content-disposition"]
    assert disposition == f'attachment; filename="warrantly-{date.today().isoformat()}.zip"'
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert sorted(archive.namelist()) == ["compras.csv", "compras.json"]
    assert read_csv(archive) == [
        [
            "ID",
            "Produto",
            "Loja",
            "Categoria",
            "Data da compra",
            "Preço (€)",
            "Garantia (meses)",
            "Fim da garantia",
            "Estado",
            "N.º da fatura",
            "Email da loja",
            "NIF da loja",
            "Ficheiro da fatura",
        ]
    ]
    data = json.loads(archive.read("compras.json"))
    assert data["user"] == {"email": user.email, "full_name": None}
    assert data["purchases"] == []


def test_export_with_purchases_and_invoices(
    auth_client: TestClient, db_session: Session, user: User
):
    washer = make_purchase(
        db_session,
        user,
        category="Eletrodomésticos",
        invoice_number="FT 2026/1",
        store_email="loja@worten.pt",
        store_nif="503630330",
    )
    attach_invoice(db_session, washer, PDF, "application/pdf")
    old = make_purchase(
        db_session,
        user,
        product_name="Torradeira",
        store="Continente",
        purchase_date=date(2020, 1, 5),
        price=Decimal("19.99"),
    )
    photo = make_purchase(db_session, user, product_name='TV / Sala 55"', store="Fnac")
    attach_invoice(db_session, photo, PNG, "image/png")

    archive = export(auth_client)

    washer_file = f"faturas/{washer.id}-maquina-de-lavar-bosch.pdf"
    photo_file = f"faturas/{photo.id}-tv-sala-55.png"
    assert sorted(archive.namelist()) == sorted(
        ["compras.csv", "compras.json", washer_file, photo_file]
    )
    assert archive.read(washer_file) == PDF
    assert archive.read(photo_file) == PNG
    assert archive.getinfo(washer_file).compress_type == zipfile.ZIP_STORED

    rows = read_csv(archive)[1:]
    # Pela data da compra: a torradeira é a mais antiga.
    assert [row[0] for row in rows] == [str(old.id), str(washer.id), str(photo.id)]
    assert rows[0][1:9] == [
        "Torradeira",
        "Continente",
        "",
        "2020-01-05",
        "19,99",
        "36",
        "2023-01-05",
        "Expirada",
    ]
    assert rows[0][12] == ""
    assert rows[1][3] == "Eletrodomésticos"
    assert rows[1][5] == "1234,50"
    assert rows[1][8] == "Ativa"
    assert rows[1][9:] == ["FT 2026/1", "loja@worten.pt", "503630330", washer_file]

    data = json.loads(archive.read("compras.json"))
    by_id = {p["id"]: p for p in data["purchases"]}
    assert by_id[washer.id]["price"] == "1234.50"
    assert by_id[washer.id]["store_nif"] == "503630330"
    assert by_id[washer.id]["status"] == "active"
    assert by_id[washer.id]["invoice_file"] == washer_file
    assert by_id[washer.id]["invoice_original_filename"] == "fatura original.pdf"
    assert by_id[old.id]["invoice_file"] is None
    assert by_id[old.id]["warranty_end"] == "2023-01-05"


def test_export_skips_invoice_missing_on_disk(
    auth_client: TestClient, db_session: Session, user: User, upload_dir: Path
):
    purchase = make_purchase(db_session, user)
    attach_invoice(db_session, purchase, PDF, "application/pdf")
    (upload_dir / purchase.invoice_key).unlink()

    archive = export(auth_client)

    assert sorted(archive.namelist()) == ["compras.csv", "compras.json"]
    assert read_csv(archive)[1][12] == ""
    assert json.loads(archive.read("compras.json"))["purchases"][0]["invoice_file"] is None


def test_export_neutralizes_spreadsheet_formulas(
    auth_client: TestClient, db_session: Session, user: User
):
    make_purchase(db_session, user, product_name='=HYPERLINK("http://x")', store="-Loja")

    rows = read_csv(export(auth_client))

    assert rows[1][1] == '\'=HYPERLINK("http://x")'
    assert rows[1][2] == "'-Loja"


def test_export_only_includes_own_purchases(
    auth_client: TestClient, db_session: Session, user: User
):
    other = make_user(db_session, "rui@example.com")
    theirs = make_purchase(db_session, other, product_name="Do Rui")
    attach_invoice(db_session, theirs, PDF, "application/pdf")
    make_purchase(db_session, user)

    archive = export(auth_client)

    assert not any(name.startswith("faturas/") for name in archive.namelist())
    assert [row[1] for row in read_csv(archive)[1:]] == ["Máquina de lavar Bosch"]


def test_export_requires_authentication(client: TestClient):
    assert client.get("/purchases/export").status_code == 401


def test_slug():
    assert _slug("Máquina de lavar Bosch") == "maquina-de-lavar-bosch"
    assert _slug("../../etc/passwd") == "etc-passwd"
    assert _slug("日本語") == "compra"
    assert len(_slug("a" * 100)) == 40
