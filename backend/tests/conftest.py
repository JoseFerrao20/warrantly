from collections.abc import Iterator
from pathlib import Path

import boto3
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from moto import mock_aws
from sqlalchemy.orm import Session

from app import rate_limit, storage
from app.config import settings
from app.db import engine, get_session
from app.main import app
from app.models import User
from app.security import create_access_token, hash_password

BACKEND_DIR = Path(__file__).resolve().parent.parent
TEST_PASSWORD = "palavra-passe-segura"


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Aplica as migrações uma vez antes dos testes (também valida que correm)."""
    command.upgrade(Config(str(BACKEND_DIR / "alembic.ini")), "head")


@pytest.fixture
def db_session() -> Iterator[Session]:
    """Sessão dentro de uma transação que é desfeita no fim de cada teste."""
    with engine.connect() as connection:
        transaction = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
            yield session
        transaction.rollback()


def make_user(session: Session, email: str = "ana@example.com") -> User:
    user = User(email=email, password_hash=hash_password(TEST_PASSWORD))
    session.add(user)
    session.flush()
    return user


def auth_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


@pytest.fixture
def user(db_session: Session) -> User:
    return make_user(db_session)


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    """Cliente HTTP da API a usar a sessão de teste (os dados são desfeitos no fim)."""
    app.dependency_overrides[get_session] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def auth_client(client: TestClient, user: User) -> TestClient:
    """Cliente autenticado como `user`."""
    client.headers.update(auth_headers(user))
    return client


@pytest.fixture(autouse=True)
def upload_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Cada teste guarda as faturas numa pasta temporária própria."""
    directory = tmp_path / "uploads"
    monkeypatch.setattr(settings, "upload_dir", directory)
    return directory


@pytest.fixture(autouse=True)
def reset_rate_limits() -> Iterator[None]:
    """Os limites de tentativas ficam em memória: cada teste começa do zero."""
    rate_limit.reset_all()
    yield
    rate_limit.reset_all()


S3_BUCKET = "warrantly-faturas-teste"


@pytest.fixture
def s3(monkeypatch: pytest.MonkeyPatch, upload_dir: Path) -> Iterator[object]:
    """Faturas no S3 simulado pelo moto (em memória, sem rede e sem a AWS real)."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "teste")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "teste")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with mock_aws():
        client = boto3.client("s3", region_name="eu-west-1")
        client.create_bucket(
            Bucket=S3_BUCKET, CreateBucketConfiguration={"LocationConstraint": "eu-west-1"}
        )
        monkeypatch.setattr(settings, "storage_backend", "s3")
        monkeypatch.setattr(settings, "s3_bucket", S3_BUCKET)
        monkeypatch.setattr(settings, "aws_region", "eu-west-1")
        storage._s3.cache_clear()
        yield client
        storage._s3.cache_clear()


def s3_objects(client) -> list[str]:
    return [o["Key"] for o in client.list_objects_v2(Bucket=S3_BUCKET).get("Contents", [])]


@pytest.fixture(autouse=True)
def no_real_push(monkeypatch: pytest.MonkeyPatch) -> None:
    """Os testes nunca chamam o serviço de push do Expo (quem precisa, simula o `_post`)."""

    def blocked(messages: list[dict]) -> list[dict]:
        raise AssertionError("pedido real ao serviço de push do Expo num teste")

    monkeypatch.setattr("app.push._post", blocked)
