from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.dependencies import CurrentUser, SessionDep
from app.models import Purchase, User
from app.schemas import (
    EXPIRING_SOON_DAYS,
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
    session.delete(purchase)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
