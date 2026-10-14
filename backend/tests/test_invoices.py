from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import storage
from app.config import settings
from tests.conftest import auth_headers, make_user

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def create_purchase(client: TestClient) -> dict:
    payload = {"product_name": "TV", "store": "Fnac", "purchase_date": "2026-01-10", "price": "399"}
    response = client.post("/purchases", json=payload)
    assert response.status_code == 201
    return response.json()


def upload(client: TestClient, purchase_id: int, data: bytes, filename: str = "fatura.pdf", **kw):
    files = {"file": (filename, data, "application/octet-stream")}
    return client.put(f"/purchases/{purchase_id}/invoice", files=files, **kw)


def stored_files(upload_dir: Path) -> list[Path]:
    return sorted(upload_dir.glob("*")) if upload_dir.exists() else []


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (PDF, "application/pdf"),
        (b"\xff\xd8\xff\xe0" + b"\x00" * 16, "image/jpeg"),
        (PNG, "image/png"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
        (b"<html>nada</html>", None),
        (b"", None),
    ],
)
def test_detect_content_type(data: bytes, expected: str | None):
    assert storage.detect_content_type(data) == expected


def test_upload_and_download_invoice(auth_client: TestClient, upload_dir: Path):
    purchase = create_purchase(auth_client)

    response = upload(auth_client, purchase["id"], PDF, filename="Fatura Worten.pdf")

    assert response.status_code == 200
    body = response.json()
    assert body["invoice_filename"] == "Fatura Worten.pdf"
    assert body["invoice_content_type"] == "application/pdf"
    assert body["invoice_size"] == len(PDF)
    assert len(stored_files(upload_dir)) == 1

    download = auth_client.get(f"/purchases/{purchase['id']}/invoice")

    assert download.status_code == 200
    assert download.content == PDF
    assert download.headers["content-type"] == "application/pdf"
    assert download.headers["content-disposition"].startswith("inline;")
    assert download.headers["x-content-type-options"] == "nosniff"


def test_type_comes_from_file_content_not_from_name(auth_client: TestClient, upload_dir: Path):
    purchase = create_purchase(auth_client)

    response = upload(auth_client, purchase["id"], PNG, filename="foto.pdf")

    assert response.status_code == 200
    assert response.json()["invoice_content_type"] == "image/png"
    assert stored_files(upload_dir)[0].suffix == ".png"


def test_rejects_unsupported_file(auth_client: TestClient, upload_dir: Path):
    purchase = create_purchase(auth_client)

    response = upload(auth_client, purchase["id"], b"<script>alert(1)</script>", "x.pdf")

    assert response.status_code == 415
    assert stored_files(upload_dir) == []


def test_rejects_file_too_large(
    auth_client: TestClient, upload_dir: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "max_invoice_bytes", len(PDF) - 1)
    purchase = create_purchase(auth_client)

    response = upload(auth_client, purchase["id"], PDF)

    assert response.status_code == 413
    assert stored_files(upload_dir) == []


def test_filename_cannot_escape_upload_dir(auth_client: TestClient, upload_dir: Path):
    purchase = create_purchase(auth_client)

    response = upload(auth_client, purchase["id"], PDF, filename="../../etc/passwd.pdf")

    assert response.json()["invoice_filename"] == "passwd.pdf"
    [stored] = stored_files(upload_dir)
    assert stored.parent == upload_dir
    assert "passwd" not in stored.name


def test_replacing_invoice_removes_old_file(auth_client: TestClient, upload_dir: Path):
    purchase = create_purchase(auth_client)
    upload(auth_client, purchase["id"], PDF)

    upload(auth_client, purchase["id"], PNG, filename="nova.png")

    [stored] = stored_files(upload_dir)
    assert stored.read_bytes() == PNG
    assert auth_client.get(f"/purchases/{purchase['id']}/invoice").content == PNG


def test_delete_invoice(auth_client: TestClient, upload_dir: Path):
    purchase = create_purchase(auth_client)
    upload(auth_client, purchase["id"], PDF)

    response = auth_client.delete(f"/purchases/{purchase['id']}/invoice")

    assert response.status_code == 204
    assert stored_files(upload_dir) == []
    assert auth_client.get(f"/purchases/{purchase['id']}/invoice").status_code == 404
    assert auth_client.get(f"/purchases/{purchase['id']}").json()["invoice_filename"] is None


def test_purchase_without_invoice_returns_404(auth_client: TestClient):
    purchase = create_purchase(auth_client)

    assert auth_client.get(f"/purchases/{purchase['id']}/invoice").status_code == 404
    assert auth_client.delete(f"/purchases/{purchase['id']}/invoice").status_code == 404


def test_deleting_purchase_removes_invoice_file(auth_client: TestClient, upload_dir: Path):
    purchase = create_purchase(auth_client)
    upload(auth_client, purchase["id"], PDF)

    auth_client.delete(f"/purchases/{purchase['id']}")

    assert stored_files(upload_dir) == []


def test_invoices_of_other_users_are_not_accessible(
    auth_client: TestClient, db_session: Session, upload_dir: Path
):
    other_headers = auth_headers(make_user(db_session, "rui@example.com"))
    theirs = auth_client.post(
        "/purchases",
        json={"product_name": "X", "store": "Y", "purchase_date": "2026-01-01", "price": "1"},
        headers=other_headers,
    ).json()
    upload(auth_client, theirs["id"], PDF, headers=other_headers)

    assert upload(auth_client, theirs["id"], PNG).status_code == 404
    assert auth_client.get(f"/purchases/{theirs['id']}/invoice").status_code == 404
    assert auth_client.delete(f"/purchases/{theirs['id']}/invoice").status_code == 404
    assert stored_files(upload_dir)[0].read_bytes() == PDF


def test_invoice_endpoints_require_authentication(client: TestClient):
    assert client.get("/purchases/1/invoice").status_code == 401
    assert upload(client, 1, PDF).status_code == 401
