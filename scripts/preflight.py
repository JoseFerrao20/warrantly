"""Antes do primeiro deploy: confirma o que o docs/cloud.md manda criar, passo a passo.

    aws sso login
    python3 scripts/preflight.py

Corre do teu computador, com a sessão da AWS (perfil do `aws configure sso`) e, se puder, com
o `gh` (GitHub CLI) autenticado. Verifica, pela ordem do roteiro:

- passo 1: a sessão da AWS e a região;
- passo 3: o bootstrap (bucket do estado, papéis do GitHub, OIDC e orçamento);
- passo 4: os segredos no SSM (existem, são diferentes, a SECRET_KEY é longa e o Neon responde);
- passo 5: as variáveis e o segredo no GitHub, e se batem certo com a AWS;
- passos 6 e 7, depois do deploy: o APP_URL e o email do SES (confirmado, sandbox).

Não muda nada e nunca mostra o valor de um segredo. Termina com 1 se faltar alguma coisa
antes do deploy; os avisos não contam. Precisa do boto3 e, para ligar ao Neon, do psycopg:
o Python do dev container (ou o .venv do backend) tem os dois.
"""

import argparse
import json
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field

DEFAULT_REGION = "eu-central-1"
DEFAULT_REPO = "JoseFerrao20/warrantly"
SSM_PATH = "/warrantly/prod/"
TOKENS = ("SECRET_KEY", "ALERTS_TOKEN", "ORIGIN_VERIFY_SECRET")
DEPLOY_ROLE = "warrantly-github-deploy"
PLAN_ROLE = "warrantly-github-plan"
BUDGET = "warrantly-mensal"
GITHUB_OIDC = "token.actions.githubusercontent.com"

STEPS = {
    1: "Conta AWS",
    3: "Bootstrap (infra/bootstrap)",
    4: "Segredos no SSM",
    5: "GitHub: variáveis e segredo",
    6: "Depois do primeiro deploy",
    7: "SES",
}
# Os passos 6 e 7 só se fazem depois do deploy: o que lá falta é aviso, nunca erro.
AFTER_DEPLOY = {6, 7}

KEYGEN_COMMAND = 'python -c "import secrets; print(secrets.token_urlsafe(32))"'

# `gh` com os argumentos dados: devolve o stdout, ou None se falhar (não instalado, sem login).
GhRunner = Callable[[list[str]], str | None]


@dataclass
class Result:
    step: int
    status: str  # "ok", "FALTA", "AVISO" ou "--" (não verificado)
    message: str
    hint: str = ""


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)

    def ok(self, step: int, message: str) -> None:
        self.results.append(Result(step, "ok", message))

    def missing(self, step: int, message: str, hint: str) -> None:
        status = "AVISO" if step in AFTER_DEPLOY else "FALTA"
        self.results.append(Result(step, status, message, hint))

    def warn(self, step: int, message: str, hint: str = "") -> None:
        self.results.append(Result(step, "AVISO", message, hint))

    def skip(self, step: int, message: str, hint: str = "") -> None:
        self.results.append(Result(step, "--", message, hint))

    @property
    def blocking(self) -> list[Result]:
        return [r for r in self.results if r.status == "FALTA"]

    def render(self) -> str:
        lines = []
        for step, title in STEPS.items():
            results = [r for r in self.results if r.step == step]
            if not results:
                continue
            lines.append(f"\nPasso {step} · {title}")
            for r in results:
                lines.append(f"  {r.status:<6} {r.message}")
                if r.hint:
                    lines.append(f"         → {r.hint}")
        lines.append("")
        if self.blocking:
            first = self.blocking[0].step
            lines.append(
                f"Falta(m) {len(self.blocking)} coisa(s). Começa pelo passo {first} do "
                "docs/cloud.md e volta a correr este script."
            )
        else:
            lines.append(
                "Tudo o que o deploy precisa está pronto: Actions → Deploy → Run workflow "
                "(passo 6 do docs/cloud.md)."
            )
        return "\n".join(lines)


# --- AWS ----------------------------------------------------------------------------------------


def check_account(session, report: Report, deploy_region: str) -> str | None:
    """Passo 1. Devolve o número da conta, ou None sem sessão (o resto da AWS fica por ver)."""
    try:
        identity = session.client("sts").get_caller_identity()
    except Exception as exc:  # sem credenciais, sessão SSO expirada, perfil errado
        report.missing(
            1,
            f"sem sessão na AWS ({type(exc).__name__})",
            "export AWS_PROFILE=warrantly && aws sso login (passo 1 do docs/cloud.md)",
        )
        return None
    account = identity["Account"]
    report.ok(1, f"sessão na conta {account}")
    if identity["Arn"].endswith(":root"):
        report.warn(
            1,
            "estás a usar o utilizador root",
            "usa o utilizador do IAM Identity Center (aws configure sso)",
        )
    # O bootstrap e os segredos têm de ficar na região onde o GitHub faz o deploy.
    region = session.region_name
    if region == deploy_region:
        report.ok(1, f"região {region}")
    else:
        report.missing(
            1,
            f"a sessão está na região {region or '(nenhuma)'}, e o deploy usa {deploy_region}",
            f"export AWS_REGION={deploy_region}, ou a variável AWS_REGION no GitHub (passo 5)",
        )
    return account


def check_bootstrap(session, report: Report, account: str) -> dict[str, str]:
    """Passo 3. Devolve o que o GitHub tem de ter: o bucket e os ARN dos papéis."""
    expected: dict[str, str] = {}
    hint = "cd infra/bootstrap && terraform init && terraform apply"
    bucket = f"warrantly-tfstate-{account}"
    try:
        session.client("s3").head_bucket(Bucket=bucket)
        report.ok(3, f"bucket do estado {bucket}")
        expected["TF_STATE_BUCKET"] = bucket
    except Exception:
        report.missing(3, f"não existe o bucket do estado {bucket}", hint)

    iam = session.client("iam")
    for role, variable in ((DEPLOY_ROLE, "AWS_DEPLOY_ROLE_ARN"), (PLAN_ROLE, "AWS_PLAN_ROLE_ARN")):
        try:
            arn = iam.get_role(RoleName=role)["Role"]["Arn"]
            report.ok(3, f"papel {role}")
            expected[variable] = arn
        except Exception:
            report.missing(3, f"não existe o papel {role}", hint)

    providers = iam.list_open_id_connect_providers()["OpenIDConnectProviderList"]
    if any(p["Arn"].endswith(f"/{GITHUB_OIDC}") for p in providers):
        report.ok(3, "o GitHub Actions pode entrar na AWS (OIDC)")
    else:
        report.missing(3, "falta o fornecedor OIDC do GitHub", hint)

    try:
        session.client("budgets").describe_budget(AccountId=account, BudgetName=BUDGET)
        report.ok(3, f"orçamento {BUDGET}")
    except Exception:
        report.missing(3, f"não existe o orçamento {BUDGET}", hint)
    return expected


def check_secrets(session, report: Report, connect: Callable[[str], None] | None) -> None:
    """Passo 4. Lê os valores para os validar, mas nunca os mostra."""
    ssm = session.client("ssm")
    values: dict[str, str] = {}
    for name in (*TOKENS, "DATABASE_URL"):
        path = SSM_PATH + name
        try:
            parameter = ssm.get_parameter(Name=path, WithDecryption=True)["Parameter"]
        except ssm.exceptions.ParameterNotFound:
            value = KEYGEN_COMMAND if name != "DATABASE_URL" else "'<connection string do Neon>'"
            report.missing(
                4,
                f"falta {path}",
                f"aws ssm put-parameter --type SecureString --name {path} --value {value}",
            )
            continue
        values[name] = parameter["Value"]
        if parameter["Type"] != "SecureString":
            report.missing(
                4,
                f"{path} não está cifrado ({parameter['Type']})",
                "apaga-o (aws ssm delete-parameter) e cria-o outra vez com --type SecureString",
            )
        else:
            report.ok(4, path)

    if len(values.get("SECRET_KEY", "x" * 32)) < 32:
        report.missing(
            4, "a SECRET_KEY tem menos de 32 caracteres", f"gera outra com {KEYGEN_COMMAND}"
        )
    tokens = [values[t] for t in TOKENS if t in values]
    if len(set(tokens)) < len(tokens):
        report.missing(
            4,
            "há tokens repetidos: cada segredo tem de ter um valor diferente",
            f"gera um novo para cada um com {KEYGEN_COMMAND} (aws ssm put-parameter --overwrite)",
        )

    url = values.get("DATABASE_URL")
    if url is None:
        return
    if not url.startswith(("postgres://", "postgresql://", "postgresql+psycopg://")):
        report.missing(4, "o DATABASE_URL não é um endereço do Postgres", "copia-o do Neon")
        return
    if "-pooler" not in url:
        report.warn(
            4,
            "o DATABASE_URL não é o do pooler do Neon (o host não tem -pooler)",
            'no Neon, em "Connect", ativa "Connection pooling" e copia esse endereço',
        )
    if "sslmode=require" not in url:
        report.warn(4, "o DATABASE_URL não tem sslmode=require", "copia-o outra vez do Neon")
    if connect is None:
        report.skip(4, "ligação ao Neon não verificada", "falta o psycopg (o .venv do backend)")
        return
    try:
        connect(url)
        report.ok(4, "o Neon responde com o DATABASE_URL")
    except Exception as exc:
        report.missing(
            4,
            f"não foi possível ligar ao Neon ({type(exc).__name__})",
            "confirma o endereço e a palavra-passe no Neon, e que o projeto não está apagado",
        )


def connect_postgres(url: str) -> None:
    import psycopg

    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(url, connect_timeout=10) as conn:
        conn.execute("SELECT 1")


def check_ses(session, report: Report, sender: str | None) -> None:
    """Passo 7: só existe depois do primeiro deploy (o Terraform cria a identidade)."""
    if not sender:
        report.skip(7, "sem MAIL_FROM_ADDRESS no GitHub, não há email para verificar")
        return
    ses = session.client("sesv2")
    try:
        identity = ses.get_email_identity(EmailIdentity=sender)
    except Exception:
        report.skip(7, f"o SES ainda não conhece {sender}", "o primeiro deploy cria-o")
        return
    if identity.get("VerifiedForSendingStatus"):
        report.ok(7, f"{sender} confirmado no SES")
    else:
        report.missing(
            7,
            f"{sender} ainda não foi confirmado",
            "abre o email da AWS com o assunto 'Amazon Web Services – Email Address "
            "Verification Request' e carrega no link",
        )
    try:
        production = ses.get_account().get("ProductionAccessEnabled", False)
    except Exception:
        return
    if production:
        report.ok(7, "o SES pode enviar para qualquer email (fora do sandbox)")
    else:
        report.warn(
            7,
            "o SES está no sandbox: só envia para emails confirmados no SES",
            "chega para testar; antes de convidar outras pessoas, pede a saída "
            "(passo 7 do docs/cloud.md)",
        )


# --- GitHub -------------------------------------------------------------------------------------


def run_gh(args: list[str]) -> str | None:
    gh = shutil.which("gh")
    if gh is None:
        return None
    result = subprocess.run([gh, *args], capture_output=True, text=True, check=False)  # noqa: S603 (o gh do PATH, com argumentos fixos)
    return result.stdout if result.returncode == 0 else None


@dataclass
class GitHub:
    variables: dict[str, str]  # nomes e valores (as variáveis não são segredos)
    secrets: set[str]  # só os nomes: o GitHub nunca devolve o valor de um segredo


def load_github(gh: GhRunner, repo: str) -> GitHub | None:
    variables_json = gh(["variable", "list", "--repo", repo, "--json", "name,value"])
    secrets_json = gh(["secret", "list", "--repo", repo, "--json", "name"])
    if variables_json is None or secrets_json is None:
        return None
    return GitHub(
        {v["name"]: v["value"] for v in json.loads(variables_json)},
        {s["name"] for s in json.loads(secrets_json)},
    )


def check_github(
    report: Report, github: GitHub | None, repo: str, expected: dict[str, str]
) -> None:
    """Passo 5, e o APP_URL do passo 6."""
    if github is None:
        report.skip(
            5,
            "variáveis do GitHub não verificadas (sem o gh, ou sem gh auth login)",
            f"confirma à mão em github.com/{repo}/settings/variables/actions",
        )
        return
    variables, secrets = github.variables, github.secrets

    where = "Settings → Secrets and variables → Actions → Variables"
    for name in ("AWS_DEPLOY_ROLE_ARN", "AWS_PLAN_ROLE_ARN", "TF_STATE_BUCKET"):
        value = variables.get(name)
        want = expected.get(name)
        if value is None:
            report.missing(
                5, f"falta a variável {name}", f"{where}: {want or 'o output do bootstrap'}"
            )
        elif want is not None and value != want:
            report.missing(5, f"a variável {name} não bate certo com a AWS", f"{where}: {want}")
        else:
            report.ok(5, f"variável {name}")

    if "MAIL_FROM_ADDRESS" in variables:
        report.ok(5, f"variável MAIL_FROM_ADDRESS ({variables['MAIL_FROM_ADDRESS']})")
    else:
        report.missing(
            5, "falta a variável MAIL_FROM_ADDRESS", f"{where}: o email que envia os alertas"
        )
    if "ALARM_EMAIL" not in variables:
        report.warn(
            5,
            "sem ALARM_EMAIL: os alarmes do CloudWatch não chegam a ninguém",
            f"{where}: o teu email (opcional)",
        )
    if "ALERTS_TOKEN" in secrets:
        report.ok(5, "segredo ALERTS_TOKEN (o valor não se consegue ler: confirma que é o do SSM)")
    else:
        report.missing(
            5,
            "falta o segredo ALERTS_TOKEN",
            "Settings → Secrets and variables → Actions → Secrets: o mesmo valor do SSM",
        )

    if "APP_URL" in variables:
        report.ok(6, f"variável APP_URL ({variables['APP_URL']})")
    else:
        report.missing(
            6,
            "sem APP_URL (normal antes do primeiro deploy)",
            f"depois do deploy, {where}: o endereço https://<id>.cloudfront.net",
        )


# --- Principal ----------------------------------------------------------------------------------


def preflight(
    session,
    gh: GhRunner = run_gh,
    repo: str = DEFAULT_REPO,
    connect: Callable[[str], None] | None = connect_postgres,
) -> Report:
    report = Report()
    github = load_github(gh, repo)
    variables = github.variables if github else {}
    account = check_account(session, report, variables.get("AWS_REGION", DEFAULT_REGION))
    expected: dict[str, str] = {}
    if account is not None:
        expected = check_bootstrap(session, report, account)
        check_secrets(session, report, connect)
    check_github(report, github, repo, expected)
    if account is not None:
        check_ses(session, report, variables.get("MAIL_FROM_ADDRESS"))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=DEFAULT_REPO, help="repositório no GitHub (dono/nome)")
    args = parser.parse_args()
    try:
        import boto3
    except ImportError:
        print("Falta o boto3: corre no dev container, ou com o Python onde está o backend.")
        return 1
    try:
        import psycopg  # noqa: F401
    except ImportError:
        connect = None
    else:
        connect = connect_postgres
    try:
        session = boto3.Session()
    except Exception as exc:  # AWS_PROFILE com um perfil que não existe
        print(f"Não foi possível abrir a sessão da AWS: {exc}")
        print("→ aws configure sso (perfil warrantly) e export AWS_PROFILE=warrantly")
        return 1
    report = preflight(session, repo=args.repo, connect=connect)
    print(report.render())
    return 1 if report.blocking else 0


if __name__ == "__main__":
    sys.exit(main())
