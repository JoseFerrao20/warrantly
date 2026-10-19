"""Peças para correr na AWS: segredos no SSM, email pelo SES e ligações sem pool.

Tudo com o moto (AWS simulada em memória), nunca com a AWS real.
"""

import os
from collections.abc import Iterator

import boto3
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws
from moto.core import DEFAULT_ACCOUNT_ID
from moto.ses.models import ses_backends

from app import mailer
from app.config import Settings, load_ssm_parameters, settings

REGION = "eu-west-1"


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "teste")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "teste")
    monkeypatch.setenv("AWS_REGION", REGION)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with mock_aws():
        yield


def test_ssm_parameters_become_environment_variables(aws, monkeypatch: pytest.MonkeyPatch):
    ssm = boto3.client("ssm", region_name=REGION)
    ssm.put_parameter(Name="/warrantly/prod/SECRET_KEY", Value="s" * 40, Type="SecureString")
    ssm.put_parameter(Name="/warrantly/prod/ALERTS_TOKEN", Value="t" * 40, Type="SecureString")
    ssm.put_parameter(Name="/outra-app/SECRET_KEY", Value="nao-e-nosso", Type="SecureString")
    # Uma cópia do ambiente: o que o teste lá põe não passa para os outros testes.
    monkeypatch.setattr(os, "environ", os.environ.copy())
    os.environ.pop("SECRET_KEY", None)
    os.environ["ALERTS_TOKEN"] = "definido-no-ambiente-" + "x" * 20

    load_ssm_parameters("/warrantly/prod/")

    assert os.environ["SECRET_KEY"] == "s" * 40
    # O que já está no ambiente ganha (útil para testar com outro valor).
    assert os.environ["ALERTS_TOKEN"] == "definido-no-ambiente-" + "x" * 20
    assert Settings().secret_key == "s" * 40


def test_send_email_with_ses(aws, monkeypatch: pytest.MonkeyPatch):
    ses = boto3.client("sesv2", region_name=REGION)
    ses.create_email_identity(EmailIdentity="alertas@warrantly.pt")
    monkeypatch.setattr(settings, "mail_backend", "ses")
    monkeypatch.setattr(settings, "aws_region", REGION)
    monkeypatch.setattr(settings, "mail_from", "Warrantly <alertas@warrantly.pt>")
    monkeypatch.setattr(settings, "smtp_host", None)

    assert mailer.is_configured()
    message = mailer.build_message("ana@warrantly.pt", "Garantia a terminar", "Olá!")
    mailer.send_email(message)
    # Os domínios de exemplo (as contas do smoke test) não recebem email: o SES nem é chamado.
    mailer.send_email(mailer.build_message("smoke-1@example.com", "Confirma", "Olá!"))

    [sent] = ses_backends[DEFAULT_ACCOUNT_ID][REGION].sent_messages
    assert sent.source == "Warrantly <alertas@warrantly.pt>"
    assert "Subject: Garantia a terminar" in sent.raw_data
    assert "ana@warrantly.pt" in sent.raw_data


def test_smtp_without_host_is_not_configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "mail_backend", "smtp")
    monkeypatch.setattr(settings, "smtp_host", None)
    assert not mailer.is_configured()


def test_liveness_does_not_need_the_database(client: TestClient):
    assert client.get("/health/live").json() == {"status": "ok"}


def test_database_pool_setting():
    assert Settings().database_pool == "queue"
    assert Settings(database_pool="null").database_pool == "null"
    with pytest.raises(ValueError):
        Settings(database_pool="outro")
