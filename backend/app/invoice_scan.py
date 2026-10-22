"""Leitura da fatura: tira o texto (PDF ou OCR) e sugere os campos da compra.

Só sugere: o utilizador vê os valores no formulário e confirma antes de guardar. Por isso,
na dúvida, é melhor não sugerir nada do que sugerir um valor errado.

- PDF com texto (a maioria das faturas digitais): pypdf, sem OCR.
- Fotografia ou PDF digitalizado: Tesseract (programa `tesseract`, com o português instalado).
  Sem o Tesseract, as fotografias simplesmente não dão sugestões.
- Código QR da AT (obrigatório nas faturas desde 2022), lido com o faturapt: dá a data, o
  total e o número da fatura sem adivinhar. Quando existe, ganha ao texto nesses três campos;
  a loja, o artigo e o email continuam a vir do texto, porque o QR não os tem.
- Só o QR (`scan_qr_text`): a app móvel lê-o com a câmara e envia o texto, sem fotografia.
"""

import io
import re
import shutil
import subprocess
import threading
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

import faturapt
from PIL import Image, ImageOps
from pypdf import PdfReader

OCR_TIMEOUT_SECONDS = 30
OCR_MAX_SIDE = 3000  # píxeis: chega para uma fatura e evita imagens enormes em memória
OCR_MIN_SIDE = 1500  # fotografias pequenas são ampliadas: o Tesseract lê melhor letras grandes
OCR_LANGUAGES = "por+eng"

# O OCR ocupa um processador durante alguns segundos: no máximo dois de cada vez.
_ocr_slots = threading.BoundedSemaphore(2)

# Só faturas normais (não anuladas): uma nota de crédito ou um orçamento não são a compra.
QR_DOCUMENT_TYPES = {"FT", "FS", "FR"}


@dataclass
class ScanResult:
    text: str
    product_name: str | None = None
    store: str | None = None
    purchase_date: date | None = None
    price: Decimal | None = None
    invoice_number: str | None = None
    store_email: str | None = None
    from_qr: bool = False  # a data, o total e o número vieram do código QR da AT


# --- Extração do texto ---------------------------------------------------------------------


def ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def ocr_image(image: Image.Image) -> str:
    """Texto de uma imagem com o Tesseract ("" se não estiver instalado ou falhar)."""
    # Caminho completo do programa: não depende da ordem do PATH no momento da chamada.
    tesseract = shutil.which("tesseract")
    if tesseract is None:
        return ""
    image = ImageOps.exif_transpose(image).convert("L")  # orientação da câmara e cinzentos
    longest = max(image.size)
    if longest > OCR_MAX_SIDE or longest < OCR_MIN_SIDE:
        scale = (OCR_MAX_SIDE if longest > OCR_MAX_SIDE else OCR_MIN_SIDE) / longest
        image = image.resize((round(image.width * scale), round(image.height * scale)))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    with _ocr_slots:
        try:
            # Argumentos fixos e a imagem pelo stdin: nada do utilizador chega à linha de comando.
            result = subprocess.run(  # noqa: S603
                [tesseract, "stdin", "stdout", "-l", OCR_LANGUAGES, "--psm", "4"],
                input=buffer.getvalue(),
                capture_output=True,
                timeout=OCR_TIMEOUT_SECONDS,
                check=True,
            )
        except (subprocess.SubprocessError, OSError):
            return ""
    return result.stdout.decode("utf-8", errors="replace")


def pdf_text(data: bytes) -> str:
    """Texto da primeira página (ou duas); se não houver texto, OCR das imagens da página."""
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = reader.pages[:2]
        text = "\n".join(page.extract_text() or "" for page in pages)
        if text.strip():
            return text
        # PDF digitalizado: cada página é uma imagem.
        for image_file in pages[0].images if pages else []:
            text = ocr_image(image_file.image)
            if text.strip():
                return text
    except Exception:
        return ""
    return ""


def extract_text(data: bytes, content_type: str) -> str:
    if content_type == "application/pdf":
        return pdf_text(data)
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        return ""
    return ocr_image(image)


# --- Código QR da AT -------------------------------------------------------------------------


def read_qr(data: bytes, content_type: str) -> faturapt.InvoiceQR | None:
    """O QR da fatura, numa fotografia ou num PDF (o faturapt desenha a página como imagem,
    por isso também encontra o QR desenhado pelos programas de faturação)."""
    try:
        if content_type == "application/pdf":
            invoice = faturapt.read_pdf(data)
        else:
            invoice = faturapt.read_image(data)
    except Exception:  # sem QR, QR de outra coisa ou ficheiro ilegível: fica o texto
        return None
    return invoice if is_purchase_invoice(invoice) else None


def is_purchase_invoice(invoice: faturapt.InvoiceQR) -> bool:
    return invoice.document_status == "N" and invoice.document_type in QR_DOCUMENT_TYPES


def apply_qr(result: ScanResult, qr: faturapt.InvoiceQR, today: date) -> None:
    """O QR ganha ao texto na data (se não estiver no futuro), no total e no número."""
    if date(2000, 1, 1) <= qr.document_date <= today:
        result.purchase_date = qr.document_date
    result.price = qr.total
    result.invoice_number = qr.document_id
    result.from_qr = True


def scan_qr_text(text: str, today: date | None = None) -> ScanResult | None:
    """O texto de um QR lido pela câmara do telemóvel; None se não for de uma fatura."""
    try:
        invoice = faturapt.parse(text)
    except faturapt.QRCodeError:
        return None
    if not is_purchase_invoice(invoice):
        return None
    result = ScanResult(text="")
    apply_qr(result, invoice, today or date.today())
    return result


# --- Interpretação do texto ----------------------------------------------------------------

MONTHS = {
    "janeiro": 1,
    "fevereiro": 2,
    "marco": 3,
    "abril": 4,
    "maio": 5,
    "junho": 6,
    "julho": 7,
    "agosto": 8,
    "setembro": 9,
    "outubro": 10,
    "novembro": 11,
    "dezembro": 12,
}

# Lojas comuns em Portugal (nome como deve aparecer, e como aparece na fatura).
KNOWN_STORES = {
    "Worten": ["worten"],
    "Fnac": ["fnac"],
    "Continente": ["continente", "modelo continente"],
    "Pingo Doce": ["pingo doce"],
    "Radio Popular": ["radio popular", "rádio popular"],
    "MediaMarkt": ["mediamarkt", "media markt"],
    "Leroy Merlin": ["leroy merlin"],
    "IKEA": ["ikea"],
    "Amazon": ["amazon"],
    "El Corte Inglés": ["el corte ingles", "el corte inglés"],
    "Decathlon": ["decathlon"],
    "Staples": ["staples"],
    "PCDiga": ["pcdiga"],
    "Globaldata": ["globaldata"],
    "Auchan": ["auchan", "jumbo"],
    "Lidl": ["lidl"],
    "Aldi": ["aldi"],
    "Intermarché": ["intermarche", "intermarché"],
    "Conforama": ["conforama"],
    "Apple": ["apple store", "apple distribution"],
    "Phone House": ["phone house"],
    "Darty": ["darty"],
    "Bricomarché": ["bricomarche", "bricomarché"],
    "AKI": ["aki "],
    "Sport Zone": ["sport zone"],
}

# Séries de faturas portuguesas: "FT 2023/48213", "FR A/123", "FS 001/2024/77".
INVOICE_NUMBER = re.compile(
    r"\b(F[TRS]|FAC|NC|VD)\s*([A-Z0-9]{0,10}(?:[-/][A-Z0-9]+)*/\d{1,10})\b", re.IGNORECASE
)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
NUMERIC_DATE = re.compile(r"\b(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})\b")
WRITTEN_DATE = re.compile(r"\b(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})\b", re.IGNORECASE)
# 1.234,56 | 1 234,56 | 1234,56 | 1234.56 (com € opcional)
AMOUNT = re.compile(r"(?<![\d.,])(\d{1,3}(?:[ .]\d{3})+|\d+)([.,])(\d{2})(?![\d])")

TOTAL_WORDS = ("total a pagar", "total (eur)", "total eur", "total €", "total")
NOT_TOTAL_WORDS = ("subtotal", "sub-total", "total iva", "iva", "base", "desconto", "troco")
NOT_ITEM_WORDS = NOT_TOTAL_WORDS + (
    "total",
    "multibanco",
    "numerário",
    "numerario",
    "visa",
    "mastercard",
    "pagamento",
    "nif",
    "contribuinte",
    "capital social",
    "fatura",
    "factura",
    "data",
)


def _normalize(text: str) -> str:
    """Minúsculas e sem acentos, para comparar."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return ascii_text.lower()


# O OCR lê muitas vezes o "€" no fim da linha como "8", "e" ou "E" ("429,008").
EURO_MISREAD = re.compile(r"(\d[.,]\d{2})[8eE]\s*$")


def _amounts(line: str) -> list[Decimal]:
    values = []
    line = EURO_MISREAD.sub(r"\1 €", line)
    for whole, _, cents in AMOUNT.findall(line):
        try:
            values.append(Decimal(re.sub(r"[ .]", "", whole) + "." + cents))
        except InvalidOperation:
            continue
    return values


def _valid_date(year: int, month: int, day: int, today: date) -> date | None:
    if year < 100:
        year += 2000
    try:
        value = date(year, month, day)
    except ValueError:
        return None
    return value if date(2000, 1, 1) <= value <= today else None


def _dates(line: str, today: date) -> list[date]:
    found = []
    for a, b, c in NUMERIC_DATE.findall(line):
        if len(a) == 4:  # 2023-11-03
            value = _valid_date(int(a), int(b), int(c), today)
        else:  # 03-11-2023 (dia primeiro, como em Portugal)
            value = _valid_date(int(c), int(b), int(a), today)
        if value:
            found.append(value)
    for day, month_name, year in WRITTEN_DATE.findall(line):
        month = MONTHS.get(_normalize(month_name))
        if month and (value := _valid_date(int(year), month, int(day), today)):
            found.append(value)
    return found


def find_purchase_date(lines: list[str], today: date) -> date | None:
    # Primeiro as linhas com "data" (data de emissão, data da fatura); depois qualquer data.
    for prefer_labelled in (True, False):
        for line in lines:
            if prefer_labelled and "data" not in _normalize(line):
                continue
            if dates := _dates(line, today):
                return dates[0]
    return None


def find_total(lines: list[str]) -> Decimal | None:
    for word in TOTAL_WORDS:
        candidates = []
        for line in lines:
            lower = _normalize(line)
            if word in lower and not any(bad in lower for bad in NOT_TOTAL_WORDS):
                candidates.extend(_amounts(line))
        if candidates:
            return max(candidates)
    # Sem "total": se só houver um valor com €, é esse.
    with_euro = {amount for line in lines if "€" in line for amount in _amounts(line)}
    return with_euro.pop() if len(with_euro) == 1 else None


def find_store(text: str, lines: list[str]) -> str | None:
    lower = _normalize(text)
    for name, aliases in KNOWN_STORES.items():
        if any(_normalize(alias) in lower for alias in aliases):
            return name
    # Uma empresa no cabeçalho: "Loja Exemplo, Lda." → "Loja Exemplo".
    for line in lines[:8]:
        match = re.match(
            r"^\s*(.{3,60}?),?\s+(S\.?\s?A\.?|Lda\.?|Unipessoal)\b", line, re.IGNORECASE
        )
        if match:
            return match.group(1).strip(" -,")
    return None


def find_product(lines: list[str]) -> str | None:
    """A primeira linha de artigo: descrição seguida de um valor (ex.: "Máquina X ... 429,00 €")."""
    for line in lines:
        lower = _normalize(line)
        if any(word in lower for word in NOT_ITEM_WORDS) or not _amounts(line):
            continue
        description = AMOUNT.split(line)[0]
        # Tira a quantidade no início ("1 x", "2un") e pontos/traços de preenchimento.
        description = re.sub(r"^\s*\d+\s*(x|un\.?|uni\.?)\s+", "", description, flags=re.I)
        description = re.sub(r"[\s.·_–-]{2,}$", "", description).strip(" .:-€")
        if len(re.findall(r"[^\W\d_]", description)) >= 3:
            return description[:200]
    return None


def parse_invoice_text(text: str, today: date | None = None) -> ScanResult:
    today = today or date.today()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    number = INVOICE_NUMBER.search(text)
    emails = EMAIL.findall(text)
    return ScanResult(
        text=text,
        product_name=find_product(lines),
        store=find_store(text, lines),
        purchase_date=find_purchase_date(lines, today),
        price=find_total(lines),
        invoice_number=f"{number.group(1).upper()} {number.group(2)}" if number else None,
        store_email=emails[0].lower() if emails else None,
    )


def scan_invoice(data: bytes, content_type: str, today: date | None = None) -> ScanResult:
    today = today or date.today()
    result = parse_invoice_text(extract_text(data, content_type), today)
    qr = read_qr(data, content_type)
    if qr is not None:
        apply_qr(result, qr, today)
    return result
