import smtplib
from datetime import date
from decimal import Decimal
from email.message import EmailMessage

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import alerts, mailer
from app.alerts import build_alert_email, find_due_alerts, format_days_left, send_due_alerts
from app.config import settings
from app.models import Purchase, User, WarrantyAlert
from tests.conftest import make_user

TODAY = date(2026, 10, 14)


def purchase_ending(session: Session, user: User, end: date, name: str = "Produto") -> Purchase:
    """Compra com 12 meses de garantia que acaba em `end` (dia <= 28)."""
    purchase = Purchase(
        user_id=user.id,
        product_name=name,
        store="Worten",
        purchase_date=end.replace(year=end.year - 1),
        price=Decimal("100"),
        warranty_months=12,
    )
    session.add(purchase)
    session.flush()
    session.refresh(purchase)
    assert purchase.warranty_end == end
    return purchase


class Outbox(list):
    def __call__(self, message: EmailMessage) -> None:
        self.append(message)

    def to(self, user: User) -> list[EmailMessage]:
        return [m for m in self if m["To"] == user.email]


def sent_thresholds(session: Session, purchase: Purchase) -> set[int]:
    query = select(WarrantyAlert.days_before).where(WarrantyAlert.purchase_id == purchase.id)
    return set(session.scalars(query))


def test_selects_purchases_inside_alert_windows(db_session: Session, user: User):
    in_60 = purchase_ending(db_session, user, date(2026, 12, 13), "A 60 dias")
    in_61 = purchase_ending(db_session, user, date(2026, 12, 14), "A 61 dias")
    in_10 = purchase_ending(db_session, user, date(2026, 10, 24), "A 10 dias")
    today = purchase_ending(db_session, user, date(2026, 10, 14), "Acaba hoje")
    expired = purchase_ending(db_session, user, date(2026, 10, 13), "Expirada")

    due = {a.purchase.id: a for a in find_due_alerts(db_session, TODAY).get(user, [])}

    assert set(due) == {in_60.id, in_10.id, today.id}
    assert due[in_60.id].thresholds == [60]
    assert due[in_10.id].thresholds == [60, 15]  # registada tarde: um só email cobre os dois avisos
    assert in_61.id not in due and expired.id not in due


def test_sends_one_email_per_user_and_does_not_repeat(db_session: Session, user: User):
    a = purchase_ending(db_session, user, date(2026, 11, 20), "Máquina de lavar")
    b = purchase_ending(db_session, user, date(2026, 10, 24), "Telemóvel")
    outbox = Outbox()

    send_due_alerts(db_session, TODAY, send=outbox)
    send_due_alerts(db_session, TODAY, send=outbox)

    [message] = outbox.to(user)
    assert message["Subject"] == "2 garantias estão a acabar"
    body = message.get_content()
    assert "Máquina de lavar" in body and "Telemóvel" in body
    assert "termina a 24/10/2026, daqui a 10 dias" in body
    assert "Estas garantias estão quase a acabar" in body
    assert sent_thresholds(db_session, a) == {60}
    assert sent_thresholds(db_session, b) == {60, 15}


def test_sends_second_alert_at_15_days(db_session: Session, user: User):
    purchase = purchase_ending(db_session, user, date(2026, 12, 13))
    outbox = Outbox()

    send_due_alerts(db_session, TODAY, send=outbox)  # faltam 60 dias
    send_due_alerts(db_session, date(2026, 11, 1), send=outbox)  # faltam 42: nada de novo
    send_due_alerts(db_session, date(2026, 11, 28), send=outbox)  # faltam 15

    assert len(outbox.to(user)) == 2
    assert sent_thresholds(db_session, purchase) == {60, 15}


def test_each_user_gets_only_their_purchases(db_session: Session, user: User):
    other = make_user(db_session, "rui@example.com")
    purchase_ending(db_session, user, date(2026, 11, 1), "Da Ana")
    purchase_ending(db_session, other, date(2026, 11, 1), "Do Rui")
    outbox = Outbox()

    send_due_alerts(db_session, TODAY, send=outbox)

    [to_user] = outbox.to(user)
    [to_other] = outbox.to(other)
    assert "Da Ana" in to_user.get_content() and "Do Rui" not in to_user.get_content()
    assert "Do Rui" in to_other.get_content()


def test_failed_send_is_not_recorded_and_retries_next_run(db_session: Session, user: User):
    purchase = purchase_ending(db_session, user, date(2026, 11, 1))
    db_session.commit()  # o rollback após a falha só deve desfazer os avisos, não os dados do teste

    def failing_send(message: EmailMessage) -> None:
        raise smtplib.SMTPException("servidor em baixo")

    result = send_due_alerts(db_session, TODAY, send=failing_send)

    assert user.email in result.failed_users
    assert sent_thresholds(db_session, purchase) == set()

    outbox = Outbox()
    send_due_alerts(db_session, TODAY, send=outbox)
    assert len(outbox.to(user)) == 1


@pytest.mark.parametrize(
    ("days", "expected"), [(0, "hoje"), (1, "amanhã"), (15, "daqui a 15 dias")]
)
def test_format_days_left(days: int, expected: str):
    assert format_days_left(days) == expected


def test_single_purchase_subject(db_session: Session, user: User):
    purchase_ending(db_session, user, date(2026, 11, 1), "Portátil")
    due = find_due_alerts(db_session, TODAY)[user]

    message = build_alert_email(user, due)

    assert message["Subject"] == "A garantia de Portátil está a acabar"
    assert "Esta garantia está quase a acabar" in message.get_content()
    assert message["To"] == user.email
    assert message["From"] == settings.mail_from


class FakeSMTP:
    instances: list["FakeSMTP"] = []

    def __init__(self, host: str, port: int, timeout: int):
        self.host, self.port = host, port
        self.calls: list[str] = []
        self.messages: list[EmailMessage] = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self):
        self.calls.append("starttls")

    def login(self, user: str, password: str):
        self.calls.append(f"login:{user}")

    def send_message(self, message: EmailMessage):
        self.messages.append(message)


def test_send_email_uses_smtp_settings(monkeypatch: pytest.MonkeyPatch):
    FakeSMTP.instances.clear()
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_port", 2525)
    monkeypatch.setattr(settings, "smtp_user", "utilizador")
    monkeypatch.setattr(settings, "smtp_starttls", True)
    message = mailer.build_message("ana@example.com", "Assunto", "Corpo")

    mailer.send_email(message)

    [smtp] = FakeSMTP.instances
    assert (smtp.host, smtp.port) == ("smtp.example.com", 2525)
    assert smtp.calls == ["starttls", "login:utilizador"]
    assert smtp.messages == [message]


def test_send_email_without_host_fails_clearly(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "smtp_host", None)

    with pytest.raises(mailer.MailNotConfiguredError):
        mailer.send_email(mailer.build_message("ana@example.com", "A", "B"))


def test_command_refuses_to_run_without_smtp(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "smtp_host", None)

    assert alerts.main() == 1
