"""Tokens das notificações push da app móvel (um por telemóvel)."""

from fastapi import APIRouter, Response, status
from sqlalchemy import delete, select

from app.dependencies import CurrentUser, SessionDep
from app.models import PushToken
from app.schemas import PushTokenCreate, PushTokenDelete

router = APIRouter(prefix="/push-tokens", tags=["push"])


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
def register_push_token(data: PushTokenCreate, user: CurrentUser, session: SessionDep) -> Response:
    """Guarda o token deste telemóvel. Se já existia (de outra conta), passa a ser desta."""
    push_token = session.scalar(select(PushToken).where(PushToken.token == data.token))
    if push_token is None:
        session.add(PushToken(user_id=user.id, token=data.token, platform=data.platform))
    else:
        push_token.user_id = user.id
        push_token.platform = data.platform
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_push_token(data: PushTokenDelete, user: CurrentUser, session: SessionDep) -> Response:
    """Ao sair da conta no telemóvel: deixa de receber alertas nesse aparelho."""
    session.execute(
        delete(PushToken).where(PushToken.token == data.token, PushToken.user_id == user.id)
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
