import logging
import smtplib
import time
import uuid
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)

# Domínios reservados para exemplos (RFC 2606), que não recebem email. O smoke test do deploy
# cria contas smoke-…@example.com: pelo SES, um envio para lá seria um bounce, que conta para a
# reputação da conta. Nos outros modos (ficheiro, Mailpit), os testes usam-nos à vontade.
RESERVED_DOMAINS = ("example.com", "example.net", "example.org")


def is_reserved_address(address: str) -> bool:
    domain = address.rsplit("@", 1)[-1].strip(" >").lower()
    return domain in RESERVED_DOMAINS or domain.endswith((".example", ".test", ".invalid"))


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
    return settings.mail_backend in ("ses", "file") or bool(settings.smtp_host)


def send_email(message: EmailMessage) -> None:
    """Envia pelo SES (MAIL_BACKEND=ses) ou por SMTP (SMTP_HOST, SMTP_PORT, ...)."""
    if settings.mail_backend == "ses":
        _send_ses(message)
    elif settings.mail_backend == "file":
        _send_file(message)
    else:
        _send_smtp(message)


def _send_file(message: EmailMessage) -> None:
    """Grava o email em MAIL_DIR (um .eml por email, por ordem de envio no nome)."""
    settings.mail_dir.mkdir(parents=True, exist_ok=True)
    name = f"{time.time_ns()}-{uuid.uuid4().hex[:8]}.eml"
    (settings.mail_dir / name).write_bytes(message.as_bytes())


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

    if is_reserved_address(message["To"]):
        logger.info("Email não enviado: domínio reservado para exemplos")
        return
    client = boto3.client("sesv2", region_name=settings.aws_region)
    client.send_email(
        FromEmailAddress=message["From"],
        Destination={"ToAddresses": [message["To"]]},
        Content={"Raw": {"Data": message.as_bytes()}},
    )
