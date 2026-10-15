from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field, model_validator

from app.models.purchase import DEFAULT_WARRANTY_MONTHS

# Uma garantia passa a "a expirar" quando faltam 60 dias ou menos (o primeiro alerta por email).
EXPIRING_SOON_DAYS = 60


class WarrantyStatus(StrEnum):
    ACTIVE = "active"
    EXPIRING = "expiring"
    EXPIRED = "expired"


def warranty_status(warranty_end: date, today: date | None = None) -> WarrantyStatus:
    today = today or date.today()
    if warranty_end < today:
        return WarrantyStatus.EXPIRED
    if warranty_end <= today + timedelta(days=EXPIRING_SOON_DAYS):
        return WarrantyStatus.EXPIRING
    return WarrantyStatus.ACTIVE


Name = Annotated[str, Field(min_length=1, max_length=200)]
Category = Annotated[str, Field(min_length=1, max_length=100)]
InvoiceNumber = Annotated[str, Field(min_length=1, max_length=100)]
StoreEmail = Annotated[EmailStr, Field(max_length=320)]
FullName = Annotated[str, Field(min_length=1, max_length=200)]
Price = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]
WarrantyMonths = Annotated[int, Field(gt=0, le=1200)]


class PurchaseCreate(BaseModel):
    product_name: Name
    store: Name
    category: Category | None = None
    purchase_date: date
    price: Price
    warranty_months: WarrantyMonths = DEFAULT_WARRANTY_MONTHS
    invoice_number: InvoiceNumber | None = None
    store_email: StoreEmail | None = None


class PurchaseUpdate(BaseModel):
    """Atualização parcial: só os campos enviados são alterados."""

    product_name: Name | None = None
    store: Name | None = None
    category: Category | None = None
    purchase_date: date | None = None
    price: Price | None = None
    warranty_months: WarrantyMonths | None = None
    invoice_number: InvoiceNumber | None = None
    store_email: StoreEmail | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "PurchaseUpdate":
        # Omitir um campo deixa-o como está; enviá-lo a null só é válido nos campos opcionais.
        nullable = {"category", "invoice_number", "store_email"}
        nulls = [f for f in self.model_fields_set if getattr(self, f) is None and f not in nullable]
        if nulls:
            raise ValueError(f"Campos que não podem ser null: {', '.join(sorted(nulls))}")
        return self


class PurchaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_name: str
    store: str
    category: str | None
    purchase_date: date
    price: Decimal
    warranty_months: int
    warranty_end: date
    invoice_number: str | None
    store_email: str | None
    invoice_filename: str | None
    invoice_content_type: str | None
    invoice_size: int | None
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def status(self) -> WarrantyStatus:
        return warranty_status(self.warranty_end)


class UserCreate(BaseModel):
    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=8, max_length=128)
    full_name: FullName | None = None


class UserUpdate(BaseModel):
    full_name: FullName | None = None


class AccountDelete(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str | None
    created_at: datetime


class ClaimRequest(BaseModel):
    description: str = Field(min_length=1, max_length=2000)


class ClaimRead(BaseModel):
    subject: str
    body: str
    within_warranty: bool


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
