from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.schemas import WarrantyStatus, warranty_status
from tests.conftest import auth_headers, make_user

TODAY = date.today()


def purchase_payload(**overrides) -> dict:
    data = {
        "product_name": "Máquina de lavar",
        "store": "Worten",
        "category": "Eletrodomésticos",
        "purchase_date": "2026-10-14",
        "price": "499.99",
    }
    return data | overrides


def create(client: TestClient, **overrides) -> dict:
    response = client.post("/purchases", json=purchase_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def bought_days_ago(days: int, warranty_months: int) -> dict:
    return {
        "purchase_date": (TODAY - timedelta(days=days)).isoformat(),
        "warranty_months": warranty_months,
    }


@pytest.mark.parametrize(
    ("warranty_end", "expected"),
    [
        (date(2026, 10, 13), WarrantyStatus.EXPIRED),
        (date(2026, 10, 14), WarrantyStatus.EXPIRING),
        (date(2026, 12, 13), WarrantyStatus.EXPIRING),  # faltam 60 dias
        (date(2026, 12, 14), WarrantyStatus.ACTIVE),
    ],
)
def test_warranty_status_boundaries(warranty_end: date, expected: WarrantyStatus):
    assert warranty_status(warranty_end, today=date(2026, 10, 14)) == expected


def test_create_purchase_returns_computed_fields(auth_client: TestClient):
    body = create(auth_client)

    assert body["id"] > 0
    assert body["warranty_months"] == 36
    assert body["warranty_end"] == "2029-10-14"
    assert body["price"] == "499.99"
    assert body["status"] in {"active", "expiring", "expired"}


@pytest.mark.parametrize(
    "overrides",
    [
        {"price": "-1"},
        {"price": "1.999"},
        {"warranty_months": 0},
        {"product_name": ""},
        {"store": "x" * 201},
        {"purchase_date": "não é data"},
    ],
)
def test_create_purchase_rejects_invalid_data(auth_client: TestClient, overrides: dict):
    response = auth_client.post("/purchases", json=purchase_payload(**overrides))

    assert response.status_code == 422


def test_get_purchase(auth_client: TestClient):
    created = create(auth_client)

    response = auth_client.get(f"/purchases/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_missing_purchase_returns_404(auth_client: TestClient):
    assert auth_client.get("/purchases/999999").status_code == 404
    assert auth_client.patch("/purchases/999999", json={"store": "Fnac"}).status_code == 404
    assert auth_client.delete("/purchases/999999").status_code == 404


def test_list_is_sorted_by_warranty_end(auth_client: TestClient):
    later = create(auth_client, product_name="Portátil", purchase_date="2026-05-01")
    sooner = create(auth_client, product_name="Telemóvel", purchase_date="2025-01-15")

    ids = [p["id"] for p in auth_client.get("/purchases").json()]

    assert ids.index(sooner["id"]) < ids.index(later["id"])


def test_list_filters_by_store_and_category(auth_client: TestClient):
    worten = create(auth_client, store="Worten", category="Eletrodomésticos")
    fnac = create(auth_client, store="Fnac", category="Informática")

    by_store = [p["id"] for p in auth_client.get("/purchases", params={"store": "Fnac"}).json()]
    by_category = [
        p["id"]
        for p in auth_client.get("/purchases", params={"category": "Eletrodomésticos"}).json()
    ]

    assert fnac["id"] in by_store and worten["id"] not in by_store
    assert worten["id"] in by_category and fnac["id"] not in by_category


def test_list_filters_by_status(auth_client: TestClient):
    expired = create(auth_client, **bought_days_ago(60, 1))  # acabou há ~1 mês
    expiring = create(auth_client, **bought_days_ago(20, 1))  # acaba daqui a ~10 dias
    active = create(auth_client, **bought_days_ago(30, 12))  # acaba daqui a ~11 meses

    def ids_for(status: str) -> set[int]:
        return {p["id"] for p in auth_client.get("/purchases", params={"status": status}).json()}

    assert expired["status"] == "expired" and expired["id"] in ids_for("expired")
    assert expiring["status"] == "expiring" and expiring["id"] in ids_for("expiring")
    assert active["status"] == "active" and active["id"] in ids_for("active")
    assert expired["id"] not in ids_for("active") | ids_for("expiring")


def test_list_rejects_unknown_status(auth_client: TestClient):
    assert auth_client.get("/purchases", params={"status": "whatever"}).status_code == 422


def test_patch_updates_only_sent_fields_and_recomputes_end(auth_client: TestClient):
    created = create(auth_client)

    response = auth_client.patch(f"/purchases/{created['id']}", json={"warranty_months": 24})

    assert response.status_code == 200
    body = response.json()
    assert body["warranty_end"] == "2028-10-14"
    assert body["store"] == created["store"]
    assert body["product_name"] == created["product_name"]


def test_patch_can_clear_category_but_not_required_fields(auth_client: TestClient):
    created = create(auth_client)

    cleared = auth_client.patch(f"/purchases/{created['id']}", json={"category": None})
    rejected = auth_client.patch(f"/purchases/{created['id']}", json={"product_name": None})

    assert cleared.status_code == 200 and cleared.json()["category"] is None
    assert rejected.status_code == 422


def test_delete_purchase(auth_client: TestClient):
    created = create(auth_client)

    response = auth_client.delete(f"/purchases/{created['id']}")

    assert response.status_code == 204
    assert auth_client.get(f"/purchases/{created['id']}").status_code == 404


def test_purchases_require_authentication(client: TestClient):
    assert client.get("/purchases").status_code == 401
    assert client.post("/purchases", json=purchase_payload()).status_code == 401


def test_users_only_see_their_own_purchases(auth_client: TestClient, db_session: Session):
    mine = create(auth_client, product_name="Minha")
    other_headers = auth_headers(make_user(db_session, "rui@example.com"))
    theirs = auth_client.post(
        "/purchases", json=purchase_payload(product_name="Do Rui"), headers=other_headers
    ).json()

    my_ids = [p["id"] for p in auth_client.get("/purchases").json()]

    assert my_ids == [mine["id"]]
    assert auth_client.get(f"/purchases/{theirs['id']}").status_code == 404
    assert auth_client.patch(f"/purchases/{theirs['id']}", json={"store": "X"}).status_code == 404
    assert auth_client.delete(f"/purchases/{theirs['id']}").status_code == 404
    assert auth_client.get(f"/purchases/{theirs['id']}", headers=other_headers).status_code == 200


def test_store_email_is_saved_validated_and_clearable(auth_client: TestClient):
    created = create(auth_client, store_email="Apoio@Worten.pt")
    assert created["store_email"] == "Apoio@worten.pt"  # o domínio é normalizado

    invalid = auth_client.patch(f"/purchases/{created['id']}", json={"store_email": "nao-e-email"})
    assert invalid.status_code == 422

    cleared = auth_client.patch(f"/purchases/{created['id']}", json={"store_email": None})
    assert cleared.status_code == 200
    assert cleared.json()["store_email"] is None


def test_store_nif_is_normalized_validated_and_clearable(auth_client: TestClient):
    created = create(auth_client, store_nif="PT 503 630 330")
    assert created["store_nif"] == "503630330"

    invalid = auth_client.patch(f"/purchases/{created['id']}", json={"store_nif": "503630331"})
    assert invalid.status_code == 422
    assert invalid.json()["detail"][0]["msg"] == "O NIF da loja não é válido"

    cleared = auth_client.patch(f"/purchases/{created['id']}", json={"store_nif": None})
    assert cleared.status_code == 200
    assert cleared.json()["store_nif"] is None
