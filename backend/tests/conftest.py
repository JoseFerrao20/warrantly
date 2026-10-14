from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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
