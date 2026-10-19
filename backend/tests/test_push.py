import io
import json
import logging
import urllib.request
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import push
from app.alerts import send_due_alerts
from app.config import settings
from app.models import PushTicket, PushToken, User
from app.push import PushMessage, PushOutcome, send_push
from tests.conftest import TEST_PASSWORD, auth_headers, make_user
from tests.test_alerts import TODAY, Outbox, purchase_ending, sent_thresholds

TOKEN = "ExponentPushToken[abc123-XYZ_9]"
# Guardados antes de a fixture no_real_push os substituir.
REAL_POST = push._post
REAL_GET_RECEIPTS = push._get_receipts


def tokens(session: Session) -> list[tuple[str, int, str]]:
    rows = session.execute(select(PushToken.token, PushToken.user_id, PushToken.platform))
    return sorted(tuple(row) for row in rows)


def add_token(session: Session, user: User, token: str = TOKEN) -> None:
    session.add(PushToken(user_id=user.id, token=token, platform="android"))
    session.flush()


# --- API ----------------------------------------------------------------------------------


def test_register_token(auth_client: TestClient, db_session: Session, user: User):
    response = auth_client.post("/push-tokens", json={"token": TOKEN, "platform": "android"})

    assert response.status_code == 204
    assert tokens(db_session) == [(TOKEN, user.id, "android")]

    # Registar outra vez (cada vez que a app abre) não duplica.
    auth_client.post("/push-tokens", json={"token": TOKEN, "platform": "android"})
    assert len(tokens(db_session)) == 1


def test_token_moves_to_whoever_signs_in_on_the_phone(
    client: TestClient, db_session: Session, user: User
):
    add_token(db_session, user)
    other = make_user(db_session, "rui@example.com")

    response = client.post(
        "/push-tokens", json={"token": TOKEN, "platform": "ios"}, headers=auth_headers(other)
    )

    assert response.status_code == 204
    assert tokens(db_session) == [(TOKEN, other.id, "ios")]


@pytest.mark.parametrize(
    "body",
    [
        {"token": "abc", "platform": "android"},
        {"token": "ExponentPushToken[]", "platform": "android"},
        {"token": "ExponentPushToken[a b]", "platform": "android"},
        {"token": TOKEN, "platform": "web"},
    ],
)
def test_register_rejects_invalid_tokens(auth_client: TestClient, body: dict):
    assert auth_client.post("/push-tokens", json=body).status_code == 422


def test_accepts_the_newer_token_prefix(auth_client: TestClient, db_session: Session):
    body = {"token": "ExpoPushToken[xyz]", "platform": "ios"}
    assert auth_client.post("/push-tokens", json=body).status_code == 204


def test_delete_only_removes_own_token(client: TestClient, db_session: Session, user: User):
    other = make_user(db_session, "rui@example.com")
    add_token(db_session, user)
    add_token(db_session, other, "ExponentPushToken[do-rui]")

    for token in (TOKEN, "ExponentPushToken[do-rui]"):
        response = client.request(
            "DELETE", "/push-tokens", json={"token": token}, headers=auth_headers(user)
        )
        assert response.status_code == 204

    assert tokens(db_session) == [("ExponentPushToken[do-rui]", other.id, "android")]


def test_push_tokens_require_authentication(client: TestClient):
    assert client.post("/push-tokens", json={"token": TOKEN, "platform": "ios"}).status_code == 401
    assert client.request("DELETE", "/push-tokens", json={"token": TOKEN}).status_code == 401


def test_deleting_the_account_deletes_the_tokens(
    auth_client: TestClient, db_session: Session, user: User
):
    add_token(db_session, user)

    response = auth_client.request("DELETE", "/auth/me", json={"password": TEST_PASSWORD})

    assert response.status_code == 204
    assert tokens(db_session) == []


# --- Envio pelo Expo ------------------------------------------------------------------------


class FakeExpo:
    """Simula o `_post`: guarda os pedidos e responde com um ticket por mensagem."""

    def __init__(self, errors: dict[str, str] | None = None, fail: bool = False):
        self.requests: list[list[dict]] = []
        self.errors = errors or {}
        self.fail = fail

    def __call__(self, messages: list[dict]) -> list[dict]:
        self.requests.append(messages)
        if self.fail:
            raise OSError("sem rede")
        return [
            {"status": "error", "message": "x", "details": {"error": self.errors[m["to"]]}}
            if m["to"] in self.errors
            else {"status": "ok", "id": f"ticket-{m['to'][18:-1]}"}
            for m in messages
        ]


def message(token: str = TOKEN) -> PushMessage:
    return PushMessage(token=token, title="Título", body="Corpo", data={"url": "/compras/1"})


def test_send_push_in_batches_and_reports_uninstalled_apps(monkeypatch, caplog):
    expo = FakeExpo(
        errors={
            "ExponentPushToken[t5]": "DeviceNotRegistered",
            "ExponentPushToken[t7]": "MessageRateExceeded",
        }
    )
    monkeypatch.setattr(push, "_post", expo)
    messages = [message(f"ExponentPushToken[t{i}]") for i in range(250)]

    with caplog.at_level(logging.WARNING):
        outcome = send_push(messages)

    assert [len(batch) for batch in expo.requests] == [100, 100, 50]
    assert outcome.invalid == {"ExponentPushToken[t5]"}
    # Os aceites ficam com o id do ticket, para ir buscar o recibo mais tarde.
    assert len(outcome.tickets) == 248
    assert outcome.tickets["ticket-t0"] == "ExponentPushToken[t0]"
    assert "MessageRateExceeded" in caplog.text
    assert expo.requests[0][0] == {
        "to": "ExponentPushToken[t0]",
        "title": "Título",
        "body": "Corpo",
        "data": {"url": "/compras/1"},
        "sound": "default",
        "channelId": "alertas",
    }


def test_send_push_survives_network_errors(monkeypatch):
    monkeypatch.setattr(push, "_post", FakeExpo(fail=True))

    assert send_push([message()]) == PushOutcome()


@pytest.mark.parametrize("access_token", [None, "segredo-do-expo"])
def test_post_to_expo(monkeypatch, access_token: str | None):
    monkeypatch.setattr(push, "_post", REAL_POST)  # o verdadeiro; o urlopen é que é simulado
    monkeypatch.setattr(settings, "expo_access_token", access_token)
    seen: list[urllib.request.Request] = []

    def fake_urlopen(request: urllib.request.Request, timeout: int):
        seen.append(request)
        return io.BytesIO(json.dumps({"data": [{"status": "ok", "id": "1"}]}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    assert send_push([message()]) == PushOutcome(tickets={"1": TOKEN})

    [request] = seen
    assert request.full_url == "https://exp.host/--/api/v2/push/send"
    assert json.loads(request.data)[0]["to"] == TOKEN
    expected = f"Bearer {access_token}" if access_token else None
    assert request.get_header("Authorization") == expected


# --- Alertas --------------------------------------------------------------------------------


class Pushes(list):
    def __init__(self, invalid: set[str] | None = None, fail: bool = False):
        super().__init__()
        self.invalid = invalid or set()
        self.fail = fail

    def __call__(self, messages: list[PushMessage]) -> PushOutcome:
        if self.fail:
            raise RuntimeError("Expo em baixo")
        self.extend(messages)
        return PushOutcome(
            invalid=self.invalid & {m.token for m in messages},
            tickets={
                f"ticket-{len(self)}-{i}": m.token
                for i, m in enumerate(messages)
                if m.token not in self.invalid
            },
        )


def test_alert_goes_to_every_phone_of_the_user(db_session: Session, user: User):
    purchase = purchase_ending(db_session, user, date(2026, 10, 24), "Telemóvel")
    add_token(db_session, user)
    add_token(db_session, user, "ExponentPushToken[tablet]")
    other = make_user(db_session, "rui@example.com")
    add_token(db_session, other, "ExponentPushToken[do-rui]")
    pushes = Pushes()

    result = send_due_alerts(db_session, TODAY, send=Outbox(), push=pushes)
    send_due_alerts(db_session, TODAY, send=Outbox(), push=pushes)  # não repete

    assert result.pushes_sent == 2
    assert sorted(m.token for m in pushes) == [
        "ExponentPushToken[abc123-XYZ_9]",
        "ExponentPushToken[tablet]",
    ]
    assert pushes[0].title == "A garantia de Telemóvel está a acabar"
    assert pushes[0].body == "Termina a 24/10/2026, daqui a 10 dias."
    assert pushes[0].data == {"url": f"/compras/{purchase.id}"}


def test_several_purchases_in_one_push(db_session: Session, user: User):
    purchase_ending(db_session, user, date(2026, 11, 20), "Máquina de lavar")
    purchase_ending(db_session, user, date(2026, 10, 15), "Torradeira")
    add_token(db_session, user)
    pushes = Pushes()

    send_due_alerts(db_session, TODAY, send=Outbox(), push=pushes)

    [sent] = pushes
    assert sent.title == "2 garantias estão a acabar"
    assert sent.body == "Torradeira, Máquina de lavar. A primeira termina amanhã."
    assert sent.data == {"url": "/"}


def test_uninstalled_app_token_is_removed(db_session: Session, user: User):
    purchase_ending(db_session, user, date(2026, 11, 1))
    add_token(db_session, user)
    add_token(db_session, user, "ExponentPushToken[tablet]")

    result = send_due_alerts(db_session, TODAY, send=Outbox(), push=Pushes(invalid={TOKEN}))

    assert result.pushes_sent == 1
    assert [t for t, _, _ in tokens(db_session)] == ["ExponentPushToken[tablet]"]


def test_push_failure_does_not_undo_the_email(db_session: Session, user: User):
    purchase = purchase_ending(db_session, user, date(2026, 11, 1))
    add_token(db_session, user)
    outbox = Outbox()

    result = send_due_alerts(db_session, TODAY, send=outbox, push=Pushes(fail=True))

    assert len(outbox.to(user)) == 1
    assert result.pushes_sent == 0 and result.failed_users == []
    assert sent_thresholds(db_session, purchase) == {60}


def test_no_push_when_the_email_fails(db_session: Session, user: User):
    purchase_ending(db_session, user, date(2026, 11, 1))
    add_token(db_session, user)
    db_session.commit()
    pushes = Pushes()

    def failing_send(message: EmailMessage) -> None:
        raise OSError("SMTP em baixo")

    send_due_alerts(db_session, TODAY, send=failing_send, push=pushes)

    assert pushes == []  # amanhã volta a tentar os dois, sem push repetido


def test_push_can_be_disabled(db_session: Session, user: User, monkeypatch):
    monkeypatch.setattr(settings, "push_enabled", False)
    purchase_ending(db_session, user, date(2026, 11, 1))
    add_token(db_session, user)

    result = send_due_alerts(db_session, TODAY, send=Outbox())

    assert result.pushes_sent == 0  # e o no_real_push garante que o Expo não foi chamado


def test_alert_push_tickets_are_kept_for_the_receipts(db_session: Session, user: User):
    purchase_ending(db_session, user, date(2026, 11, 1))
    add_token(db_session, user)
    add_token(db_session, user, "ExponentPushToken[tablet]")

    send_due_alerts(db_session, TODAY, send=Outbox(), push=Pushes(invalid={TOKEN}))

    stored = db_session.scalars(select(PushTicket.token)).all()
    assert stored == ["ExponentPushToken[tablet]"]  # o recusado logo no envio não tem recibo


# --- Recibos ----------------------------------------------------------------------------------

NOW = datetime(2026, 10, 14, 9, 17, tzinfo=UTC)


class FakeReceipts:
    """Simula o `_get_receipts`: guarda os ids pedidos e responde com os recibos dados."""

    def __init__(self, receipts: dict[str, dict], fail: bool = False):
        self.receipts = receipts
        self.fail = fail
        self.requests: list[list[str]] = []

    def __call__(self, ids: list[str]) -> dict[str, dict]:
        self.requests.append(ids)
        if self.fail:
            raise OSError("sem rede")
        return {i: self.receipts[i] for i in ids if i in self.receipts}


def add_ticket(session: Session, ticket_id: str, token: str, age: timedelta) -> None:
    session.add(PushTicket(ticket_id=ticket_id, token=token, created_at=NOW - age))
    session.flush()


def tickets(session: Session) -> list[str]:
    return sorted(session.scalars(select(PushTicket.ticket_id)))


def error_receipt(error: str) -> dict:
    return {"status": "error", "message": f"erro {error}", "details": {"error": error}}


def test_receipts_remove_uninstalled_apps_and_log_errors(
    db_session: Session, user: User, monkeypatch, caplog
):
    phones = [f"ExponentPushToken[p{i}]" for i in range(6)]
    for token in phones:
        add_token(db_session, user, token)
    minutes = timedelta(minutes=30)
    add_ticket(db_session, "entregue", phones[0], minutes)
    add_ticket(db_session, "desinstalada", phones[1], minutes)
    add_ticket(db_session, "grande-demais", phones[2], minutes)
    add_ticket(db_session, "sem-recibo", phones[3], minutes)
    add_ticket(db_session, "recente", phones[4], timedelta(minutes=5))
    add_ticket(db_session, "expirado", phones[5], timedelta(hours=25))
    expo = FakeReceipts(
        {
            "entregue": {"status": "ok"},
            "desinstalada": error_receipt("DeviceNotRegistered"),
            "grande-demais": error_receipt("MessageTooBig"),
        }
    )
    monkeypatch.setattr(push, "_get_receipts", expo)

    with caplog.at_level(logging.INFO):
        result = push.check_receipts(db_session, NOW)

    # Só se pedem os que têm mais de 15 minutos e menos de 24 horas.
    assert sorted(expo.requests[0]) == ["desinstalada", "entregue", "grande-demais", "sem-recibo"]
    assert (result.checked, result.delivered, result.tokens_removed, result.errors) == (3, 1, 1, 1)
    assert result.pending == 1
    assert phones[1] not in [t for t, _, _ in tokens(db_session)]
    # Fica o que ainda não tem recibo (tenta-se outra vez) e o recente.
    assert tickets(db_session) == ["recente", "sem-recibo"]
    assert "MessageTooBig" in caplog.text
    assert "1 entregue(s), 1 app(s) desinstalada(s), 1 erro(s), 1 pendente(s)" in caplog.text


def test_receipts_are_asked_in_batches(db_session: Session, user: User, monkeypatch):
    add_token(db_session, user)
    for i in range(5):
        add_ticket(db_session, f"t{i}", TOKEN, timedelta(minutes=20))
    monkeypatch.setattr(push, "RECEIPTS_BATCH_SIZE", 2)
    expo = FakeReceipts({f"t{i}": {"status": "ok"} for i in range(5)})
    monkeypatch.setattr(push, "_get_receipts", expo)

    result = push.check_receipts(db_session, NOW)

    assert [len(ids) for ids in expo.requests] == [2, 2, 1]
    assert result.delivered == 5
    assert tickets(db_session) == []


def test_receipts_survive_network_errors(db_session: Session, user: User, monkeypatch):
    add_token(db_session, user)
    add_ticket(db_session, "t1", TOKEN, timedelta(minutes=20))
    monkeypatch.setattr(push, "_get_receipts", FakeReceipts({}, fail=True))

    result = push.check_receipts(db_session, NOW)

    assert result.pending == 1
    assert tickets(db_session) == ["t1"]  # fica para a próxima


def test_tickets_go_with_the_token(db_session: Session, user: User):
    add_token(db_session, user)
    add_ticket(db_session, "t1", TOKEN, timedelta(minutes=20))

    db_session.execute(PushToken.__table__.delete())

    assert tickets(db_session) == []


def test_get_receipts_from_expo(monkeypatch):
    monkeypatch.setattr(push, "_get_receipts", REAL_GET_RECEIPTS)
    seen: list[urllib.request.Request] = []

    def fake_urlopen(request: urllib.request.Request, timeout: int):
        seen.append(request)
        return io.BytesIO(json.dumps({"data": {"t1": {"status": "ok"}}}).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    assert push._get_receipts(["t1"]) == {"t1": {"status": "ok"}}
    [request] = seen
    assert request.full_url == "https://exp.host/--/api/v2/push/getReceipts"
    assert json.loads(request.data) == {"ids": ["t1"]}
