from datetime import date, timedelta

from pathlib import PurePath

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app import storage
from app.config import settings
from app.dependencies import CurrentUser, SessionDep
from app.models import Purchase, User
from app.claims import build_claim
from app.schemas import (
    EXPIRING_SOON_DAYS,
    ClaimRead,
    ClaimRequest,
    PurchaseCreate,
    PurchaseRead,
    PurchaseUpdate,
    WarrantyStatus,
)

router = APIRouter(prefix="/purchases", tags=["purchases"])


def get_purchase_or_404(purchase_id: int, user: User, session: SessionDep) -> Purchase:
    purchase = session.get(Purchase, purchase_id)
    # Uma compra de outro utilizador responde como se não existisse.
    if purchase is None or purchase.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Compra não encontrada")
    return purchase


@router.post("", response_model=PurchaseRead, status_code=status.HTTP_201_CREATED)
def create_purchase(data: PurchaseCreate, user: CurrentUser, session: SessionDep) -> Purchase:
    purchase = Purchase(**data.model_dump(), user_id=user.id)
    session.add(purchase)
    session.commit()
    session.refresh(purchase)
    return purchase


@router.get("", response_model=list[PurchaseRead])
def list_purchases(
    user: CurrentUser,
    session: SessionDep,
    store: str | None = None,
    category: str | None = None,
    warranty_status: WarrantyStatus | None = Query(None, alias="status"),
) -> list[Purchase]:
    """Lista as compras do utilizador, da garantia que expira primeiro para a última."""
    query = (
        select(Purchase)
        .where(Purchase.user_id == user.id)
        .order_by(Purchase.warranty_end, Purchase.id)
    )
    if store is not None:
        query = query.where(Purchase.store == store)
    if category is not None:
        query = query.where(Purchase.category == category)
    if warranty_status is not None:
        today = date.today()
        expiring_limit = today + timedelta(days=EXPIRING_SOON_DAYS)
        if warranty_status == WarrantyStatus.EXPIRED:
            query = query.where(Purchase.warranty_end < today)
        elif warranty_status == WarrantyStatus.EXPIRING:
            query = query.where(Purchase.warranty_end.between(today, expiring_limit))
        else:
            query = query.where(Purchase.warranty_end > expiring_limit)
    return list(session.scalars(query))


@router.get("/{purchase_id}", response_model=PurchaseRead)
def get_purchase(purchase_id: int, user: CurrentUser, session: SessionDep) -> Purchase:
    return get_purchase_or_404(purchase_id, user, session)


@router.patch("/{purchase_id}", response_model=PurchaseRead)
def update_purchase(
    purchase_id: int, data: PurchaseUpdate, user: CurrentUser, session: SessionDep
) -> Purchase:
    purchase = get_purchase_or_404(purchase_id, user, session)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(purchase, field, value)
    session.commit()
    session.refresh(purchase)
    return purchase


@router.delete("/{purchase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase(purchase_id: int, user: CurrentUser, session: SessionDep) -> Response:
    purchase = get_purchase_or_404(purchase_id, user, session)
    invoice_key = purchase.invoice_key
    session.delete(purchase)
    session.commit()
    storage.delete(invoice_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{purchase_id}/invoice", response_model=PurchaseRead)
def upload_invoice(
    purchase_id: int, file: UploadFile, user: CurrentUser, session: SessionDep
) -> Purchase:
    """Carrega a fatura (PDF, JPEG, PNG ou WebP, até 10 MB). Substitui a anterior, se existir."""
    purchase = get_purchase_or_404(purchase_id, user, session)

    data = file.file.read(settings.max_invoice_bytes + 1)
    if len(data) > settings.max_invoice_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"A fatura não pode ter mais de {settings.max_invoice_bytes // (1024 * 1024)} MB",
        )
    content_type = storage.detect_content_type(data)
    if content_type is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="A fatura tem de ser um PDF ou uma imagem (JPEG, PNG ou WebP)",
        )

    old_key = purchase.invoice_key
    new_key = storage.save(data, content_type)
    purchase.invoice_key = new_key
    purchase.invoice_filename = PurePath(file.filename or "").name[:255] or "fatura"
    purchase.invoice_content_type = content_type
    purchase.invoice_size = len(data)
    try:
        session.commit()
    except Exception:
        storage.delete(new_key)
        raise
    storage.delete(old_key)
    session.refresh(purchase)
    return purchase


@router.get("/{purchase_id}/invoice", response_class=FileResponse)
def download_invoice(purchase_id: int, user: CurrentUser, session: SessionDep) -> FileResponse:
    purchase = get_purchase_or_404(purchase_id, user, session)
    path = storage.path_for(purchase.invoice_key) if purchase.invoice_key else None
    if path is None or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Esta compra não tem fatura")
    return FileResponse(
        path,
        media_type=purchase.invoice_content_type,
        filename=purchase.invoice_filename,
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.delete("/{purchase_id}/invoice", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(purchase_id: int, user: CurrentUser, session: SessionDep) -> Response:
    purchase = get_purchase_or_404(purchase_id, user, session)
    if purchase.invoice_key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Esta compra não tem fatura")
    old_key = purchase.invoice_key
    purchase.invoice_key = None
    purchase.invoice_filename = None
    purchase.invoice_content_type = None
    purchase.invoice_size = None
    session.commit()
    storage.delete(old_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{purchase_id}/claim", response_model=ClaimRead)
def generate_claim(
    purchase_id: int, data: ClaimRequest, user: CurrentUser, session: SessionDep
) -> ClaimRead:
    """Gera o texto da reclamação à loja (não envia nada; o utilizador copia ou envia)."""
    purchase = get_purchase_or_404(purchase_id, user, session)
    if not user.full_name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Indica o teu nome no perfil antes de gerar a reclamação",
        )
    today = date.today()
    subject, body = build_claim(purchase, user, data.description, today)
    return ClaimRead(subject=subject, body=body, within_warranty=purchase.warranty_end >= today)
