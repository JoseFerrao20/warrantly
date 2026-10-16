from collections.abc import Iterator

from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import settings

# prepare_threshold=None: sem prepared statements no servidor, que falham quando a ligação passa
# por um PgBouncer em modo transação (como o "pooled connection" do Neon).
# DATABASE_POOL=null (no Lambda): sem pool na app; cada pedido abre e fecha a sua ligação e o
# pooler do Neon reaproveita-as. Instâncias do Lambda paradas não ficam com ligações presas.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"prepare_threshold": None},
    **({"poolclass": NullPool} if settings.database_pool == "null" else {}),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


class Base(DeclarativeBase):
    """Base dos modelos SQLAlchemy (usada também pelo Alembic)."""

    # Nomes previsíveis para índices e restrições, para as migrações ficarem estáveis.
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_N_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


def get_session() -> Iterator[Session]:
    """Dependência FastAPI: abre uma sessão por pedido e fecha-a no fim."""
    with SessionLocal() as session:
        yield session
