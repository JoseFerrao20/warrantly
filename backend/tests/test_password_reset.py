import re
from datetime import UTC, datetime, timedelta
from email import message_from_bytes
from email.message import EmailMessage
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import mailer
from app.config import settings
from app.models import RefreshToken, User
from app.password_reset import create_reset_token
from app.security import create_access_token
from tests.conftest import TEST_PASSWORD

NEW_PASSWORD = "uma-nova-palavra-passe"


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[EmailMessage]:
    sent: list[EmailMessage] = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "app_url", "https://warrantly.example.com/")
    monkeypatch.setattr(mailer, "send_email", sent.append)
    return sent


def request_reset(client: TestClient, email: str = "ana@example.com"):
    return client.post("/auth/password-reset", json={"email": email})


def confirm(client: TestClient, token: str, password: str = NEW_PASSWORD):
    return client.post("/auth/password-reset/confirm", json={"token": token, "password": password})


def token_from(message: EmailMessage) -> str:
    match = re.search(
        r"https://warrantly\.example\.com/repor-palavra-passe#token=(\S+)", message.get_content()
    )
    assert match, message.get_content()
    return match.group(1)


def login(client: TestClient, password: str):
    return client.post("/auth/login", data={"username": "ana@example.com", "password": password})


def test_sends_a_reset_link(client: TestClient, user: User, outbox):
    response = request_reset(client, "Ana@Example.com")

    assert response.status_code == 202
    assert "Se existir uma conta com este email" in response.json()["detail"]
    [message] = outbox
    assert message["To"] == user.email
    assert message["Subject"] == "Repor a palavra-passe do Warrantly"
    assert "durante 60 minutos" in message.get_content()
    token_from(message)  # o link usa o APP_URL, sem barra dupla, e leva o token no fragmento


def test_unknown_email_gets_the_same_answer(client: TestClient, user: User, outbox):
    known = request_reset(client)
    unknown = request_reset(client, "ninguem@example.com")

    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    assert len(outbox) == 1


def test_failed_email_does_not_change_the_answer(client: TestClient, user: User, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")

    def broken(message: EmailMessage) -> None:
        raise OSError("SMTP em baixo")

    monkeypatch.setattr(mailer, "send_email", broken)

    assert request_reset(client).status_code == 202


def test_requires_email_to_be_configured(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", None)

    response = request_reset(client)

    assert response.status_code == 503
    assert response.json()["detail"] == "O envio de emails não está configurado"


def test_requests_are_rate_limited_per_email(client: TestClient, user: User, outbox):
    for _ in range(3):
        assert request_reset(client).status_code == 202

    response = request_reset(client)

    assert response.status_code == 429
    assert len(outbox) == 3


def test_reset_changes_the_password_and_ends_all_sessions(
    client: TestClient, db_session: Session, user: User, outbox
):
    # Uma sessão aberta (por exemplo, de quem roubou a conta).
    access = login(client, TEST_PASSWORD).json()["access_token"]
    request_reset(client)

    response = confirm(client, token_from(outbox[0]))

    assert response.status_code == 204
    assert login(client, TEST_PASSWORD).status_code == 401
    sessions = select(func.count()).select_from(RefreshToken).where(RefreshToken.user_id == user.id)
    assert db_session.scalar(sessions) == 0
    # O token de acesso dessa sessão também deixa logo de servir.
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 401
    assert login(client, NEW_PASSWORD).status_code == 200


def test_link_works_only_once(client: TestClient, user: User, outbox):
    request_reset(client)
    token = token_from(outbox[0])
    assert confirm(client, token).status_code == 204

    response = confirm(client, token, "outra-palavra-passe")

    assert response.status_code == 400
    assert response.json()["detail"] == "O link é inválido ou já expirou. Pede um novo."
    assert login(client, NEW_PASSWORD).status_code == 200


def test_old_links_stop_working_after_a_reset(client: TestClient, user: User):
    first = create_reset_token(user)
    second = create_reset_token(user, now=datetime.now(UTC) + timedelta(seconds=1))

    assert confirm(client, second).status_code == 204
    assert confirm(client, first).status_code == 400


def test_expired_link(client: TestClient, user: User):
    token = create_reset_token(user, now=datetime.now(UTC) - timedelta(minutes=61))

    assert confirm(client, token).status_code == 400


@pytest.mark.parametrize("kind", ["access", "tampered", "garbage"])
def test_other_tokens_are_rejected(client: TestClient, user: User, kind: str):
    reset = create_reset_token(user)
    token = {
        "access": create_access_token(user.id),  # um token de sessão não repõe a palavra-passe
        "tampered": reset[:-2] + ("AA" if not reset.endswith("AA") else "BB"),
        "garbage": "nada",
    }[kind]

    assert confirm(client, token).status_code == 400


def test_reset_token_is_not_an_access_token(client: TestClient, user: User):
    token = create_reset_token(user)

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_new_password_must_be_long_enough(client: TestClient, user: User):
    assert confirm(client, create_reset_token(user), "curta").status_code == 422


def test_file_mail_backend_writes_eml_files(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "mail_backend", "file")
    monkeypatch.setattr(settings, "mail_dir", tmp_path / "emails")
    assert mailer.is_configured()

    mailer.send_email(mailer.build_message("ana@example.com", "Assunto", "Olá"))

    [path] = (tmp_path / "emails").glob("*.eml")
    message = message_from_bytes(path.read_bytes())
    assert message["To"] == "ana@example.com"
    assert message["Subject"] == "Assunto"
