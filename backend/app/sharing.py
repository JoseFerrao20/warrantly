"""Partilha do arquivo de garantias com a família (ADR 0007).

Quem aceita um convite vê as compras de quem convidou, pode editá-las, abrir a fatura e
reclamar à loja. Apagar compras ou faturas, trocar a fatura, exportar e receber os alertas
ficam só com a dona do arquivo.
"""

from email.message import EmailMessage

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.config import settings
from app.mailer import build_message
from app.models import ArchiveShare, User

# Pessoas com quem cada conta pode partilhar o arquivo (convites pendentes incluídos).
MAX_SHARES = 10


def shared_owner_ids(user: User) -> Select[tuple[int]]:
    """Os donos dos arquivos partilhados com `user` (convites aceites)."""
    return select(ArchiveShare.owner_id).where(
        ArchiveShare.member_id == user.id, ArchiveShare.accepted_at.is_not(None)
    )


def can_access(session: Session, user: User, owner_id: int) -> bool:
    """`user` vê as compras de `owner_id`: são dele ou foram-lhe partilhadas."""
    if owner_id == user.id:
        return True
    return (
        session.scalar(shared_owner_ids(user).where(ArchiveShare.owner_id == owner_id)) is not None
    )


def build_invite_email(owner: User, email: str) -> EmailMessage:
    name = owner.full_name or owner.email
    body = "\n".join(
        [
            "Olá,",
            "",
            f"{name} quer partilhar contigo o arquivo de garantias no Warrantly:",
            "as compras, as faturas e os prazos das garantias.",
            "",
            "Para aceitar, entra (ou cria uma conta com este email) e abre a página da conta:",
            "",
            f"{settings.app_url.rstrip('/')}/conta",
            "",
            "Se não conheces quem te convidou, ignora este email.",
            "",
            "Warrantly",
        ]
    )
    return build_message(email, f"{name} partilhou contigo as garantias no Warrantly", body)
