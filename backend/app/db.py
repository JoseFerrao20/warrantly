from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


class Base(DeclarativeBase):
    """Base dos modelos SQLAlchemy (usada também pelo Alembic)."""


def get_session() -> Iterator[Session]:
    """Dependência FastAPI: abre uma sessão por pedido e fecha-a no fim."""
    with SessionLocal() as session:
        yield session
