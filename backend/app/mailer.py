import smtplib
from email.message import EmailMessage

from app.config import settings


class MailNotConfiguredError(RuntimeError):
    pass


def build_message(to: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    return message


def send_email(message: EmailMessage) -> None:
    """Envia por SMTP com as definições do .env (SMTP_HOST, SMTP_PORT, ...)."""
    if not settings.smtp_host:
        raise MailNotConfiguredError("Falta definir SMTP_HOST para enviar emails")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password or "")
        smtp.send_message(message)
