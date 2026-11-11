from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .routers import auth, clients, clubs

app = FastAPI(title="Club system API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(clubs.router)
app.include_router(clients.router)


@app.get("/health", tags=["service"])
def health(db: Session = Depends(get_db)):
    """Перевірка, що API працює і БД відповідає."""
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
