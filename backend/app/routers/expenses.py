import csv
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import ensure_club_access, require, scoped_club_id
from ..permissions import FULL, VIEW

router = APIRouter(prefix="/expenses", tags=["expenses"])


def _get_or_404(db: Session, expense_id: int) -> models.Expense:
    exp = db.get(models.Expense, expense_id)
    if exp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Витрату не знайдено")
    return exp


def _to_read(exp: models.Expense) -> schemas.ExpenseRead:
    return schemas.ExpenseRead(
        expense_id=exp.expense_id,
        club_id=exp.club_id,
        club_name=exp.club.name if exp.club else "",
        category=exp.category,
        amount=Decimal(exp.amount).quantize(Decimal("0.01")),
        expense_date=exp.expense_date,
        description=exp.description,
    )


def _filter_expenses(
    db: Session,
    effective_club_id: int | None,
    date_from: date | None,
    date_to: date | None,
    category: str | None,
) -> list[schemas.ExpenseRead]:
    stmt = select(models.Expense).order_by(
        models.Expense.expense_date.desc(), models.Expense.expense_id.desc()
    )
    if effective_club_id is not None:
        stmt = stmt.where(models.Expense.club_id == effective_club_id)
    if date_from is not None:
        stmt = stmt.where(models.Expense.expense_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(models.Expense.expense_date <= date_to)
    if category:
        stmt = stmt.where(models.Expense.category == category)

    rows = db.scalars(stmt).all()
    return [_to_read(r) for r in rows]


def _build_summary(items: list[schemas.ExpenseRead]) -> schemas.ExpenseSummary:
    total_sum = sum((it.amount for it in items), Decimal("0.00")).quantize(Decimal("0.01"))
    cat_totals: dict[str, Decimal] = {c: Decimal("0.00") for c in schemas.EXPENSE_CATEGORIES}
    for it in items:
        cat_totals[it.category] = (
            cat_totals.get(it.category, Decimal("0.00")) + it.amount
        ).quantize(Decimal("0.01"))

    by_category: list[schemas.ExpenseCategoryStat] = []
    top_cat: str | None = None
    top_amt = Decimal("0.00")

    for cat in schemas.EXPENSE_CATEGORIES:
        amt = cat_totals.get(cat, Decimal("0.00"))
        pct = (
            (amt * Decimal(100) / total_sum).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
            if total_sum > 0
            else Decimal("0.0")
        )
        by_category.append(
            schemas.ExpenseCategoryStat(category=cat, amount=amt, share_percent=pct)
        )
        if amt > top_amt:
            top_amt = amt
            top_cat = cat

    return schemas.ExpenseSummary(
        count=len(items),
        total=total_sum,
        top_category=top_cat,
        top_category_amount=top_amt,
        by_category=by_category,
    )


@router.get("", response_model=schemas.ExpenseListResponse)
def list_expenses(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    category: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    user: models.AppUser = Depends(require("expenses", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    items = _filter_expenses(db, effective_club_id, date_from, date_to, category)
    summary = _build_summary(items)
    return schemas.ExpenseListResponse(
        items=items[offset : offset + limit],
        total=len(items),
        summary=summary,
    )


@router.get("/export.csv")
def export_expenses_csv(
    club_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    category: str | None = Query(default=None),
    user: models.AppUser = Depends(require("expenses", VIEW)),
    db: Session = Depends(get_db),
):
    effective_club_id = scoped_club_id(user, club_id)
    items = _filter_expenses(db, effective_club_id, date_from, date_to, category)

    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["№ витрати", "Дата", "Клуб", "Категорія", "Опис", "Сума (₴)"])
    for it in items:
        writer.writerow(
            [
                it.expense_id,
                it.expense_date.strftime("%d.%m.%Y"),
                it.club_name,
                it.category,
                it.description or "",
                f"{it.amount:.2f}".replace(".", ","),
            ]
        )

    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="expenses.csv"'},
    )


@router.post("", response_model=schemas.ExpenseRead, status_code=status.HTTP_201_CREATED)
def create_expense(
    data: schemas.ExpenseCreate,
    user: models.AppUser = Depends(require("expenses", FULL)),
    db: Session = Depends(get_db),
):
    ensure_club_access(user, data.club_id)
    if db.get(models.Club, data.club_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")

    exp_date = data.expense_date or date.today()
    if exp_date > date.today():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Дата витрати не може бути в майбутньому",
        )

    exp = models.Expense(
        club_id=data.club_id,
        category=data.category,
        amount=Decimal(data.amount).quantize(Decimal("0.01")),
        expense_date=exp_date,
        description=data.description.strip() if data.description else None,
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return _to_read(exp)


@router.get("/{expense_id}", response_model=schemas.ExpenseRead)
def get_expense(
    expense_id: int,
    user: models.AppUser = Depends(require("expenses", VIEW)),
    db: Session = Depends(get_db),
):
    exp = _get_or_404(db, expense_id)
    ensure_club_access(user, exp.club_id)
    return _to_read(exp)


@router.patch("/{expense_id}", response_model=schemas.ExpenseRead)
def update_expense(
    expense_id: int,
    data: schemas.ExpenseUpdate,
    user: models.AppUser = Depends(require("expenses", FULL)),
    db: Session = Depends(get_db),
):
    exp = _get_or_404(db, expense_id)
    ensure_club_access(user, exp.club_id)

    updates = data.model_dump(exclude_unset=True)
    if "club_id" in updates and updates["club_id"] is not None:
        ensure_club_access(user, updates["club_id"])
        if db.get(models.Club, updates["club_id"]) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Клуб не знайдено")

    if "expense_date" in updates and updates["expense_date"] is not None:
        if updates["expense_date"] > date.today():
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Дата витрати не може бути в майбутньому",
            )

    for field, value in updates.items():
        if field == "description":
            setattr(exp, field, value.strip() if value else None)
        elif value is not None:
            setattr(exp, field, value)

    db.commit()
    db.refresh(exp)
    return _to_read(exp)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: int,
    user: models.AppUser = Depends(require("expenses", FULL)),
    db: Session = Depends(get_db),
):
    exp = _get_or_404(db, expense_id)
    ensure_club_access(user, exp.club_id)
    db.delete(exp)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

