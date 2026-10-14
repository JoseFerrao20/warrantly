from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Purchase


def make_purchase(**overrides) -> Purchase:
    data = {
        "product_name": "Máquina de lavar",
        "store": "Worten",
        "purchase_date": date(2026, 10, 14),
        "price": Decimal("499.99"),
    }
    return Purchase(**(data | overrides))


def test_default_warranty_is_three_years(db_session: Session):
    purchase = make_purchase()
    db_session.add(purchase)
    db_session.flush()
    db_session.refresh(purchase)

    assert purchase.warranty_months == 36
    assert purchase.warranty_end == date(2029, 10, 14)


@pytest.mark.parametrize(
    ("purchase_date", "warranty_months", "expected_end"),
    [
        (date(2024, 2, 29), 36, date(2027, 2, 28)),  # ano bissexto
        (date(2025, 1, 31), 1, date(2025, 2, 28)),  # fim de mês
        (date(2026, 10, 14), 24, date(2028, 10, 14)),  # garantia de marca ou bem usado
    ],
)
def test_warranty_end_is_computed_from_purchase_date(
    db_session: Session, purchase_date: date, warranty_months: int, expected_end: date
):
    purchase = make_purchase(purchase_date=purchase_date, warranty_months=warranty_months)
    db_session.add(purchase)
    db_session.flush()
    db_session.refresh(purchase)

    assert purchase.warranty_end == expected_end


def test_warranty_end_follows_changes_to_warranty_months(db_session: Session):
    purchase = make_purchase()
    db_session.add(purchase)
    db_session.flush()

    purchase.warranty_months = 12
    db_session.flush()
    db_session.refresh(purchase)

    assert purchase.warranty_end == date(2027, 10, 14)


@pytest.mark.parametrize("overrides", [{"price": Decimal("-1")}, {"warranty_months": 0}])
def test_rejects_invalid_values(db_session: Session, overrides: dict):
    db_session.add(make_purchase(**overrides))

    with pytest.raises(IntegrityError):
        db_session.flush()
