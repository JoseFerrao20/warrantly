"""Upload direto browser → S3 (POST pré-assinado), com o S3 simulado pelo moto."""

import base64
import io
import json

import requests
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from tests.conftest import auth_headers, make_user
from tests.conftest import s3_objects as objects

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


def ticket(client: TestClient) -> dict:
    response = client.post("/purchases/uploads")
    assert response.status_code == 200
    return response.json()


def send_to_s3(t: dict, data: bytes) -> None:
    """O que o browser faz: POST dos campos assinados e do ficheiro (por último) para o S3."""
    response = requests.post(t["url"], data=t["fields"], files={"file": ("f", data)})
    assert response.status_code in (200, 204)


def create_purchase(client: TestClient) -> int:
    payload = {"product_name": "TV", "store": "Fnac", "purchase_date": "2026-01-10", "price": "1"}
    return client.post("/purchases", json=payload).json()["id"]


def test_without_s3_there_is_no_direct_upload(auth_client: TestClient):
    assert ticket(auth_client) == {
        "direct": False,
        "max_bytes": settings.max_invoice_bytes,
        "token": None,
        "url": None,
        "fields": None,
    }


def test_ticket_signs_the_size_limit_and_the_user_folder(s3, auth_client: TestClient, user):
    t = ticket(auth_client)

    assert t["direct"] is True
    # Endereço regional (o global pode redirecionar, e o browser não segue o redirecionamento).
    assert t["url"] == "https://warrantly-faturas-teste.s3.eu-west-1.amazonaws.com/"
    assert t["fields"]["key"] == f"uploads/{user.id}/{t['token']}"
    policy = json.loads(base64.b64decode(t["fields"]["policy"]))
    assert ["content-length-range", 1, settings.max_invoice_bytes] in policy["conditions"]


def test_upload_scan_and_attach(s3, auth_client: TestClient):
    t = ticket(auth_client)
    send_to_s3(t, PDF)

    scan = auth_client.post(f"/purchases/uploads/{t['token']}/scan")
    assert scan.status_code == 200
    assert scan.json()["text_found"] is False  # PDF de teste sem texto

    purchase_id = create_purchase(auth_client)
    response = auth_client.put(
        f"/purchases/{purchase_id}/invoice/upload",
        json={"token": t["token"], "filename": "Fatura Worten.pdf"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["invoice_filename"] == "Fatura Worten.pdf"
    assert body["invoice_content_type"] == "application/pdf"
    # O temporário saiu de uploads/ e a fatura ficou em faturas/.
    [stored] = objects(s3)
    assert stored.startswith("faturas/")
    assert auth_client.get(f"/purchases/{purchase_id}/invoice").content == PDF


def test_heic_is_converted_when_attached(s3, auth_client: TestClient):
    image = Image.new("RGB", (8, 8), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="HEIF")
    t = ticket(auth_client)
    send_to_s3(t, buffer.getvalue())

    response = auth_client.put(
        f"/purchases/{create_purchase(auth_client)}/invoice/upload",
        json={"token": t["token"], "filename": "IMG_0001.HEIC"},
    )

    assert response.status_code == 200
    assert response.json()["invoice_content_type"] == "image/jpeg"
    assert response.json()["invoice_filename"] == "IMG_0001.jpg"


def test_rejects_wrong_type_and_removes_the_upload(s3, auth_client: TestClient):
    t = ticket(auth_client)
    send_to_s3(t, b"<html>nada</html>")

    response = auth_client.put(
        f"/purchases/{create_purchase(auth_client)}/invoice/upload",
        json={"token": t["token"], "filename": "x.html"},
    )

    assert response.status_code == 415
    assert objects(s3) == []


def test_rejects_files_over_the_limit(s3, auth_client: TestClient, monkeypatch):
    t = ticket(auth_client)
    monkeypatch.setattr(settings, "max_invoice_bytes", 10)
    send_to_s3(t, PDF)  # o moto não aplica a condição do tamanho; a API confirma-o

    response = auth_client.post(f"/purchases/uploads/{t['token']}/scan")

    assert response.status_code == 413
    assert objects(s3) == []


def test_other_users_cannot_use_my_upload(s3, auth_client: TestClient, client, db_session):
    t = ticket(auth_client)
    send_to_s3(t, PDF)
    other = make_user(db_session, "rui@example.com")

    response = client.post(f"/purchases/uploads/{t['token']}/scan", headers=auth_headers(other))

    assert response.status_code == 404  # procura em uploads/<id do Rui>/, onde não existe


def test_unknown_or_invalid_token(s3, auth_client: TestClient):
    assert auth_client.post(f"/purchases/uploads/{'0' * 32}/scan").status_code == 404
    assert auth_client.post("/purchases/uploads/..%2Fsegredo/scan").status_code == 404
    response = auth_client.put(
        f"/purchases/{create_purchase(auth_client)}/invoice/upload",
        json={"token": "../x", "filename": "a.pdf"},
    )
    assert response.status_code == 422


def test_requires_authentication(client: TestClient):
    assert client.post("/purchases/uploads").status_code == 401
