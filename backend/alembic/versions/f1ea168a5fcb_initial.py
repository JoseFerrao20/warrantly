"""initial

Revision ID: f1ea168a5fcb
Revises:
Create Date: 2026-10-14 15:32:26.420624

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "f1ea168a5fcb"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
