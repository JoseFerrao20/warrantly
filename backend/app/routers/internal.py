"""Rotas para tarefas agendadas (não são usadas pelo frontend)."""

import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from app import mailer
from app.alerts import send_due_alerts
from app.config import settings
from app.dependencies import SessionDep

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


def _run_alerts(session: SessionDep) -> dict[str, int | list[str]]:
    if not mailer.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Email não configurado")
    result = send_due_alerts(session, send=mailer.send_email)
    return {
        "emails_sent": result.emails_sent,
        "pushes_sent": result.pushes_sent,
        "purchases_alerted": result.purchases_alerted,
        "failed_users": result.failed_users,
    }


@router.post("/alerts")
def run_alerts(
    session: SessionDep, authorization: Annotated[str | None, Header()] = None
) -> dict[str, int | list[str]]:
    """Envia os alertas de garantia do dia (o mesmo que `python -m app.alerts`), à mão."""
    token = settings.alerts_token
    if not token:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not authorization or not secrets.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return _run_alerts(session)


class ScheduledEvent(BaseModel):
    """O `input` do agendamento no EventBridge Scheduler (infra/app/scheduler.tf)."""

    task: Literal["alerts"]


@router.post("/events")
def run_scheduled_event(
    event: ScheduledEvent,
    session: SessionDep,
    x_amzn_lambda_context: Annotated[str | None, Header()] = None,
    x_amzn_request_context: Annotated[str | None, Header()] = None,
) -> dict[str, int | list[str]]:
    """Eventos do Lambda que não são pedidos HTTP (ex.: o agendamento diário dos alertas).

    O Lambda Web Adapter entrega-os aqui (`AWS_LWA_PASS_THROUGH_PATH`) como um POST. Um pedido
    HTTP que chegue pela Function URL traz sempre o contexto do pedido (`x-amzn-request-context`,
    posto pelo adapter), por isso só se aceitam pedidos com o contexto do Lambda e sem o de um
    pedido HTTP: quem chama tem de ter permissão para invocar o Lambda (o papel do Scheduler).
    Os alertas não se repetem no mesmo dia, por isso, mesmo que alguém conseguisse chamar isto,
    só anteciparia os avisos desse dia.
    """
    if x_amzn_lambda_context is None or x_amzn_request_context is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN)
    return _run_alerts(session)
