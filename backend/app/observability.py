"""Observabilidade: logs estruturados (JSON), um id por pedido e métricas para o CloudWatch.

- **Logs em JSON** (`LOG_FORMAT=json`, na AWS): uma linha por evento, com campos que o
  CloudWatch Logs Insights e os filtros de métricas leem diretamente (ex.: `{ $.status >= 500 }`).
  Em desenvolvimento, texto simples.
- **Id do pedido:** vem do CloudFront (`X-Amz-Cf-Id`) ou do cliente (`X-Request-ID`), ou é gerado.
  Vai em todos os logs do pedido e na resposta (`X-Request-ID`), para ligar uma queixa ("deu
  erro às 10h") às linhas do log.
- **Métricas** no formato EMF (Embedded Metric Format): uma linha de log com o bloco `_aws`, que
  o CloudWatch transforma em métrica sozinho. Não há chamadas à API do CloudWatch, nem custo por
  pedido, e nos testes basta ler os logs.
"""

import contextvars
import json
import logging
import re
import sys
import time
import uuid
from datetime import UTC, datetime

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings

NAMESPACE = "Warrantly"

request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

logger = logging.getLogger("app.requests")
metrics_logger = logging.getLogger("app.metrics")

# Atributos que todos os LogRecord têm; o resto veio de `extra=` e vai para o JSON.
_STANDARD = set(vars(logging.makeLogRecord({}))) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        if getattr(record, "emf", None):  # métrica: o JSON já vem pronto
            return json.dumps(record.emf, ensure_ascii=False)
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if rid := request_id.get():
            entry["request_id"] = rid
        entry.update({k: v for k, v in vars(record).items() if k not in _STANDARD})
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def configure_logging() -> None:
    """Logs da app (`app.*`) para o stdout, que no Lambda vai para o CloudWatch Logs."""
    handler = logging.StreamHandler(sys.stdout)
    if settings.log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    app_logger = logging.getLogger("app")
    app_logger.handlers = [handler]
    app_logger.setLevel(logging.INFO)
    # Sem handler na raiz (o uvicorn só configura os loggers dele), por isso não há linhas
    # repetidas; e nos testes o caplog continua a ver os logs.


def metric(name: str, value: float = 1, unit: str = "Count", **properties: str) -> None:
    """Uma métrica no formato EMF (sem dimensões: cada nome é uma métrica no CloudWatch).

    As `properties` não viram métricas (não custam nada) mas ficam no log para pesquisar.
    """
    emf = {
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": NAMESPACE,
                    "Dimensions": [[]],
                    "Metrics": [{"Name": name, "Unit": unit}],
                }
            ],
        },
        name: value,
        **properties,
    }
    if rid := request_id.get():
        emf["request_id"] = rid
    metrics_logger.info("metric %s=%s", name, value, extra={"emf": emf})


# Ids aceites de fora: curtos e só com caracteres seguros (não deixam injetar nada nos logs).
_SAFE_ID = re.compile(r"^[A-Za-z0-9._=-]{8,128}$")


def _incoming_request_id(scope: Scope) -> str:
    headers = dict(scope.get("headers") or [])
    for name in (b"x-amz-cf-id", b"x-request-id"):
        value = headers.get(name, b"").decode("latin-1")
        if _SAFE_ID.match(value):
            return value
    return uuid.uuid4().hex


class RequestContextMiddleware:
    """Dá um id a cada pedido e escreve uma linha de log no fim (método, rota, estado, tempo).

    A rota é o modelo (`/purchases/{purchase_id}`), não o caminho, para os logs não terem ids
    nem dados pessoais e se poderem agrupar. Middleware ASGI puro: não atrasa as respostas
    em streaming (ex.: a exportação em ZIP).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        rid = _incoming_request_id(scope)
        token = request_id.set(rid)
        start = time.perf_counter()
        status = 500

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message.setdefault("headers", [])
                message["headers"] = [*message["headers"], (b"x-request-id", rid.encode())]
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            logger.exception("Erro não tratado", extra={"method": scope["method"]})
            metric("ServerErrors")
            raise
        finally:
            route = scope.get("route")
            logger.info(
                "%s %s %s",
                scope["method"],
                getattr(route, "path", "(sem rota)"),
                status,
                extra={
                    "request_id": rid,
                    "method": scope["method"],
                    "route": getattr(route, "path", None),
                    "status": status,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                },
            )
            request_id.reset(token)
