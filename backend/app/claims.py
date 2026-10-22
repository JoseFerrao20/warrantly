"""Texto da reclamação à loja, ao abrigo da garantia legal (Decreto-Lei n.º 84/2021)."""

from datetime import date
from decimal import Decimal

from app.models import Purchase, User


def format_price(price: Decimal) -> str:
    """1234.5 -> "1 234,50 €" (formato português)."""
    return f"{price:,.2f}".replace(",", " ").replace(".", ",") + " €"


def build_claim(purchase: Purchase, user: User, description: str, today: date) -> tuple[str, str]:
    """Devolve (assunto, corpo) da carta."""
    within_warranty = purchase.warranty_end >= today
    deadline = (
        f", ainda dentro do prazo de garantia (válida até {purchase.warranty_end:%d/%m/%Y})"
        if within_warranty
        else ""
    )
    details = [
        f"- Produto: {purchase.product_name}",
        f"- Data de compra: {purchase.purchase_date:%d/%m/%Y}",
        f"- Preço: {format_price(purchase.price)}",
    ]
    if purchase.invoice_number:
        details.append(f"- Fatura n.º {purchase.invoice_number}")
    if purchase.store_nif:
        details.append(f"- NIF do vendedor: {purchase.store_nif}")

    lines = [
        f"Exmos. Senhores {purchase.store},",
        "",
        "Venho, ao abrigo do Decreto-Lei n.º 84/2021, de 18 de outubro, comunicar a falta de "
        f"conformidade do bem abaixo indicado{deadline}, e solicitar a sua reparação ou "
        "substituição, sem quaisquer encargos.",
        "",
        *details,
        "",
        "Descrição da avaria:",
        description.strip(),
        "",
    ]
    if purchase.invoice_key:
        lines += ["Junto cópia da fatura de compra.", ""]
    lines += [
        "Aguardo a vossa resposta, com indicação dos próximos passos.",
        "",
        "Com os melhores cumprimentos,",
        user.full_name or "",
        user.email,
    ]
    subject = f"Reclamação ao abrigo da garantia: {purchase.product_name}"
    return subject, "\n".join(lines)
