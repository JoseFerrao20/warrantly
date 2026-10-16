from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.limits import MaxBodySizeMiddleware
from app.routers import auth, internal, purchases

# Em produção não há /docs nem /openapi.json: só servem para desenvolver.
production = settings.environment == "production"
app = FastAPI(
    title="Warrantly API",
    docs_url=None if production else "/docs",
    redoc_url=None if production else "/redoc",
    openapi_url=None if production else "/openapi.json",
)
# A fatura (até 10 MB) mais a margem do multipart.
app.add_middleware(MaxBodySizeMiddleware, max_bytes=settings.max_invoice_bytes + 1024 * 1024)
app.include_router(auth.router)
app.include_router(purchases.router)
app.include_router(internal.router)


@app.get("/health/live")
def health_live() -> dict[str, str]:
    """A app arrancou (sem tocar na base de dados): usado pelo Lambda Web Adapter."""
    return {"status": "ok"}


@app.get("/health")
def health(session: Session = Depends(get_session)) -> dict[str, str]:
    session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
