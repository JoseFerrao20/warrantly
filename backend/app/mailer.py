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


def is_configured() -> bool:
    """Com SES, chega a região (as credenciais vêm do papel IAM); com SMTP, falta o SMTP_HOST."""
    return settings.mail_backend == "ses" or bool(settings.smtp_host)


def send_email(message: EmailMessage) -> None:
    """Envia pelo SES (MAIL_BACKEND=ses) ou por SMTP (SMTP_HOST, SMTP_PORT, ...)."""
    if settings.mail_backend == "ses":
        _send_ses(message)
    else:
        _send_smtp(message)


def _send_smtp(message: EmailMessage) -> None:
    if not settings.smtp_host:
        raise MailNotConfiguredError("Falta definir SMTP_HOST para enviar emails")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password or "")
        smtp.send_message(message)


def _send_ses(message: EmailMessage) -> None:
    """Amazon SES pela API (boto3): sem password SMTP, autorizado pelo papel IAM do Lambda."""
    import boto3

    client = boto3.client("sesv2", region_name=settings.aws_region)
    client.send_email(
        FromEmailAddress=message["From"],
        Destination={"ToAddresses": [message["To"]]},
        Content={"Raw": {"Data": message.as_bytes()}},
    )
