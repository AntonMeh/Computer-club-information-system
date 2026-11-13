"""Pydantic-схеми запитів і відповідей API."""
from datetime import date, datetime
from decimal import Decimal
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

date_type = date

WORKSTATION_TYPES = ("Standard", "VIP", "PlayStation")
STAFF_POSITIONS = (
    "Директор клубу",
    "Заступник директора (адміністратор клубу)",
    "Оператор-адміністратор залу",
    "Технічний персонал",
    "Бухгалтер",
    "Системний адміністратор",
    "Менеджер з реклами та маркетингу",
    "Менеджер з організації турнірів та заходів",
)
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")


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
    workstations_count: int = 0
    staff_count: int = 0
    revenue_month: Decimal = Decimal("0.00")


# ---------- Client ----------
class ClientBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=20)
    email: str | None = Field(default=None, max_length=100)


class ClientCreate(ClientBase):
    reg_date: date_type | None = None
    bonus_balance: Decimal = Field(default=Decimal("0"), ge=0)


class ClientUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, min_length=1, max_length=20)
    email: str | None = Field(default=None, max_length=100)
    bonus_balance: Decimal | None = Field(default=None, ge=0)


class ClientRead(ClientBase):
    model_config = ConfigDict(from_attributes=True)
    client_id: int
    reg_date: date_type
    bonus_balance: Decimal
    sessions_count: int = 0
    total_spent: Decimal = Decimal("0.00")
    avg_check: Decimal = Decimal("0.00")
    last_visit: datetime | None = None


class BonusAdjustmentRequest(BaseModel):
    delta: Decimal
    reason: str | None = Field(default=None, max_length=200)


class ClientSessionItem(BaseModel):
    session_id: int
    workstation_id: int
    workstation_number: int
    workstation_type: str
    club_id: int
    club_name: str
    tariff_name: str
    price_per_hour: Decimal
    start_time: datetime
    end_time: datetime | None
    status: str
    amount: Decimal | None = None
    payment_method: str | None = None


class ClientPaymentItem(BaseModel):
    payment_id: int
    session_id: int
    workstation_number: int
    club_name: str
    amount: Decimal
    payment_date: datetime
    method: str


class ClientTournamentItem(BaseModel):
    participation_id: int
    tournament_id: int
    tournament_name: str
    game: str
    date: date_type
    club_name: str
    prize_fund: Decimal
    place: int | None


# ---------- Tariff ----------
class TariffBase(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    workstation_type: str = Field(min_length=1, max_length=20)
    price_per_hour: Decimal = Field(gt=0, le=Decimal("99999.99"))

    @field_validator("workstation_type")
    @classmethod
    def _validate_ws_type(cls, v: str) -> str:
        if v not in WORKSTATION_TYPES:
            raise ValueError(f"Тип місця має бути одним із: {', '.join(WORKSTATION_TYPES)}")
        return v


class TariffCreate(TariffBase):
    pass


class TariffUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    workstation_type: str | None = Field(default=None, min_length=1, max_length=20)
    price_per_hour: Decimal | None = Field(default=None, gt=0, le=Decimal("99999.99"))

    @field_validator("workstation_type")
    @classmethod
    def _validate_ws_type(cls, v: str | None) -> str | None:
        if v is not None and v not in WORKSTATION_TYPES:
            raise ValueError(f"Тип місця має бути одним із: {', '.join(WORKSTATION_TYPES)}")
        return v


class TariffRead(TariffBase):
    model_config = ConfigDict(from_attributes=True)
    tariff_id: int
    sessions_count: int = 0


# ---------- Workstation ----------
class WorkstationCreate(BaseModel):
    club_id: int
    number: int = Field(gt=0, le=9999)
    type: str = Field(default="Standard", max_length=20)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in WORKSTATION_TYPES:
            raise ValueError(f"Тип місця має бути одним із: {', '.join(WORKSTATION_TYPES)}")
        return v


class WorkstationBulkCreate(BaseModel):
    club_id: int
    number_from: int = Field(gt=0, le=9999)
    number_to: int = Field(gt=0, le=9999)
    type: str = Field(default="Standard", max_length=20)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in WORKSTATION_TYPES:
            raise ValueError(f"Тип місця має бути одним із: {', '.join(WORKSTATION_TYPES)}")
        return v


class WorkstationUpdate(BaseModel):
    club_id: int | None = None
    number: int | None = Field(default=None, gt=0, le=9999)
    type: str | None = Field(default=None, max_length=20)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: str | None) -> str | None:
        if v is not None and v not in WORKSTATION_TYPES:
            raise ValueError(f"Тип місця має бути одним із: {', '.join(WORKSTATION_TYPES)}")
        return v


class WorkstationStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=20)


class WorkstationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    workstation_id: int
    club_id: int
    club_name: str | None = None
    number: int
    type: str
    status: str
    active_session_id: int | None = None
    active_client_id: int | None = None
    active_client_name: str | None = None
    sessions_count: int = 0


# ---------- Staff ----------
class StaffBase(BaseModel):
    club_id: int
    full_name: str = Field(min_length=1, max_length=100)
    position: str = Field(min_length=1, max_length=50)


class StaffCreate(StaffBase):
    hire_date: date_type | None = None


class StaffUpdate(BaseModel):
    club_id: int | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    position: str | None = Field(default=None, min_length=1, max_length=50)
    hire_date: date_type | None = None


class StaffRead(StaffBase):
    model_config = ConfigDict(from_attributes=True)
    staff_id: int
    club_name: str | None = None
    hire_date: date_type


class OrgChartMember(BaseModel):
    staff_id: int
    full_name: str
    hire_date: date_type
    club_id: int
    club_name: str


class OrgChartNode(BaseModel):
    key: str
    position: str
    parent_key: str | None
    members: list[OrgChartMember]
    is_vacant: bool


# ---------- AppUser ----------
class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    full_name: str = Field(min_length=1, max_length=100)
    role: str = Field(min_length=1, max_length=30)
    club_id: int | None = None
    staff_id: int | None = None
    password: str = Field(min_length=8, max_length=72)

    @field_validator("username")
    @classmethod
    def _validate_username(cls, v: str) -> str:
        clean = v.strip().lower()
        if not USERNAME_RE.match(clean):
            raise ValueError("Логін має містити від 3 до 32 символів (латинські літери, цифри або _)")
        return clean


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    role: str | None = Field(default=None, min_length=1, max_length=30)
    club_id: int | None = None
    staff_id: int | None = None
    is_active: bool | None = None


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: int
    username: str
    full_name: str
    role: str
    role_label: str
    club_id: int | None
    club_name: str | None = None
    staff_id: int | None
    staff_name: str | None = None
    is_active: bool
    must_change_password: bool
    created_at: datetime
    last_login_at: datetime | None


class ResetPasswordResponse(BaseModel):
    user_id: int
    username: str
    temporary_password: str


# ---------- Hall & Sessions (Етап 2) ----------
PAYMENT_METHODS = ("готівка", "картка", "бонуси")


class HallActiveSession(BaseModel):
    session_id: int
    client_id: int
    client_name: str
    client_phone: str
    client_bonus_balance: Decimal
    tariff_id: int
    tariff_name: str
    price_per_hour: Decimal
    start_time: datetime
    elapsed_seconds: int
    elapsed_minutes: int
    estimated_amount: Decimal


class HallWorkstationItem(BaseModel):
    workstation_id: int
    club_id: int
    club_name: str
    number: int
    type: str
    status: str
    active_session: HallActiveSession | None = None


class HallSummary(BaseModel):
    total: int
    free: int
    busy: int
    repair: int


class HallResponse(BaseModel):
    server_time: datetime
    club_id: int | None = None
    summary: HallSummary
    items: list[HallWorkstationItem]


class SessionCreate(BaseModel):
    workstation_id: int
    tariff_id: int
    client_id: int | None = None
    new_client_name: str | None = Field(default=None, max_length=100)
    new_client_phone: str | None = Field(default=None, max_length=20)


class SessionFinishRequest(BaseModel):
    method: str = Field(min_length=1, max_length=20)

    @field_validator("method")
    @classmethod
    def _validate_method(cls, v: str) -> str:
        if v not in PAYMENT_METHODS:
            raise ValueError(f"Спосіб оплати має бути одним із: {', '.join(PAYMENT_METHODS)}")
        return v


class SessionRead(BaseModel):
    session_id: int
    client_id: int
    client_name: str
    client_phone: str
    client_bonus_balance: Decimal
    workstation_id: int
    workstation_number: int
    workstation_type: str
    club_id: int
    club_name: str
    tariff_id: int
    tariff_name: str
    price_per_hour: Decimal
    start_time: datetime
    end_time: datetime | None = None
    status: str
    duration_minutes: int
    calculated_amount: Decimal
    payment_id: int | None = None
    payment_amount: Decimal | None = None
    payment_method: str | None = None
    payment_date: datetime | None = None
    bonus_earned: Decimal = Decimal("0.00")
    bonus_spent: Decimal = Decimal("0.00")


class SessionSummary(BaseModel):
    count: int
    minutes: int
    amount: Decimal


class SessionListResponse(BaseModel):
    items: list[SessionRead]
    total: int
    summary: SessionSummary


# ---------- Payments (Етап 2) ----------
class PaymentRead(BaseModel):
    payment_id: int
    session_id: int
    amount: Decimal
    payment_date: datetime
    method: str
    client_id: int
    client_name: str
    client_phone: str
    club_id: int
    club_name: str
    club_address: str
    club_phone: str
    workstation_id: int
    workstation_number: int
    workstation_type: str
    tariff_id: int
    tariff_name: str
    price_per_hour: Decimal
    start_time: datetime
    end_time: datetime | None = None
    duration_minutes: int


class PaymentSummary(BaseModel):
    count: int
    total: Decimal
    cash: Decimal
    card: Decimal
    bonus: Decimal


class PaymentListResponse(BaseModel):
    items: list[PaymentRead]
    total: int
    summary: PaymentSummary

