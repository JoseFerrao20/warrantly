import tempfile
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import PurePath
from typing import IO
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select

from app import invoice_scan, sharing, storage
from app.claim_pdf import build_claim_pdf
from app.claims import build_claim
from app.config import settings
from app.dependencies import CurrentUser, SessionDep
from app.export import write_export
from app.models import Purchase, User
from app.observability import metric
from app.schemas import (
    EXPIRING_SOON_DAYS,
    ClaimRead,
    ClaimRequest,
    InvoiceScanRead,
    PurchaseCreate,
    PurchaseRead,
    PurchaseUpdate,
    UploadAttach,
    UploadTicketRead,
    WarrantyStatus,
)

router = APIRouter(prefix="/purchases", tags=["purchases"])


def get_purchase_or_404(
    purchase_id: int, user: User, session: SessionDep, *, owner_only: bool = False
) -> Purchase:
    """A compra, se `user` a pode ver: é dele ou de um arquivo partilhado com ele (ADR 0007).

    `owner_only`: apagar e trocar a fatura ficam com quem registou a compra.
    """
    purchase = session.get(Purchase, purchase_id)
    # Uma compra de outro utilizador (sem partilha) responde como se não existisse.
    if purchase is None or not sharing.can_access(session, user, purchase.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Compra não encontrada")
    if owner_only and purchase.user_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Esta compra foi partilhada contigo: só quem a registou pode fazer isto",
        )
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
    """Lista as compras do utilizador e as dos arquivos partilhados com ele, da garantia que
    expira primeiro para a última."""
    query = (
        select(Purchase)
        .where(
            or_(Purchase.user_id == user.id, Purchase.user_id.in_(sharing.shared_owner_ids(user)))
        )
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


def _chunks(file: IO[bytes], size: int = 64 * 1024) -> Iterator[bytes]:
    try:
        file.seek(0)
        while chunk := file.read(size):
            yield chunk
    finally:
        file.close()


# Tem de vir antes de /{purchase_id}, senão "export" seria lido como um id.
@router.get(
    "/export",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
def export_purchases(user: CurrentUser, session: SessionDep) -> StreamingResponse:
    """Todas as compras num ZIP: `compras.csv` (para o Excel), `compras.json` e `faturas/`."""
    purchases = session.scalars(
        select(Purchase)
        .where(Purchase.user_id == user.id)
        .order_by(Purchase.purchase_date, Purchase.id)
    )
    now = datetime.now(UTC)
    # Até 10 MB em memória; acima disso, o ZIP passa para um ficheiro temporário.
    out = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024)
    try:
        write_export(out, user, purchases, now)
    except Exception:
        out.close()
        raise
    filename = f"warrantly-{now.date().isoformat()}.zip"
    return StreamingResponse(
        _chunks(out),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
    purchase = get_purchase_or_404(purchase_id, user, session, owner_only=True)
    invoice_key = purchase.invoice_key
    session.delete(purchase)
    session.commit()
    storage.delete(invoice_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def invoice_too_large() -> HTTPException:
    max_mb = settings.max_invoice_bytes // (1024 * 1024)
    return HTTPException(
        status.HTTP_413_CONTENT_TOO_LARGE, detail=f"A fatura não pode ter mais de {max_mb} MB"
    )


def read_invoice_upload(file: UploadFile) -> tuple[bytes, str, str]:
    """Lê e valida a fatura enviada pela API (multipart)."""
    data = file.file.read(settings.max_invoice_bytes + 1)
    if len(data) > settings.max_invoice_bytes:
        raise invoice_too_large()
    return validate_invoice(data, file.filename)


def validate_invoice(data: bytes, original_name: str | None) -> tuple[bytes, str, str]:
    """Valida a fatura pelos primeiros bytes: devolve os bytes, o tipo e o nome do ficheiro.

    Aceita PDF, JPEG, PNG, WebP e HEIC (até 10 MB); o HEIC (iPhone) passa a JPEG.
    """
    content_type = storage.detect_content_type(data)
    if content_type is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="A fatura tem de ser um PDF ou uma imagem (JPEG, PNG, WebP ou HEIC)",
        )
    filename = PurePath(original_name or "").name[:255] or "fatura"
    if content_type == storage.HEIC:
        try:
            data = storage.heic_to_jpeg(data)
        except Exception as err:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Não foi possível ler a fotografia HEIC",
            ) from err
        content_type = "image/jpeg"
        filename = str(PurePath(filename).with_suffix(".jpg"))
    return data, content_type, filename


# --- Upload direto para o S3 -------------------------------------------------------------
# 1) POST /uploads dá um POST pré-assinado do S3 (válido 5 min, com o tamanho máximo assinado);
# 2) o browser envia o ficheiro diretamente para o S3;
# 3) /uploads/{token}/scan lê-o, e PUT /{id}/invoice/upload valida-o e associa-o à compra.
# Assim a fatura não passa pela API (no Lambda, os pedidos estão limitados a 6 MB).


def load_direct_upload(user: User, token: str) -> tuple[bytes, storage.S3Storage]:
    s3 = storage.direct_uploads()
    if s3 is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Upload direto indisponível")
    try:
        data = s3.get_upload(user.id, token, settings.max_invoice_bytes)
    except storage.UploadTooLargeError:
        s3.remove_upload(user.id, token)
        raise invoice_too_large() from None
    except ValueError:  # token com formato inválido
        data = None
    if data is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Ficheiro não encontrado; volta a escolher a fatura"
        )
    return data, s3


@router.post("/uploads", response_model=UploadTicketRead)
def create_upload(user: CurrentUser) -> UploadTicketRead:
    """Prepara um upload direto para o S3. Sem S3 (desenvolvimento), `direct` vem a false e o
    browser envia a fatura pela API, como antes."""
    s3 = storage.direct_uploads()
    if s3 is None:
        return UploadTicketRead(direct=False, max_bytes=settings.max_invoice_bytes)
    ticket = s3.presign_upload(user.id, storage.new_upload_token(), settings.max_invoice_bytes)
    return UploadTicketRead(
        direct=True,
        max_bytes=settings.max_invoice_bytes,
        token=ticket.token,
        url=ticket.url,
        fields=ticket.fields,
    )


@router.post("/uploads/{token}/scan", response_model=InvoiceScanRead)
def scan_uploaded_invoice(token: str, user: CurrentUser) -> InvoiceScanRead:
    """Como /scan-invoice, mas para uma fatura já enviada para o S3."""
    raw, _ = load_direct_upload(user, token)
    data, content_type, _ = validate_invoice(raw, None)
    return scan_response(data, content_type)


@router.put("/{purchase_id}/invoice/upload", response_model=PurchaseRead)
def attach_uploaded_invoice(
    purchase_id: int, body: UploadAttach, user: CurrentUser, session: SessionDep
) -> Purchase:
    """Associa à compra uma fatura enviada diretamente para o S3 (e apaga o ficheiro temporário)."""
    purchase = get_purchase_or_404(purchase_id, user, session, owner_only=True)
    raw, s3 = load_direct_upload(user, body.token)
    try:
        data, content_type, filename = validate_invoice(raw, body.filename)
    except HTTPException:
        s3.remove_upload(user.id, body.token)
        raise
    attached = attach_invoice(purchase, data, content_type, filename, session)
    s3.remove_upload(user.id, body.token)
    return attached


@router.post("/scan-invoice", response_model=InvoiceScanRead)
def scan_invoice(file: UploadFile, user: CurrentUser) -> InvoiceScanRead:
    """Lê a fatura e sugere os campos da compra (não guarda nada).

    PDF com texto: lido diretamente. Fotografia ou PDF digitalizado: OCR com o Tesseract.
    Os campos que não se conseguem ler vêm a null.
    """
    data, content_type, _ = read_invoice_upload(file)
    return scan_response(data, content_type)


def scan_response(data: bytes, content_type: str) -> InvoiceScanRead:
    result = invoice_scan.scan_invoice(data, content_type)
    suggested = [
        name
        for name in ("product_name", "store", "purchase_date", "price", "invoice_number")
        if getattr(result, name) is not None
    ]
    # Quantos campos a leitura sugere, em média: mostra se o OCR está a ajudar.
    metric(
        "InvoiceFieldsSuggested",
        len(suggested),
        content_type=content_type,
        qr="yes" if result.from_qr else "no",
    )
    return InvoiceScanRead(
        text_found=bool(result.text.strip()) or result.from_qr,
        ocr_available=invoice_scan.ocr_available(),
        product_name=result.product_name,
        store=result.store,
        purchase_date=result.purchase_date,
        price=result.price,
        invoice_number=result.invoice_number,
        store_email=result.store_email,
    )


@router.put("/{purchase_id}/invoice", response_model=PurchaseRead)
def upload_invoice(
    purchase_id: int, file: UploadFile, user: CurrentUser, session: SessionDep
) -> Purchase:
    """Carrega a fatura (PDF, JPEG, PNG, WebP ou HEIC, até 10 MB). Substitui a anterior.

    As fotografias HEIC (iPhone) são guardadas como JPEG.
    """
    purchase = get_purchase_or_404(purchase_id, user, session, owner_only=True)
    data, content_type, filename = read_invoice_upload(file)
    return attach_invoice(purchase, data, content_type, filename, session)


def attach_invoice(
    purchase: Purchase, data: bytes, content_type: str, filename: str, session: SessionDep
) -> Purchase:
    """Guarda a fatura (já validada) e associa-a à compra; apaga a anterior, se houver."""
    old_key = purchase.invoice_key
    new_key = storage.save(data, content_type)
    purchase.invoice_key = new_key
    purchase.invoice_filename = filename
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


def content_disposition(disposition: str, filename: str) -> str:
    """Cabeçalho Content-Disposition com o nome original (acentos em RFC 5987, como o Starlette)."""
    quoted = quote(filename)
    if quoted != filename:
        return f"{disposition}; filename*=utf-8''{quoted}"
    return f'{disposition}; filename="{filename}"'


@router.get(
    "/{purchase_id}/invoice",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}, "image/*": {}}}},
)
def download_invoice(purchase_id: int, user: CurrentUser, session: SessionDep) -> Response:
    purchase = get_purchase_or_404(purchase_id, user, session)
    data = storage.load(purchase.invoice_key) if purchase.invoice_key else None
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Esta compra não tem fatura")
    return Response(
        data,
        media_type=purchase.invoice_content_type,
        headers={
            "Content-Disposition": content_disposition(
                "inline", purchase.invoice_filename or "fatura"
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{purchase_id}/invoice", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(purchase_id: int, user: CurrentUser, session: SessionDep) -> Response:
    purchase = get_purchase_or_404(purchase_id, user, session, owner_only=True)
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


def require_full_name(user: User) -> None:
    """A carta é assinada com o nome do utilizador."""
    if not user.full_name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Indica o teu nome no perfil antes de gerar a reclamação",
        )


@router.post("/{purchase_id}/claim", response_model=ClaimRead)
def generate_claim(
    purchase_id: int, data: ClaimRequest, user: CurrentUser, session: SessionDep
) -> ClaimRead:
    """Gera o texto da reclamação à loja (não envia nada; o utilizador copia ou envia)."""
    purchase = get_purchase_or_404(purchase_id, user, session)
    require_full_name(user)
    today = date.today()
    subject, body = build_claim(purchase, user, data.description, today)
    return ClaimRead(subject=subject, body=body, within_warranty=purchase.warranty_end >= today)


@router.post(
    "/{purchase_id}/claim.pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
)
def generate_claim_pdf(
    purchase_id: int, data: ClaimRequest, user: CurrentUser, session: SessionDep
) -> Response:
    """A reclamação em PDF, com a fatura a seguir à carta (se houver)."""
    purchase = get_purchase_or_404(purchase_id, user, session)
    require_full_name(user)
    today = date.today()
    subject, body = build_claim(purchase, user, data.description, today)
    pdf, invoice_included = build_claim_pdf(purchase, user, subject, body, today)
    filename = f"reclamacao-{purchase.id}.pdf"
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Invoice-Included": "true" if invoice_included else "false",
        },
    )
