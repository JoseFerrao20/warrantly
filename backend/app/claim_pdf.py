"""PDF da reclamação: a carta e, a seguir, a fatura da compra (PDF ou imagem)."""

import logging
from datetime import date
from io import BytesIO
from xml.sax.saxutils import escape

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from app import storage
from app.models import Purchase, User

logger = logging.getLogger(__name__)

MONTHS = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]  # fmt: skip


def long_date(day: date) -> str:
    return f"{day.day} de {MONTHS[day.month - 1]} de {day.year}"


def _letter_pdf(user: User, subject: str, body: str, today: date) -> bytes:
    styles = getSampleStyleSheet()
    text = ParagraphStyle("carta", parent=styles["Normal"], fontSize=11, leading=15)
    small = ParagraphStyle("pequeno", parent=text, fontSize=10, leading=13)
    right = ParagraphStyle("direita", parent=small, alignment=2)

    sender = "<br/>".join(escape(line) for line in (user.full_name or "", user.email) if line)
    story = [
        Paragraph(sender, small),
        Spacer(1, 8 * mm),
        Paragraph(escape(long_date(today)), right),
        Spacer(1, 8 * mm),
        Paragraph(f"<b>Assunto:</b> {escape(subject)}", text),
        Spacer(1, 6 * mm),
    ]
    for block in body.split("\n\n"):
        story.append(Paragraph(escape(block).replace("\n", "<br/>"), text))
        story.append(Spacer(1, 4 * mm))

    buffer = BytesIO()
    SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=25 * mm,
        rightMargin=25 * mm,
        topMargin=25 * mm,
        bottomMargin=25 * mm,
        title=subject,
        author=user.full_name or user.email,
    ).build(story)
    return buffer.getvalue()


def _image_pdf(data: bytes) -> bytes:
    """Uma página A4 com a imagem da fatura, ajustada às margens."""
    image = ImageReader(BytesIO(data))
    width, height = image.getSize()
    page_w, page_h = A4
    margin = 15 * mm
    scale = min((page_w - 2 * margin) / width, (page_h - 2 * margin) / height)
    w, h = width * scale, height * scale
    buffer = BytesIO()
    canvas = Canvas(buffer, pagesize=A4)
    canvas.drawImage(image, (page_w - w) / 2, (page_h - h) / 2, w, h)
    canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def build_claim_pdf(
    purchase: Purchase, user: User, subject: str, body: str, today: date
) -> tuple[bytes, bool]:
    """Devolve (pdf, fatura_incluída). Se a fatura não puder ser lida, sai só a carta."""
    writer = PdfWriter()
    writer.append(PdfReader(BytesIO(_letter_pdf(user, subject, body, today))))

    invoice_included = False
    if purchase.invoice_key:
        try:
            data = storage.path_for(purchase.invoice_key).read_bytes()
            if purchase.invoice_content_type != "application/pdf":
                data = _image_pdf(data)
            writer.append(PdfReader(BytesIO(data)))
            invoice_included = True
        except Exception:
            logger.exception("Não foi possível juntar a fatura da compra %s", purchase.id)

    writer.add_metadata({"/Title": subject})
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue(), invoice_included
