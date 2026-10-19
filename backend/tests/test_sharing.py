from email import message_from_bytes, policy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import sharing
from app.config import settings
from app.models import User
from tests.conftest import auth_headers, make_user
from tests.test_purchases_api import purchase_payload

PDF = b"%PDF-1.7\n%fatura\n"


@pytest.fixture
def mail_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(settings, "mail_backend", "file")
    monkeypatch.setattr(settings, "mail_dir", tmp_path / "emails")
    return tmp_path / "emails"


@pytest.fixture
def rui(db_session: Session) -> User:
    return make_user(db_session, "rui@example.com")


def invite(client: TestClient, owner: User, email: str) -> dict:
    response = client.post("/sharing", json={"email": email}, headers=auth_headers(owner))
    assert response.status_code == 201, response.text
    return response.json()


def share_with(client: TestClient, owner: User, member: User) -> dict:
    share = invite(client, owner, member.email)
    response = client.post(f"/sharing/{share['id']}/accept", headers=auth_headers(member))
    assert response.status_code == 200, response.text
    return share


def create_purchase(client: TestClient, owner: User, **overrides) -> dict:
    response = client.post(
        "/purchases", json=purchase_payload(**overrides), headers=auth_headers(owner)
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_invite_sends_an_email_and_shows_on_both_sides(
    client: TestClient, user: User, rui: User, mail_dir: Path
):
    user.full_name = "Ana Silva"
    share = invite(client, user, "Rui@Example.com")

    assert share["email"] == "rui@example.com"
    assert share["accepted"] is False
    [eml] = list(mail_dir.iterdir())
    email = message_from_bytes(eml.read_bytes(), policy=policy.default)
    assert email["To"] == "rui@example.com"
    assert email["Subject"] == "Ana Silva partilhou contigo as garantias no Warrantly"
    assert "/conta" in email.get_content()

    mine = client.get("/sharing", headers=auth_headers(user)).json()
    assert [m["email"] for m in mine["members"]] == ["rui@example.com"]
    assert mine["shared_with_me"] == []
    received = client.get("/sharing", headers=auth_headers(rui)).json()
    assert received["members"] == []
    [archive] = received["shared_with_me"]
    assert archive == {
        "id": share["id"],
        "owner_name": "Ana Silva",
        "owner_email": "ana@example.com",
        "accepted": False,
        "created_at": share["created_at"],
    }


def test_invite_for_an_email_without_account_looks_the_same(
    client: TestClient, db_session: Session, user: User, mail_dir: Path
):
    """Não se fica a saber se a pessoa já tem conta: o convite e o email são iguais."""
    share = invite(client, user, "ninguem@example.com")
    assert share["accepted"] is False
    assert len(list(mail_dir.iterdir())) == 1
    # Quem cria a conta com esse email encontra o convite.
    newcomer = make_user(db_session, "ninguem@example.com")
    received = client.get("/sharing", headers=auth_headers(newcomer)).json()
    assert [a["id"] for a in received["shared_with_me"]] == [share["id"]]


def test_invite_errors(client: TestClient, user: User, rui: User, monkeypatch):
    headers = auth_headers(user)
    own = client.post("/sharing", json={"email": "ANA@example.com"}, headers=headers)
    assert own.status_code == 422
    assert own.json()["detail"] == "Não podes partilhar o arquivo contigo"

    invite(client, user, rui.email)
    again = client.post("/sharing", json={"email": rui.email}, headers=headers)
    assert again.status_code == 409

    monkeypatch.setattr(sharing, "MAX_SHARES", 1)
    full = client.post("/sharing", json={"email": "outra@example.com"}, headers=headers)
    assert full.status_code == 422
    assert full.json()["detail"] == "Só podes partilhar o arquivo com 1 pessoas"


def test_member_sees_edits_and_claims_but_cannot_delete(client: TestClient, user: User, rui: User):
    user.full_name = "Ana Silva"
    rui.full_name = "Rui Silva"
    purchase = create_purchase(client, user, product_name="Frigorífico")
    put = client.put(
        f"/purchases/{purchase['id']}/invoice",
        files={"file": ("fatura.pdf", PDF, "application/pdf")},
        headers=auth_headers(user),
    )
    assert put.status_code == 200
    own = create_purchase(client, rui, product_name="Portátil")
    headers = auth_headers(rui)

    # Antes de aceitar, a compra da Ana não existe para o Rui.
    share = invite(client, user, rui.email)
    assert client.get(f"/purchases/{purchase['id']}", headers=headers).status_code == 404
    assert [p["id"] for p in client.get("/purchases", headers=headers).json()] == [own["id"]]

    client.post(f"/sharing/{share['id']}/accept", headers=headers)
    listed = client.get("/purchases", headers=headers).json()
    assert {p["id"]: p["owner_name"] for p in listed} == {
        purchase["id"]: "Ana Silva",
        own["id"]: "Rui Silva",
    }
    shared = client.get(f"/purchases/{purchase['id']}", headers=headers).json()
    assert shared["user_id"] == user.id

    edit = client.patch(
        f"/purchases/{purchase['id']}", json={"store": "Radio Popular"}, headers=headers
    )
    assert edit.status_code == 200
    assert edit.json()["store"] == "Radio Popular"
    invoice = client.get(f"/purchases/{purchase['id']}/invoice", headers=headers)
    assert invoice.content == PDF
    claim = client.post(
        f"/purchases/{purchase['id']}/claim", json={"description": "Não arrefece."}, headers=headers
    )
    assert claim.status_code == 200
    assert "Rui Silva" in claim.json()["body"]  # assina quem reclama

    forbidden = [
        client.delete(f"/purchases/{purchase['id']}", headers=headers),
        client.delete(f"/purchases/{purchase['id']}/invoice", headers=headers),
        client.put(
            f"/purchases/{purchase['id']}/invoice",
            files={"file": ("outra.pdf", PDF, "application/pdf")},
            headers=headers,
        ),
    ]
    assert [r.status_code for r in forbidden] == [403, 403, 403]
    assert "só quem a registou" in forbidden[0].json()["detail"]
    # A exportação continua a ser só das compras do próprio.
    assert (
        client.get(f"/purchases/{purchase['id']}", headers=auth_headers(user)).json()[
            "invoice_filename"
        ]
        == "fatura.pdf"
    )


def test_sharing_is_one_way(client: TestClient, user: User, rui: User):
    """Partilhar o meu arquivo não me dá acesso ao da outra pessoa."""
    share_with(client, user, rui)
    rui_purchase = create_purchase(client, rui)
    response = client.get(f"/purchases/{rui_purchase['id']}", headers=auth_headers(user))
    assert response.status_code == 404
    assert client.get("/purchases", headers=auth_headers(user)).json() == []


def test_only_the_invited_person_accepts(client: TestClient, db_session: Session, user: User):
    share = invite(client, user, "rui@example.com")
    other = make_user(db_session, "outro@example.com")
    for who in (user, other):
        response = client.post(f"/sharing/{share['id']}/accept", headers=auth_headers(who))
        assert response.status_code == 404
    assert client.delete(f"/sharing/{share['id']}", headers=auth_headers(other)).status_code == 404


@pytest.mark.parametrize("who", ["owner", "member"])
def test_owner_or_member_ends_the_share(client: TestClient, user: User, rui: User, who: str):
    share = share_with(client, user, rui)
    purchase = create_purchase(client, user)

    by = user if who == "owner" else rui
    assert client.delete(f"/sharing/{share['id']}", headers=auth_headers(by)).status_code == 204

    response = client.get(f"/purchases/{purchase['id']}", headers=auth_headers(rui))
    assert response.status_code == 404
    assert client.get("/sharing", headers=auth_headers(rui)).json()["shared_with_me"] == []


def test_deleting_the_owner_account_ends_the_share(
    client: TestClient, db_session: Session, user: User, rui: User
):
    share_with(client, user, rui)
    db_session.delete(user)
    db_session.flush()
    assert client.get("/sharing", headers=auth_headers(rui)).json()["shared_with_me"] == []
    assert client.get("/purchases", headers=auth_headers(rui)).json() == []
