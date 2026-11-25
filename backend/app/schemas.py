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
DEFAULT_POSITION_RATES: dict[str, Decimal] = {
    "Директор клубу": Decimal("280.00"),
    "Заступник директора (адміністратор клубу)": Decimal("220.00"),
    "Оператор-адміністратор залу": Decimal("165.00"),
    "Технічний персонал": Decimal("135.00"),
    "Бухгалтер": Decimal("210.00"),
    "Системний адміністратор": Decimal("200.00"),
    "Менеджер з реклами та маркетингу": Decimal("175.00"),
    "Менеджер з організації турнірів та заходів": Decimal("180.00"),
}


class StaffBase(BaseModel):
    club_id: int
    full_name: str = Field(min_length=1, max_length=100)
    position: str = Field(min_length=1, max_length=50)


class StaffCreate(StaffBase):
    hire_date: date_type | None = None
    hourly_rate: Decimal | None = Field(default=None, gt=0, le=Decimal("99999.99"))


class StaffUpdate(BaseModel):
    club_id: int | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    position: str | None = Field(default=None, min_length=1, max_length=50)
    hire_date: date_type | None = None
    hourly_rate: Decimal | None = Field(default=None, gt=0, le=Decimal("99999.99"))


class StaffRead(StaffBase):
    model_config = ConfigDict(from_attributes=True)
    staff_id: int
    club_name: str | None = None
    hire_date: date_type
    hourly_rate: Decimal = Decimal("160.00")


class OrgChartMember(BaseModel):
    staff_id: int
    full_name: str
    hire_date: date_type
    club_id: int
    club_name: str
    hourly_rate: Decimal = Decimal("160.00")


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
    planned_minutes: int | None = None
    planned_end_time: datetime | None = None
    is_prepaid: bool = False
    payment_id: int | None = None
    payment_amount: Decimal | None = None
    payment_method: str | None = None
    elapsed_seconds: int
    elapsed_minutes: int
    remaining_seconds: int | None = None
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
    shift_open: bool = False
    current_shift_id: int | None = None
    current_shift_opened_at: datetime | None = None
    current_shift_opened_by: str | None = None
    summary: HallSummary
    items: list[HallWorkstationItem]


class SessionCreate(BaseModel):
    workstation_id: int
    tariff_id: int
    client_id: int | None = None
    new_client_name: str | None = Field(default=None, max_length=100)
    new_client_phone: str | None = Field(default=None, max_length=20)
    planned_hours: Decimal | None = Field(default=None, gt=0, le=Decimal("24"))
    payment_method: str | None = Field(default=None, max_length=20)

    @field_validator("payment_method")
    @classmethod
    def _validate_payment_method(cls, v: str | None) -> str | None:
        if v is not None and v not in PAYMENT_METHODS:
            raise ValueError(f"Спосіб оплати має бути одним із: {', '.join(PAYMENT_METHODS)}")
        return v


class SessionFinishRequest(BaseModel):
    method: str | None = Field(default=None, max_length=20)

    @field_validator("method")
    @classmethod
    def _validate_method(cls, v: str | None) -> str | None:
        if v is not None and v not in PAYMENT_METHODS:
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
    planned_minutes: int | None = None
    planned_end_time: datetime | None = None
    is_prepaid: bool = False
    remaining_seconds: int | None = None
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
    shift_id: int | None = None
    shift_z_number: int | None = None
    shift_label: str | None = None
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


# ---------- Expenses (Етап 3) ----------
EXPENSE_CATEGORIES = ("оренда", "зарплата", "закупівлі", "комунальні", "інше")


class ExpenseCreate(BaseModel):
    club_id: int
    category: str = Field(min_length=1, max_length=50)
    amount: Decimal = Field(gt=0, le=Decimal("99999999.99"))
    expense_date: date_type | None = None
    description: str | None = Field(default=None, max_length=200)

    @field_validator("category")
    @classmethod
    def _validate_cat(cls, v: str) -> str:
        if v not in EXPENSE_CATEGORIES:
            raise ValueError(f"Категорія має бути однією з: {', '.join(EXPENSE_CATEGORIES)}")
        return v


class ExpenseUpdate(BaseModel):
    club_id: int | None = None
    category: str | None = Field(default=None, min_length=1, max_length=50)
    amount: Decimal | None = Field(default=None, gt=0, le=Decimal("99999999.99"))
    expense_date: date_type | None = None
    description: str | None = Field(default=None, max_length=200)

    @field_validator("category")
    @classmethod
    def _validate_cat(cls, v: str | None) -> str | None:
        if v is not None and v not in EXPENSE_CATEGORIES:
            raise ValueError(f"Категорія має бути однією з: {', '.join(EXPENSE_CATEGORIES)}")
        return v


class ExpenseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    expense_id: int
    club_id: int
    club_name: str
    category: str
    amount: Decimal
    expense_date: date_type
    description: str | None = None


class ExpenseCategoryStat(BaseModel):
    category: str
    amount: Decimal
    share_percent: Decimal


class ExpenseSummary(BaseModel):
    count: int
    total: Decimal
    top_category: str | None = None
    top_category_amount: Decimal = Decimal("0.00")
    by_category: list[ExpenseCategoryStat]


class ExpenseListResponse(BaseModel):
    items: list[ExpenseRead]
    total: int
    summary: ExpenseSummary


# ---------- Tournaments & Participations (Етап 3) ----------
class TournamentCreate(BaseModel):
    club_id: int
    name: str = Field(min_length=1, max_length=100)
    game: str = Field(min_length=1, max_length=50)
    date: date_type
    prize_fund: Decimal = Field(default=Decimal("0.00"), ge=0, le=Decimal("99999999.99"))


class TournamentUpdate(BaseModel):
    club_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=100)
    game: str | None = Field(default=None, min_length=1, max_length=50)
    date: date_type | None = None
    prize_fund: Decimal | None = Field(default=None, ge=0, le=Decimal("99999999.99"))


class ParticipantRead(BaseModel):
    participation_id: int
    tournament_id: int
    client_id: int
    client_name: str
    client_phone: str
    place: int | None = None


class ParticipantCreate(BaseModel):
    client_id: int
    place: int | None = Field(default=None, ge=1)


class ParticipantUpdate(BaseModel):
    place: int | None = Field(default=None, ge=1)


class TournamentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    tournament_id: int
    club_id: int
    club_name: str
    name: str
    game: str
    date: date_type
    prize_fund: Decimal
    status: str  # майбутній / сьогодні / завершений
    participants_count: int = 0
    participants: list[ParticipantRead] = []


# ---------- Dashboard & Reports (Етап 4) ----------
class RevenueDayPoint(BaseModel):
    date: date_type
    label: str
    amount: Decimal


class DashboardAlert(BaseModel):
    key: str
    text: str
    link: str


class DashboardWorkstationMini(BaseModel):
    workstation_id: int
    club_id: int
    club_name: str
    number: int
    type: str
    status: str
    client_name: str | None = None


class DashboardShiftMini(BaseModel):
    shift_id: int | None = None
    club_id: int | None = None
    club_name: str | None = None
    is_open: bool = False
    z_label: str | None = None
    opened_at: datetime | None = None
    opened_by_name: str | None = None
    revenue_total: Decimal = Decimal("0.00")
    expected_cash: Decimal = Decimal("0.00")


class DashboardCashYesterday(BaseModel):
    revenue_total: Decimal = Decimal("0.00")
    cash_sales: Decimal = Decimal("0.00")
    cash_difference: Decimal = Decimal("0.00")
    shifts_count: int = 0


class DashboardResponse(BaseModel):
    server_time: datetime
    revenue_today: Decimal
    revenue_yesterday: Decimal
    revenue_month: Decimal
    active_sessions: int
    workstations_total: int
    workstations_available: int
    workstations_free: int
    workstations_repair: int
    occupancy_percent: Decimal
    expenses_month: Decimal
    expenses_prev_month: Decimal
    profit_month: Decimal
    new_clients_7d: int
    new_clients_30d: int
    revenue_14d: list[RevenueDayPoint]
    workstations_now: list[DashboardWorkstationMini]
    upcoming_tournaments: list[TournamentRead]
    recent_payments: list[PaymentRead]
    alerts: list[DashboardAlert]
    current_shift: DashboardShiftMini | None = None
    cash_yesterday: DashboardCashYesterday | None = None
    unreviewed_z_reports_count: int = 0


class FinancePeriodBucket(BaseModel):
    period_key: str
    period_label: str
    revenue: Decimal
    revenue_cash: Decimal
    revenue_card: Decimal
    revenue_bonus: Decimal
    expenses: Decimal
    profit: Decimal
    expenses_by_category: dict[str, Decimal]


class FinanceReportResponse(BaseModel):
    date_from: date_type
    date_to: date_type
    granularity: str
    revenue_total: Decimal
    revenue_cash: Decimal
    revenue_card: Decimal
    revenue_bonus: Decimal
    expenses_total: Decimal
    profit: Decimal
    payments_count: int
    avg_check: Decimal
    expenses_by_category: dict[str, Decimal]
    series: list[FinancePeriodBucket]


class OccupancyByTypeItem(BaseModel):
    type: str
    workstations_count: int
    sessions_count: int
    hours: Decimal
    occupancy_percent: Decimal


class PeakHourItem(BaseModel):
    weekday: int
    weekday_label: str
    hour: int
    hour_label: str
    occupancy_percent: Decimal


class OccupancyReportResponse(BaseModel):
    date_from: date_type
    date_to: date_type
    available_workstations: int
    total_sessions: int
    total_hours: Decimal
    overall_occupancy_percent: Decimal
    heatmap: list[list[Decimal]]  # 7 (Пн..Нд) x 24 (0..23)
    by_type: list[OccupancyByTypeItem]
    peak_hours: list[PeakHourItem]


class TariffReportItem(BaseModel):
    tariff_id: int
    name: str
    workstation_type: str
    price_per_hour: Decimal
    sessions_count: int
    hours: Decimal
    revenue: Decimal


class WorkstationReportItem(BaseModel):
    workstation_id: int
    club_id: int
    club_name: str
    number: int
    type: str
    status: str
    sessions_count: int
    hours: Decimal
    revenue: Decimal
    occupancy_percent: Decimal
    is_most_loaded: bool = False
    is_least_loaded: bool = False


class TariffsReportResponse(BaseModel):
    date_from: date_type
    date_to: date_type
    tariffs: list[TariffReportItem]
    workstations: list[WorkstationReportItem]


class TopClientItem(BaseModel):
    client_id: int
    full_name: str
    phone: str
    sessions_count: int
    total_spent: Decimal
    bonus_balance: Decimal


class NewClientsBucket(BaseModel):
    period_key: str
    period_label: str
    count: int


class ClientsReportResponse(BaseModel):
    date_from: date_type
    date_to: date_type
    total_clients: int
    new_clients_period: int
    active_clients_period: int
    returning_clients_count: int
    returning_share_percent: Decimal
    top_clients: list[TopClientItem]
    new_clients_series: list[NewClientsBucket]


class TournamentReportRow(BaseModel):
    tournament_id: int
    name: str
    game: str
    club_name: str
    date: date_type
    status: str
    participants_count: int
    prize_fund: Decimal
    winner_name: str | None = None


class TournamentsReportResponse(BaseModel):
    date_from: date_type
    date_to: date_type
    tournaments_count: int
    participants_total: int
    prize_fund_total: Decimal
    items: list[TournamentReportRow]


# ---------- Зміни та Каса (Розділи 7.16, 7.17, 8.1) ----------
CASH_OPERATION_TYPES = ("внесення", "вилучення", "інкасація")
CASH_WITHDRAWAL_CATEGORIES = ("господарські витрати", "закупівля", "виплата", "інше")


class ShiftOpenRequest(BaseModel):
    club_id: int | None = None
    opening_cash: Decimal = Field(ge=0, le=Decimal("99999999.99"))
    comment: str | None = Field(default=None, max_length=300)


class ShiftCloseRequest(BaseModel):
    actual_cash: Decimal = Field(ge=0, le=Decimal("99999999.99"))
    collection: Decimal = Field(default=Decimal("0.00"), ge=0, le=Decimal("99999999.99"))
    card_terminal_total: Decimal | None = Field(default=None, ge=0, le=Decimal("99999999.99"))
    comment: str | None = Field(default=None, max_length=300)


class ShiftForceCloseRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=300)

    @field_validator("comment")
    @classmethod
    def _validate_comment(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Коментар обов'язковий для примусового закриття зміни")
        return clean


class ShiftReviewRequest(BaseModel):
    note: str | None = Field(default=None, max_length=300)


class CashOperationCreate(BaseModel):
    club_id: int | None = None
    type: str = Field(min_length=1, max_length=20)
    amount: Decimal = Field(gt=0, le=Decimal("99999999.99"))
    category: str | None = Field(default=None, max_length=30)
    comment: str | None = Field(default=None, max_length=200)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in CASH_OPERATION_TYPES:
            raise ValueError(f"Тип операції має бути одним із: {', '.join(CASH_OPERATION_TYPES)}")
        return v


class CashOperationRead(BaseModel):
    operation_id: int
    shift_id: int
    shift_z_number: int | None = None
    shift_label: str
    club_id: int
    club_name: str
    type: str
    amount: Decimal
    category: str | None = None
    comment: str | None = None
    created_at: datetime
    created_by_user_id: int
    created_by_name: str


class CashOperationSummary(BaseModel):
    count: int
    cash_in: Decimal
    cash_out: Decimal
    collection: Decimal


class CashOperationListResponse(BaseModel):
    items: list[CashOperationRead]
    total: int
    summary: CashOperationSummary


class ShiftRead(BaseModel):
    shift_id: int
    club_id: int
    club_name: str
    club_address: str
    z_number: int | None = None
    z_label: str
    next_z_number: int | None = None
    business_date: date_type
    status: str
    opened_at: datetime
    opened_by_user_id: int
    opened_by_name: str
    opening_cash: Decimal
    opening_difference: Decimal
    open_note: str | None = None
    closed_at: datetime | None = None
    closed_by_user_id: int | None = None
    closed_by_name: str | None = None
    force_closed: bool
    duration_minutes: int
    revenue_total: Decimal
    cash_sales: Decimal
    card_sales: Decimal
    bonus_sales: Decimal
    avg_check: Decimal
    payments_count: int
    sessions_completed: int
    sessions_cancelled: int
    sessions_carried_over: int
    active_sessions_now: int = 0
    cash_in: Decimal
    cash_out: Decimal
    collection: Decimal
    expected_cash: Decimal
    actual_cash: Decimal
    cash_difference: Decimal
    cash_left: Decimal
    card_terminal_total: Decimal | None = None
    card_difference: Decimal | None = None
    close_note: str | None = None
    review_status: str
    reviewed_by_user_id: int | None = None
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None


class ShiftDetailResponse(ShiftRead):
    payments: list[PaymentRead] = []
    operations: list[CashOperationRead] = []
    active_sessions: list[SessionRead] = []


class CurrentShiftStateResponse(BaseModel):
    club_id: int | None = None
    club_name: str = ""
    is_open: bool = False
    current_shift: ShiftDetailResponse | None = None
    last_closed_shift: ShiftRead | None = None
    suggested_opening_cash: Decimal = Decimal("0.00")


class ShiftListResponse(BaseModel):
    items: list[ShiftRead]
    total: int
    unreviewed_count: int = 0


class DailyCashRow(BaseModel):
    business_date: date_type
    club_id: int
    club_name: str
    shifts_count: int
    has_open_shift: bool
    revenue_total: Decimal
    cash_sales: Decimal
    card_sales: Decimal
    bonus_sales: Decimal
    cash_in: Decimal
    cash_out: Decimal
    collection: Decimal
    cash_difference: Decimal
    cash_left_end_of_day: Decimal
    shifts: list[ShiftRead] = []


class DailyCashSummary(BaseModel):
    days_count: int
    shifts_count: int
    revenue_total: Decimal
    cash_sales: Decimal
    card_sales: Decimal
    bonus_sales: Decimal
    cash_in: Decimal
    cash_out: Decimal
    collection: Decimal
    cash_difference: Decimal


class DailyCashResponse(BaseModel):
    items: list[DailyCashRow]
    summary: DailyCashSummary






# ---------- Зарплата та Табель годин (Бухгалтерія) ----------
PAYROLL_PAYMENT_METHODS = ("картка", "готівка", "переказ")


class WorkLogCreate(BaseModel):
    staff_id: int
    work_date: date_type | None = None
    hours_worked: Decimal = Field(gt=0, le=Decimal("24.00"))
    bonus_amount: Decimal = Field(default=Decimal("0.00"), ge=0, le=Decimal("999999.99"))
    comment: str | None = Field(default=None, max_length=200)


class WorkLogRead(BaseModel):
    log_id: int
    staff_id: int
    staff_name: str
    position: str
    club_id: int
    club_name: str
    shift_id: int | None = None
    shift_label: str | None = None
    work_date: date_type
    hours_worked: Decimal
    hourly_rate_snapshot: Decimal
    base_pay: Decimal
    bonus_amount: Decimal
    total_pay: Decimal
    comment: str | None = None
    created_at: datetime


class PayrollPayoutCreate(BaseModel):
    staff_id: int
    period_from: date_type
    period_to: date_type
    hours_paid: Decimal = Field(default=Decimal("0.00"), ge=0)
    base_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    bonus_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    amount_paid: Decimal = Field(gt=0, le=Decimal("9999999.99"))
    payment_method: str = Field(default="картка", max_length=30)
    note: str | None = Field(default=None, max_length=200)
    create_expense: bool = True

    @field_validator("payment_method")
    @classmethod
    def _validate_method(cls, v: str) -> str:
        if v not in PAYROLL_PAYMENT_METHODS:
            raise ValueError(
                f"Спосіб виплати має бути одним із: {', '.join(PAYROLL_PAYMENT_METHODS)}"
            )
        return v


class PayrollPayoutRead(BaseModel):
    payout_id: int
    staff_id: int
    staff_name: str
    position: str
    club_id: int
    club_name: str
    expense_id: int | None = None
    period_from: date_type
    period_to: date_type
    hours_paid: Decimal
    base_amount: Decimal
    bonus_amount: Decimal
    amount_paid: Decimal
    payment_method: str
    paid_at: datetime
    paid_by_name: str | None = None
    note: str | None = None


class StaffPayrollRow(BaseModel):
    staff_id: int
    full_name: str
    position: str
    club_id: int
    club_name: str
    hire_date: date_type
    hourly_rate: Decimal
    shifts_count: int
    hours_worked: Decimal
    base_pay: Decimal
    bonus_pay: Decimal
    total_accrued: Decimal
    total_paid: Decimal
    balance_due: Decimal
    status: str  # виплачено / частково / очікує виплати / немає нарахувань
    work_logs: list[WorkLogRead] = []
    payouts: list[PayrollPayoutRead] = []


class PayrollSummary(BaseModel):
    staff_count: int
    total_hours: Decimal
    total_base_pay: Decimal
    total_bonus_pay: Decimal
    total_accrued: Decimal
    total_paid: Decimal
    total_balance_due: Decimal


class PayrollReportResponse(BaseModel):
    date_from: date_type
    date_to: date_type
    summary: PayrollSummary
    items: list[StaffPayrollRow]
    recent_payouts: list[PayrollPayoutRead]
