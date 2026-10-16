"""Armazenamento das faturas no S3, com o moto (S3 simulado em memória, sem rede)."""

import pytest
from fastapi.testclient import TestClient

from app import storage
from app.config import Settings
from tests.conftest import S3_BUCKET as BUCKET
from tests.conftest import s3_objects as objects

PDF = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


def test_save_load_delete(s3, upload_dir):
    key = storage.save(PDF, "application/pdf")

    assert objects(s3) == [f"faturas/{key}"]
    head = s3.head_object(Bucket=BUCKET, Key=f"faturas/{key}")
    assert head["ContentType"] == "application/pdf"
    assert storage.load(key) == PDF
    assert not upload_dir.exists()  # nada em disco

    storage.delete(key)
    assert objects(s3) == []
    assert storage.load(key) is None
    storage.delete(key)  # apagar o que já não existe não falha


def test_rejects_keys_that_are_not_ours(s3):
    for key in ["../segredo.pdf", "faturas/x.pdf", "abc.exe", ""]:
        with pytest.raises(ValueError):
            storage.load(key)


def create_purchase(client: TestClient) -> int:
    payload = {"product_name": "TV", "store": "Fnac", "purchase_date": "2026-01-10", "price": "1"}
    return client.post("/purchases", json=payload).json()["id"]


def upload(client: TestClient, purchase_id: int, data: bytes = PDF):
    files = {"file": ("Fatura Worten.pdf", data, "application/pdf")}
    return client.put(f"/purchases/{purchase_id}/invoice", files=files)


def test_invoice_flow_with_s3(s3, auth_client: TestClient):
    purchase_id = create_purchase(auth_client)
    assert upload(auth_client, purchase_id).status_code == 200
    [first] = objects(s3)

    download = auth_client.get(f"/purchases/{purchase_id}/invoice")
    assert download.status_code == 200
    assert download.content == PDF
    assert download.headers["content-type"] == "application/pdf"
    assert download.headers["content-disposition"] == (
        "inline; filename*=utf-8''Fatura%20Worten.pdf"
    )

    # Substituir apaga o objeto antigo.
    assert upload(auth_client, purchase_id).status_code == 200
    [second] = objects(s3)
    assert second != first

    # A exportação e o PDF da reclamação também vão buscar a fatura ao S3.
    export = auth_client.get("/purchases/export")
    assert export.status_code == 200
    assert PDF in export.content

    assert auth_client.delete(f"/purchases/{purchase_id}").status_code == 204
    assert objects(s3) == []


def test_s3_backend_requires_bucket():
    with pytest.raises(ValueError, match="S3_BUCKET"):
        Settings(storage_backend="s3", s3_bucket=None)
