"""Servidor de produção: a API em /api e o frontend (build do Vite) na raiz.

Em desenvolvimento continua a usar-se `app.main:app` (com o Vite à parte); em produção:

    uvicorn app.server:server
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import origin
from app.config import settings
from app.main import app as api

# Content Security Policy: só código e pedidos da própria app, e nenhum script inline.
# Os estilos inline ficam permitidos porque a fatura aberta noutro separador (blob:) herda
# esta política, e o visualizador de PDF do Chrome usa estilos inline (sem eles, o PDF
# aparece cortado). O blob: em img/object/frame serve para abrir a fatura.
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "object-src 'self' blob:",
        "frame-src 'self' blob:",
        "connect-src 'self'",
        "font-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # O Fly só serve HTTPS (force_https); por HTTP o browser ignora este cabeçalho.
    "Strict-Transport-Security": "max-age=31536000",
}


class SecurityHeadersMiddleware:
    """Junta os cabeçalhos de segurança a todas as respostas (API e frontend)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


# Os pedidos à API que não passam pelo CloudFront, e que por isso não trazem o segredo: a
# verificação de saúde do Lambda Web Adapter e os eventos agendados (ADR 0006), que têm a sua
# própria proteção.
WITHOUT_ORIGIN_SECRET = {"/api/health/live", "/api/internal/events"}


class OriginVerifyMiddleware:
    """Com ORIGIN_VERIFY_SECRET definido, a API só responde a pedidos vindos do CloudFront.

    Fecha o acesso direto à Function URL do Lambda, que é pública (ver app/origin.py).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (
            scope["type"] == "http"
            and settings.origin_verify_secret
            and path.startswith("/api/")
            and path not in WITHOUT_ORIGIN_SECRET
            and not origin.from_cloudfront(Headers(scope=scope))
        ):
            response = JSONResponse({"detail": "Acesso direto não permitido"}, status_code=403)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class SPAStaticFiles(StaticFiles):
    """Ficheiros do frontend; caminhos que não existem (ex.: /compras/3) devolvem o index.html."""

    async def get_response(self, path: str, scope: Scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            return FileResponse(Path(str(self.directory)) / "index.html")
        if path.startswith("assets/"):
            # Os ficheiros em assets/ têm um hash no nome: podem ficar em cache para sempre.
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def create_server(static_dir: Path | None) -> FastAPI:
    server = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    server.add_middleware(OriginVerifyMiddleware)
    server.add_middleware(SecurityHeadersMiddleware)  # a última fica por fora: também no 403
    server.mount("/api", api)
    if static_dir and (static_dir / "index.html").is_file():
        server.mount("/", SPAStaticFiles(directory=static_dir, html=True), name="frontend")
    return server


server = create_server(settings.static_dir)
