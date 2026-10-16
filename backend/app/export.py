"""Exportação dos dados do utilizador num ZIP: compras em CSV e JSON e as faturas."""

import csv
import io
import json
import re
import unicodedata
import zipfile
from collections.abc import Iterable
from datetime import date, datetime
from typing import IO

from app import storage
from app.models import Purchase, User
from app.schemas import WarrantyStatus, warranty_status

STATUS_LABELS = {
    WarrantyStatus.ACTIVE: "Ativa",
    WarrantyStatus.EXPIRING: "A expirar",
    WarrantyStatus.EXPIRED: "Expirada",
}

CSV_HEADER = [
    "ID",
    "Produto",
    "Loja",
    "Categoria",
    "Data da compra",
    "Preço (€)",
    "Garantia (meses)",
    "Fim da garantia",
    "Estado",
    "N.º da fatura",
    "Email da loja",
    "Ficheiro da fatura",
]

# Uma célula que começa por um destes caracteres é lida como fórmula pelo Excel.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _cell(value: str | None) -> str:
    if not value:
        return ""
    return "'" + value if value.startswith(FORMULA_PREFIXES) else value


def _slug(text: str, max_length: int = 40) -> str:
    """'Máquina de lavar Bosch' → 'maquina-de-lavar-bosch' (seguro em qualquer sistema)."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug[:max_length].rstrip("-") or "compra"


def invoice_archive_name(purchase: Purchase) -> str:
    extension = storage.extension(purchase.invoice_key) if purchase.invoice_key else ""
    return f"faturas/{purchase.id}-{_slug(purchase.product_name)}{extension}"


def _csv(rows: list[tuple[Purchase, str | None]], today: date) -> bytes:
    buffer = io.StringIO()
    # Ponto e vírgula e vírgula decimal: é o que o Excel em português espera.
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    for purchase, invoice_name in rows:
        writer.writerow(
            [
                purchase.id,
                _cell(purchase.product_name),
                _cell(purchase.store),
                _cell(purchase.category),
                purchase.purchase_date.isoformat(),
                f"{purchase.price:.2f}".replace(".", ","),
                purchase.warranty_months,
                purchase.warranty_end.isoformat(),
                STATUS_LABELS[warranty_status(purchase.warranty_end, today)],
                _cell(purchase.invoice_number),
                _cell(purchase.store_email),
                invoice_name or "",
            ]
        )
    # Com BOM, o Excel reconhece o UTF-8 (acentos e €).
    return buffer.getvalue().encode("utf-8-sig")


def _json(user: User, rows: list[tuple[Purchase, str | None]], now: datetime) -> bytes:
    data = {
        "exported_at": now.isoformat(timespec="seconds"),
        "user": {"email": user.email, "full_name": user.full_name},
        "purchases": [
            {
                "id": p.id,
                "product_name": p.product_name,
                "store": p.store,
                "category": p.category,
                "purchase_date": p.purchase_date.isoformat(),
                "price": f"{p.price:.2f}",
                "warranty_months": p.warranty_months,
                "warranty_end": p.warranty_end.isoformat(),
                "status": warranty_status(p.warranty_end, now.date()).value,
                "invoice_number": p.invoice_number,
                "store_email": p.store_email,
                "invoice_file": invoice_name,
                "invoice_original_filename": p.invoice_filename if invoice_name else None,
                "created_at": p.created_at.isoformat(timespec="seconds"),
                "updated_at": p.updated_at.isoformat(timespec="seconds"),
            }
            for p, invoice_name in rows
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2).encode()


def write_export(out: IO[bytes], user: User, purchases: Iterable[Purchase], now: datetime) -> None:
    """Escreve o ZIP em `out`. Uma fatura que já não exista fica de fora, sem falhar."""
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        rows: list[tuple[Purchase, str | None]] = []
        for purchase in purchases:
            invoice_name = None
            if purchase.invoice_key:
                data = storage.load(purchase.invoice_key)
                if data is not None:
                    invoice_name = invoice_archive_name(purchase)
                    # PDF e imagens já vêm comprimidos: guardar sem voltar a comprimir.
                    archive.writestr(invoice_name, data, compress_type=zipfile.ZIP_STORED)
            rows.append((purchase, invoice_name))
        archive.writestr("compras.csv", _csv(rows, now.date()))
        archive.writestr("compras.json", _json(user, rows, now))
