import logging
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, or_, select

from app import mailer, rate_limit, sharing
from app.dependencies import CurrentUser, SessionDep
from app.models import ArchiveShare, User
from app.routers.auth import check_limits
from app.schemas import ShareCreate, SharedArchiveRead, ShareRead, SharingRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sharing", tags=["sharing"])


def share_read(share: ArchiveShare) -> ShareRead:
    return ShareRead(
        id=share.id,
        email=share.email,
        accepted=share.accepted_at is not None,
        created_at=share.created_at,
    )


@router.get("", response_model=SharingRead)
def list_shares(user: CurrentUser, session: SessionDep) -> SharingRead:
    """Com quem partilho o meu arquivo, e os arquivos partilhados comigo."""
    members = session.scalars(
        select(ArchiveShare).where(ArchiveShare.owner_id == user.id).order_by(ArchiveShare.id)
    )
    received = session.execute(
        select(ArchiveShare, User)
        .join(User, User.id == ArchiveShare.owner_id)
        .where(ArchiveShare.email == user.email)
        .order_by(ArchiveShare.id)
    )
    return SharingRead(
        members=[share_read(share) for share in members],
        shared_with_me=[
            SharedArchiveRead(
                id=share.id,
                owner_name=owner.full_name or owner.email,
                owner_email=owner.email,
                accepted=share.accepted_at is not None,
                created_at=share.created_at,
            )
            for share, owner in received
        ],
    )


@router.post("", response_model=ShareRead, status_code=status.HTTP_201_CREATED)
def invite(data: ShareCreate, user: CurrentUser, session: SessionDep) -> ShareRead:
    """Convida alguém, pelo email, a ver o meu arquivo. A resposta não diz se a conta existe."""
    email = data.email.lower()
    if email == user.email:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Não podes partilhar o arquivo contigo"
        )
    exists = session.scalar(
        select(ArchiveShare.id).where(ArchiveShare.owner_id == user.id, ArchiveShare.email == email)
    )
    if exists is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Já partilhaste o arquivo com este email"
        )
    count = session.scalar(
        select(func.count()).select_from(ArchiveShare).where(ArchiveShare.owner_id == user.id)
    )
    if count >= sharing.MAX_SHARES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Só podes partilhar o arquivo com {sharing.MAX_SHARES} pessoas",
        )
    key = str(user.id)
    check_limits(session, (rate_limit.share_invites_user, key))
    rate_limit.share_invites_user.hit(session, key)
    share = ArchiveShare(owner_id=user.id, email=email)
    session.add(share)
    session.commit()
    session.refresh(share)
    if mailer.is_configured():
        try:
            mailer.send_email(sharing.build_invite_email(user, email))
        except Exception:
            # O convite fica feito: a pessoa também o vê na página da conta.
            logger.exception("Falhou o email do convite para o arquivo")
    return share_read(share)


def share_or_404(share_id: int, user: User, session: SessionDep) -> ArchiveShare:
    """Um convite feito por mim ou para mim; os outros respondem como se não existissem."""
    share = session.scalar(
        select(ArchiveShare).where(
            ArchiveShare.id == share_id,
            or_(ArchiveShare.owner_id == user.id, ArchiveShare.email == user.email),
        )
    )
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Partilha não encontrada")
    return share


@router.post("/{share_id}/accept", response_model=SharedArchiveRead)
def accept(share_id: int, user: CurrentUser, session: SessionDep) -> SharedArchiveRead:
    share = share_or_404(share_id, user, session)
    if share.email != user.email:  # só quem foi convidado aceita
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Partilha não encontrada")
    if share.accepted_at is None:
        share.member_id = user.id
        share.accepted_at = datetime.now(UTC)
        session.commit()
    owner = session.get_one(User, share.owner_id)
    return SharedArchiveRead(
        id=share.id,
        owner_name=owner.full_name or owner.email,
        owner_email=owner.email,
        accepted=True,
        created_at=share.created_at,
    )


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove(share_id: int, user: CurrentUser, session: SessionDep) -> Response:
    """A dona deixa de partilhar, ou quem foi convidado recusa (ou sai do arquivo)."""
    session.delete(share_or_404(share_id, user, session))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
