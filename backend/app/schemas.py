from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Literal

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
    # A dona da compra: com a partilha do arquivo, pode ser outra pessoa (ADR 0007).
    user_id: int
    owner_name: str
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


class PasswordResetRequest(BaseModel):
    email: EmailStr = Field(max_length=320)


class EmailVerification(BaseModel):
    token: str = Field(max_length=1000)


class PasswordResetConfirm(BaseModel):
    token: str = Field(max_length=1000)
    password: str = Field(min_length=8, max_length=128)


# Token do Expo: "ExponentPushToken[xxxx]" (ou "ExpoPushToken[xxxx]").
PUSH_TOKEN_PATTERN = r"^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$"  # noqa: S105 (não é uma palavra-passe)


class PushTokenCreate(BaseModel):
    token: str = Field(pattern=PUSH_TOKEN_PATTERN, max_length=255)
    platform: Literal["ios", "android"]


class PushTokenDelete(BaseModel):
    token: str = Field(max_length=255)


class AccountDelete(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str | None
    email_verified: bool
    created_at: datetime


class ClaimRequest(BaseModel):
    description: str = Field(min_length=1, max_length=2000)


class ClaimRead(BaseModel):
    subject: str
    body: str
    within_warranty: bool


class InvoiceScanRead(BaseModel):
    """Sugestões lidas da fatura (cada campo a null se não foi encontrado)."""

    text_found: bool  # False: a fatura não tinha texto nem QR legíveis (ou não há OCR)
    ocr_available: bool  # o servidor tem o Tesseract para ler fotografias
    product_name: str | None
    store: str | None
    purchase_date: date | None
    price: Decimal | None
    invoice_number: str | None
    store_email: str | None


class UploadTicketRead(BaseModel):
    """Upload direto para o S3: o browser faz POST de `fields` + o ficheiro para `url`."""

    direct: bool
    max_bytes: int
    token: str | None = None
    url: str | None = None
    fields: dict[str, str] | None = None


class UploadAttach(BaseModel):
    token: str = Field(pattern=r"^[0-9a-f]{32}$")
    filename: str = Field(min_length=1, max_length=255)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 (não é uma palavra-passe)
    expires_in: int | None = None
    # Só para a app móvel; no browser, o refresh token vai num cookie httpOnly.
    refresh_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=200)


class SessionRead(BaseModel):
    """Uma sessão (um aparelho com login feito) na página da conta."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    device: str
    created_at: datetime
    last_used_at: datetime
    current: bool = False  # a sessão deste pedido ("este aparelho")


class SessionsEnded(BaseModel):
    ended: int


class ShareCreate(BaseModel):
    email: EmailStr = Field(max_length=320)


class ShareRead(BaseModel):
    """Uma pessoa com quem partilho o arquivo (convite pendente ou aceite)."""

    id: int
    email: str
    accepted: bool
    created_at: datetime


class SharedArchiveRead(BaseModel):
    """Um arquivo partilhado comigo (convite por aceitar, ou aceite)."""

    id: int
    owner_name: str
    owner_email: str
    accepted: bool
    created_at: datetime


class SharingRead(BaseModel):
    members: list[ShareRead]
    shared_with_me: list[SharedArchiveRead]
