import re
from datetime import UTC, datetime, timedelta
from email import message_from_bytes, policy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import email_verification, password_reset
from app.config import settings
from app.models import User
from tests.conftest import auth_headers, make_user


@pytest.fixture
def mail_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(settings, "mail_backend", "file")
    monkeypatch.setattr(settings, "mail_dir", tmp_path / "emails")
    return tmp_path / "emails"


def emails(mail_dir: Path) -> list:
    if not mail_dir.exists():
        return []
    return [
        message_from_bytes(path.read_bytes(), policy=policy.default)
        for path in sorted(mail_dir.iterdir())
    ]


def token_from(email) -> str:
    match = re.search(r"/confirmar-email#token=(\S+)", email.get_content())
    assert match, email.get_content()
    return match.group(1)


@pytest.fixture
def unverified(db_session: Session) -> User:
    return make_user(db_session, "nova@example.com", verified=False)


def test_register_sends_the_link_and_the_link_confirms_the_email(
    client: TestClient, db_session: Session, mail_dir: Path
):
    response = client.post(
        "/auth/register", json={"email": "Nova@Example.com", "password": "palavra-passe-1"}
    )
    assert response.json()["email_verified"] is False

    [email] = emails(mail_dir)
    assert email["To"] == "nova@example.com"
    assert email["Subject"] == "Confirma o teu email no Warrantly"
    token = token_from(email)

    # O link abre sem sessão (pode ser noutro aparelho) e pode abrir-se mais de uma vez.
    for _ in range(2):
        assert client.post("/auth/verify-email", json={"token": token}).status_code == 204
    user = db_session.get(User, response.json()["id"])
    assert user.email_verified
    me = client.get("/auth/me", headers=auth_headers(user)).json()
    assert me["email_verified"] is True


def test_register_without_mail_configured_still_works(client: TestClient):
    response = client.post(
        "/auth/register", json={"email": "nova@example.com", "password": "palavra-passe-1"}
    )
    assert response.status_code == 201


@pytest.mark.parametrize("case", ["garbage", "expired", "other-purpose", "email-changed"])
def test_invalid_links_are_refused(
    client: TestClient, db_session: Session, unverified: User, case: str
):
    if case == "garbage":
        token = "isto-nao-e-um-token"
    elif case == "expired":
        token = email_verification.create_verification_token(
            unverified, now=datetime.now(UTC) - timedelta(days=8)
        )
    elif case == "other-purpose":
        token = password_reset.create_reset_token(unverified)
    else:
        token = email_verification.create_verification_token(unverified)
        unverified.email = "outra@example.com"
        db_session.flush()

    response = client.post("/auth/verify-email", json={"token": token})

    assert response.status_code == 400
    assert response.json()["detail"] == "O link é inválido ou já expirou. Pede outro na app."
    assert not unverified.email_verified


def test_resend_sends_a_new_link_with_a_limit(client: TestClient, unverified: User, mail_dir: Path):
    headers = auth_headers(unverified)
    for _ in range(5):
        response = client.post("/auth/verify-email/resend", headers=headers)
        assert response.status_code == 202
        assert response.json()["detail"] == "Enviámos um link para nova@example.com."
    assert len(emails(mail_dir)) == 5

    blocked = client.post("/auth/verify-email/resend", headers=headers)
    assert blocked.status_code == 429


def test_resend_when_already_verified_or_without_mail(
    client: TestClient, user: User, unverified: User
):
    done = client.post("/auth/verify-email/resend", headers=auth_headers(user))
    assert done.status_code == 409
    assert done.json()["detail"] == "O teu email já está confirmado"

    no_mail = client.post("/auth/verify-email/resend", headers=auth_headers(unverified))
    assert no_mail.status_code == 503


def test_unverified_accounts_cannot_share_nor_see_invites(
    client: TestClient, user: User, unverified: User
):
    """Quem criasse uma conta com o email de outra pessoa não veria os convites dela."""
    share = client.post(
        "/sharing", json={"email": unverified.email}, headers=auth_headers(user)
    ).json()
    headers = auth_headers(unverified)

    assert client.get("/sharing", headers=headers).json()["shared_with_me"] == []
    assert client.post(f"/sharing/{share['id']}/accept", headers=headers).status_code == 404
    assert client.delete(f"/sharing/{share['id']}", headers=headers).status_code == 404
    invite = client.post("/sharing", json={"email": "rui@example.com"}, headers=headers)
    assert invite.status_code == 403
    assert invite.json()["detail"] == "Confirma o teu email antes de partilhar o arquivo"

    # Depois de confirmar, o convite aparece e pode ser aceite.
    token = email_verification.create_verification_token(unverified)
    client.post("/auth/verify-email", json={"token": token})
    [archive] = client.get("/sharing", headers=headers).json()["shared_with_me"]
    assert archive["id"] == share["id"]
    assert client.post(f"/sharing/{share['id']}/accept", headers=headers).status_code == 200
