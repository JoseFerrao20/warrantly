"""scripts/preflight.py, com a AWS simulada pelo moto e o `gh` simulado (nunca a AWS real)."""

import importlib.util
import json
from collections.abc import Iterator
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "preflight.py"
spec = importlib.util.spec_from_file_location("preflight", SCRIPT)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

ACCOUNT = "123456789012"  # a conta do moto
REGION = "eu-central-1"
SECRET_VALUES = {
    "SECRET_KEY": "s" * 40,
    "ALERTS_TOKEN": "alerts-token-de-teste-1234567890",
    "ORIGIN_VERIFY_SECRET": "origin-secret-de-teste-12345678",
    "DATABASE_URL": "postgresql://neon:pw@ep-x-pooler.eu-central-1.aws.neon.tech/db?sslmode=require",
}


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch) -> Iterator[boto3.Session]:
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "teste")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "teste")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with mock_aws():
        yield boto3.Session(region_name=REGION)


def bootstrap(session: boto3.Session) -> dict[str, str]:
    """O que o `terraform apply` do infra/bootstrap cria."""
    session.client("s3").create_bucket(
        Bucket=f"warrantly-tfstate-{ACCOUNT}",
        CreateBucketConfiguration={"LocationConstraint": REGION},
    )
    iam = session.client("iam")
    iam.create_open_id_connect_provider(
        Url="https://token.actions.githubusercontent.com",
        ClientIDList=["sts.amazonaws.com"],
        ThumbprintList=["a" * 40],
    )
    arns = {}
    for role, variable in (
        ("warrantly-github-deploy", "AWS_DEPLOY_ROLE_ARN"),
        ("warrantly-github-plan", "AWS_PLAN_ROLE_ARN"),
    ):
        arns[variable] = iam.create_role(RoleName=role, AssumeRolePolicyDocument="{}")["Role"][
            "Arn"
        ]
    session.client("budgets").create_budget(
        AccountId=ACCOUNT,
        Budget={
            "BudgetName": "warrantly-mensal",
            "BudgetLimit": {"Amount": "5", "Unit": "USD"},
            "TimeUnit": "MONTHLY",
            "BudgetType": "COST",
        },
    )
    return arns


def put_secrets(session: boto3.Session, **overrides: str) -> None:
    ssm = session.client("ssm")
    for name, value in (SECRET_VALUES | overrides).items():
        ssm.put_parameter(Name=f"/warrantly/prod/{name}", Value=value, Type="SecureString")


def fake_gh(variables: dict[str, str] | None, secrets: tuple[str, ...] = ("ALERTS_TOKEN",)):
    """O `gh` com estas variáveis e segredos; None = sem o gh (ou sem login)."""

    def run(args: list[str]) -> str | None:
        if variables is None:
            return None
        if args[:2] == ["variable", "list"]:
            return json.dumps([{"name": k, "value": v} for k, v in variables.items()])
        return json.dumps([{"name": name} for name in secrets])

    return run


def github_variables(arns: dict[str, str], **overrides: str) -> dict[str, str]:
    return {
        **arns,
        "TF_STATE_BUCKET": f"warrantly-tfstate-{ACCOUNT}",
        "MAIL_FROM_ADDRESS": "ze@exemplo.pt",
        "ALARM_EMAIL": "ze@exemplo.pt",
    } | overrides


def run(session, gh=None, connect=lambda url: None):
    return preflight.preflight(session, gh=gh or fake_gh(None), connect=connect)


def statuses(report, step: int) -> list[tuple[str, str]]:
    return [(r.status, r.message) for r in report.results if r.step == step]


def test_new_account_points_to_the_bootstrap(aws: boto3.Session):
    report = run(aws)

    assert statuses(report, 1) == [
        ("ok", f"sessão na conta {ACCOUNT}"),
        ("ok", "região eu-central-1"),
    ]
    assert {status for status, _ in statuses(report, 3)} == {"FALTA"}
    assert report.blocking[0].step == 3
    assert "Começa pelo passo 3" in report.render()
    # Sem o gh, o GitHub fica por verificar, mas isso não impede nada.
    assert statuses(report, 5)[0][0] == "--"


def test_everything_ready_before_the_first_deploy(aws: boto3.Session):
    arns = bootstrap(aws)
    put_secrets(aws)

    report = run(aws, fake_gh(github_variables(arns)))

    assert report.blocking == []
    output = report.render()
    assert "Tudo o que o deploy precisa está pronto" in output
    # Antes do deploy, o APP_URL e o SES ainda não existem: são avisos, não erros.
    assert "sem APP_URL (normal antes do primeiro deploy)" in output
    assert "o SES ainda não conhece ze@exemplo.pt" in output
    for value in SECRET_VALUES.values():
        assert value not in output  # os segredos nunca aparecem


def test_missing_secret_tells_how_to_create_it(aws: boto3.Session):
    bootstrap(aws)
    put_secrets(aws)
    aws.client("ssm").delete_parameter(Name="/warrantly/prod/ORIGIN_VERIFY_SECRET")

    report = run(aws)

    [missing] = report.blocking
    assert missing.message == "falta /warrantly/prod/ORIGIN_VERIFY_SECRET"
    assert "aws ssm put-parameter --type SecureString" in missing.hint


def test_weak_or_repeated_secrets_and_a_plain_parameter(aws: boto3.Session):
    bootstrap(aws)
    put_secrets(aws, SECRET_KEY="curta", ALERTS_TOKEN=SECRET_VALUES["ORIGIN_VERIFY_SECRET"])
    ssm = aws.client("ssm")
    ssm.put_parameter(
        Name="/warrantly/prod/DATABASE_URL",
        Value="postgresql://neon:pw@ep-x.eu-central-1.aws.neon.tech/db",
        Type="String",
        Overwrite=True,
    )

    messages = [(r.status, r.message) for r in run(aws).results if r.step == 4]

    assert ("FALTA", "a SECRET_KEY tem menos de 32 caracteres") in messages
    assert ("FALTA", "há tokens repetidos: cada segredo tem de ter um valor diferente") in messages
    assert ("FALTA", "/warrantly/prod/DATABASE_URL não está cifrado (String)") in messages
    assert (
        "AVISO",
        "o DATABASE_URL não é o do pooler do Neon (o host não tem -pooler)",
    ) in messages
    assert ("AVISO", "o DATABASE_URL não tem sslmode=require") in messages


def test_neon_must_answer(aws: boto3.Session):
    bootstrap(aws)
    put_secrets(aws)

    def refuse(url: str) -> None:
        raise ConnectionRefusedError

    report = run(aws, connect=refuse)

    [missing] = report.blocking
    assert missing.message == "não foi possível ligar ao Neon (ConnectionRefusedError)"


def test_connects_to_postgres_with_the_url_from_ssm():
    from app.config import settings

    # O endereço como o Neon o dá (postgresql://), contra o Postgres dos testes.
    preflight.connect_postgres(settings.database_url)


def test_github_variables_must_match_the_aws(aws: boto3.Session):
    arns = bootstrap(aws)
    put_secrets(aws)
    variables = github_variables(arns, TF_STATE_BUCKET="outro-bucket")
    del variables["MAIL_FROM_ADDRESS"]

    report = run(aws, fake_gh(variables, secrets=()))

    assert [r.message for r in report.blocking] == [
        "a variável TF_STATE_BUCKET não bate certo com a AWS",
        "falta a variável MAIL_FROM_ADDRESS",
        "falta o segredo ALERTS_TOKEN",
    ]
    assert report.blocking[0].hint.endswith(f": warrantly-tfstate-{ACCOUNT}")


def test_region_must_be_the_one_of_the_deploy(aws: boto3.Session):
    arns = bootstrap(aws)
    put_secrets(aws)

    report = run(aws, fake_gh(github_variables(arns, AWS_REGION="eu-west-1")))

    [missing] = report.blocking
    assert missing.step == 1
    assert missing.message == "a sessão está na região eu-central-1, e o deploy usa eu-west-1"


def test_without_aws_session(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "teste")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "teste")

    class NoCredentials:
        region_name = REGION

        def client(self, name: str):
            assert name == "sts", "sem sessão, não se pergunta mais nada à AWS"
            raise RuntimeError("Token has expired")

    report = run(NoCredentials())

    [missing] = report.blocking
    assert missing.message == "sem sessão na AWS (RuntimeError)"
    assert "aws sso login" in missing.hint


class FakeSES:
    def __init__(self, verified: bool, production: bool) -> None:
        self.verified = verified
        self.production = production

    def get_email_identity(self, EmailIdentity: str) -> dict:  # noqa: N803 (nome do boto3)
        return {"VerifiedForSendingStatus": self.verified}

    def get_account(self) -> dict:
        return {"ProductionAccessEnabled": self.production}


class WithSES:
    """A sessão do moto, com o SES simulado aqui (o moto não tem o get_account)."""

    def __init__(self, session: boto3.Session, ses: FakeSES) -> None:
        self.session = session
        self.ses = ses
        self.region_name = session.region_name

    def client(self, name: str):
        return self.ses if name == "sesv2" else self.session.client(name)


@pytest.mark.parametrize(
    ("verified", "production", "expected"),
    [
        (
            False,
            False,
            [
                ("AVISO", "ze@exemplo.pt ainda não foi confirmado"),
                ("AVISO", "o SES está no sandbox: só envia para emails confirmados no SES"),
            ],
        ),
        (
            True,
            True,
            [
                ("ok", "ze@exemplo.pt confirmado no SES"),
                ("ok", "o SES pode enviar para qualquer email (fora do sandbox)"),
            ],
        ),
    ],
)
def test_ses_after_the_deploy(aws: boto3.Session, verified, production, expected):
    arns = bootstrap(aws)
    put_secrets(aws)
    variables = github_variables(arns, APP_URL="https://d1.cloudfront.net")

    report = run(WithSES(aws, FakeSES(verified, production)), fake_gh(variables))

    assert report.blocking == []  # depois do deploy, só avisos
    assert statuses(report, 6) == [("ok", "variável APP_URL (https://d1.cloudfront.net)")]
    assert statuses(report, 7) == expected
