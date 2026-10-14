from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_session
from app.routers import purchases

app = FastAPI(title="Warrantly API")
app.include_router(purchases.router)


@app.get("/health")
def health(session: Session = Depends(get_session)) -> dict[str, str]:
    session.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
