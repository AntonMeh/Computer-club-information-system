"""Pydantic-схеми запитів і відповідей API."""
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


# ---------- Club ----------
class ClubBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=1, max_length=20)
    pc_count: int = Field(default=0, ge=0)


class ClubCreate(ClubBase):
    pass


class ClubUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    address: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, min_length=1, max_length=20)
    pc_count: int | None = Field(default=None, ge=0)


class ClubRead(ClubBase):
    model_config = ConfigDict(from_attributes=True)
    club_id: int


# ---------- Client ----------
class ClientBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=20)
    email: str | None = Field(default=None, max_length=100)


class ClientCreate(ClientBase):
    reg_date: date | None = None  # якщо не вказано, сервер підставить сьогоднішню дату
    bonus_balance: Decimal = Field(default=Decimal("0"), ge=0)


class ClientUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, min_length=1, max_length=20)
    email: str | None = Field(default=None, max_length=100)
    bonus_balance: Decimal | None = Field(default=None, ge=0)


class ClientRead(ClientBase):
    model_config = ConfigDict(from_attributes=True)
    client_id: int
    reg_date: date
    bonus_balance: Decimal
