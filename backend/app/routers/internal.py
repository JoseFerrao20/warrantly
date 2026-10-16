"""Rotas para tarefas agendadas (não são usadas pelo frontend)."""

import secrets
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status

from app import mailer
from app.alerts import send_due_alerts
from app.config import settings
from app.dependencies import SessionDep

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


@router.post("/alerts")
def run_alerts(
    session: SessionDep, authorization: Annotated[str | None, Header()] = None
) -> dict[str, int | list[str]]:
    """Envia os alertas de garantia do dia (o mesmo que `python -m app.alerts`)."""
    token = settings.alerts_token
    if not token:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    if not mailer.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Email não configurado")
    result = send_due_alerts(session, send=mailer.send_email)
    return {
        "emails_sent": result.emails_sent,
        "purchases_alerted": result.purchases_alerted,
        "failed_users": result.failed_users,
    }
