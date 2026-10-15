"""Servidor de produção: a API em /api e o frontend (build do Vite) na raiz.

Em desenvolvimento continua a usar-se `app.main:app` (com o Vite à parte); em produção:

    uvicorn app.server:server
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.config import settings
from app.main import app as api


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
    server.mount("/api", api)
    if static_dir and (static_dir / "index.html").is_file():
        server.mount("/", SPAStaticFiles(directory=static_dir, html=True), name="frontend")
    return server


server = create_server(settings.static_dir)
