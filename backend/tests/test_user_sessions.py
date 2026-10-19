"""Lista de sessões na conta: ver os aparelhos com login feito e terminar as sessões deles."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import sessions
from app.config import settings
from app.models import RefreshToken, User, UserSession
from app.security import ALGORITHM
from tests.conftest import TEST_PASSWORD, auth_headers, make_user

CHROME_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
SAFARI_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)


def login(client: TestClient, user_agent: str = CHROME_WINDOWS, **headers: str) -> dict:
    """Login como a app móvel (refresh token no corpo), para ter várias sessões no mesmo client."""
    response = client.post(
        "/auth/login",
        data={"username": "ana@example.com", "password": TEST_PASSWORD},
        headers={"X-Client": "mobile", "User-Agent": user_agent, **headers},
    )
    assert response.status_code == 200
    return response.json()


def bearer(body: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {body['access_token']}"}


def list_sessions(client: TestClient, body: dict) -> list[dict]:
    response = client.get("/auth/sessions", headers=bearer(body))
    assert response.status_code == 200
    return response.json()


def test_login_records_the_device(client: TestClient, db_session: Session, user: User):
    login(client)
    login(client, "okhttp/4.12", **{"X-Device-Name": "Pixel 8 (Android 16)"})

    devices = db_session.scalars(
        select(UserSession.device).where(UserSession.user_id == user.id)
    ).all()
    assert sorted(devices) == ["App Warrantly: Pixel 8 (Android 16)", "Chrome no Windows"]


def test_access_token_carries_the_session(client: TestClient, db_session: Session, user: User):
    body = login(client)

    payload = jwt.decode(body["access_token"], settings.secret_key, algorithms=[ALGORITHM])
    stored = db_session.scalar(select(UserSession).where(UserSession.user_id == user.id))
    assert payload["sid"] == stored.family


def test_lists_sessions_with_the_current_one_marked(client: TestClient, user: User):
    phone = login(client, SAFARI_IPHONE)
    laptop = login(client)

    listed = list_sessions(client, laptop)

    assert [s["device"] for s in listed] == ["Chrome no Windows", "Safari no iPhone"]
    assert [s["current"] for s in listed] == [True, False]
    assert set(listed[0]) == {"id", "device", "created_at", "last_used_at", "current"}
    # Do telemóvel, a sessão marcada é a outra.
    assert [s["current"] for s in list_sessions(client, phone)] == [False, True]


def test_refresh_updates_last_used(client: TestClient, user: User, monkeypatch):
    body = login(client)
    before = list_sessions(client, body)[0]["last_used_at"]
    later = datetime.now(UTC) + timedelta(hours=2)
    monkeypatch.setattr(sessions, "_now", lambda: later)

    renewed = client.post("/auth/refresh", json={"refresh_token": body["refresh_token"]}).json()

    after = list_sessions(client, renewed)[0]["last_used_at"]
    assert datetime.fromisoformat(after) > datetime.fromisoformat(before)


def test_expired_sessions_are_not_listed(
    client: TestClient, db_session: Session, user: User, monkeypatch
):
    old = login(client, SAFARI_IPHONE)
    current = login(client)
    db_session.execute(
        UserSession.__table__.update()
        .where(UserSession.family == sid(old))
        .values(last_used_at=datetime.now(UTC) - timedelta(days=31))
    )

    listed = list_sessions(client, current)

    assert [s["device"] for s in listed] == ["Chrome no Windows"]
    assert db_session.scalar(select(UserSession).where(UserSession.family == sid(old))) is None


def test_ending_another_session(client: TestClient, user: User):
    phone = login(client, SAFARI_IPHONE)
    laptop = login(client)
    phone_id = next(s["id"] for s in list_sessions(client, laptop) if not s["current"])

    response = client.delete(f"/auth/sessions/{phone_id}", headers=bearer(laptop))

    assert response.status_code == 204
    # No telemóvel, a sessão acabou logo: nem renova nem o token de acesso serve.
    refreshed = client.post("/auth/refresh", json={"refresh_token": phone["refresh_token"]})
    assert refreshed.status_code == 401
    assert client.get("/auth/me", headers=bearer(phone)).status_code == 401
    # Aqui continua tudo.
    assert client.get("/auth/me", headers=bearer(laptop)).status_code == 200
    assert [s["device"] for s in list_sessions(client, laptop)] == ["Chrome no Windows"]


def test_cannot_end_someone_elses_session(client: TestClient, db_session: Session, user: User):
    login(client)
    other_session = db_session.scalar(select(UserSession).where(UserSession.user_id == user.id))
    intruder = make_user(db_session, "rui@example.com")

    response = client.delete(f"/auth/sessions/{other_session.id}", headers=auth_headers(intruder))

    assert response.status_code == 404
    assert db_session.get(UserSession, other_session.id) is not None


def test_ending_an_unknown_session(auth_client: TestClient):
    assert auth_client.delete("/auth/sessions/999999").status_code == 404


def test_end_other_sessions_keeps_this_one(client: TestClient, db_session: Session, user: User):
    phone = login(client, SAFARI_IPHONE)
    tablet = login(client, "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari/604.1")
    laptop = login(client)

    response = client.post("/auth/sessions/end-others", headers=bearer(laptop))

    assert response.status_code == 200
    assert response.json() == {"ended": 2}
    for body in (phone, tablet):
        assert client.get("/auth/me", headers=bearer(body)).status_code == 401
    assert client.get("/auth/me", headers=bearer(laptop)).status_code == 200
    assert len(list_sessions(client, laptop)) == 1
    tokens = select(func.count()).select_from(RefreshToken).where(RefreshToken.user_id == user.id)
    assert db_session.scalar(tokens) == 1  # os refresh tokens das outras foram com elas


def test_logout_rejects_the_access_token_at_once(client: TestClient, user: User):
    body = login(client)

    client.post("/auth/logout", json={"refresh_token": body["refresh_token"]})

    assert client.get("/auth/me", headers=bearer(body)).status_code == 401


def test_tokens_without_a_session_still_work(auth_client: TestClient):
    """Tokens emitidos antes das sessões (sem `sid`) servem até expirarem."""
    assert auth_client.get("/auth/me").status_code == 200
    assert auth_client.get("/auth/sessions").json() == []


def test_sessions_need_login(client: TestClient):
    assert client.get("/auth/sessions").status_code == 401
    assert client.post("/auth/sessions/end-others").status_code == 401
    assert client.delete("/auth/sessions/1").status_code == 401


def sid(body: dict) -> str:
    return jwt.decode(body["access_token"], settings.secret_key, algorithms=[ALGORITHM])["sid"]


@pytest.mark.parametrize(
    ("user_agent", "device_name", "expected"),
    [
        (CHROME_WINDOWS, None, "Chrome no Windows"),
        (SAFARI_IPHONE, None, "Safari no iPhone"),
        (CHROME_WINDOWS + " Edg/141.0.0.0", None, "Edge no Windows"),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0; rv:141.0) Gecko/20100101 Firefox/141.0",
            None,
            "Firefox no macOS",
        ),
        (
            "Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/141.0.0.0 Mobile Safari/537.36",
            None,
            "Chrome no Android",
        ),
        ("curl/8.5.0", None, "Aparelho desconhecido"),
        (None, None, "Aparelho desconhecido"),
        ("okhttp/4.12", "Pixel 8 (Android 16)", "App Warrantly: Pixel 8 (Android 16)"),
        ("okhttp/4.12", "<b>iPhone</b>\n\t de Ana", "App Warrantly: biPhone/b de Ana"),
        ("okhttp/4.12", "x" * 300, "App Warrantly: " + "x" * 80),
        (SAFARI_IPHONE, "<>", "Safari no iPhone"),
    ],
)
def test_describe_device(user_agent, device_name, expected):
    assert sessions.describe_device(user_agent, device_name) == expected
