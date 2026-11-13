import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Edit2, Plus, Trash2 } from "lucide-react";
import { api, getToken } from "../api.js";
import { Badge } from "../components/Badge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatMoney } from "../format.js";

const PAGE_SIZE = 17;

const EXPENSE_CATEGORIES = ["оренда", "зарплата", "закупівлі", "комунальні", "інше"];

const CATEGORY_COLORS = {
  оренда: "#0f766e",
  зарплата: "#175cd3",
  закупівлі: "#b54708",
  комунальні: "#6941c6",
  інше: "#475467",
};

const CATEGORY_VARIANTS = {
  оренда: "info",
  зарплата: "success",
  закупівлі: "warning",
  комунальні: "neutral",
  інше: "neutral",
};

function isoDate(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatRemainingPages(remaining) {
  if (remaining <= 0) return "остання сторінка";
  const mod10 = remaining % 10;
  const mod100 = remaining % 100;
  if (mod10 === 1 && mod100 !== 11) return `ще ${remaining} сторінка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `ще ${remaining} сторінки`;
  return `ще ${remaining} сторінок`;
}

export default function ExpensesPage() {
  const { can, clubs, selectedClubId } = useAuth();
  const toast = useToast();
  const canEdit = can("expenses", "full");

  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({
    count: 0,
    total: 0,
    top_category: null,
    top_category_amount: 0,
    by_category: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [periodPreset, setPeriodPreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState({
    club_id: "",
    category: "оренда",
    amount: "",
    expense_date: isoDate(),
    description: "",
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const defaultClubId = selectedClubId || clubs[0]?.club_id || "";

  const applyPreset = (preset) => {
    setPeriodPreset(preset);
    const now = new Date();
    if (preset === "all") {
      setDateFrom("");
      setDateTo("");
    } else if (preset === "today") {
      const s = isoDate(now);
      setDateFrom(s);
      setDateTo(s);
    } else if (preset === "7d") {
      const d = new Date(now);
      d.setDate(now.getDate() - 6);
      setDateFrom(isoDate(d));
      setDateTo(isoDate(now));
    } else if (preset === "month") {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(isoDate(d));
      setDateTo(isoDate(now));
    }
  };

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedClubId) params.set("club_id", String(selectedClubId));
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (categoryFilter) params.set("category", categoryFilter);
    return params;
  }, [selectedClubId, dateFrom, dateTo, categoryFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildFilterParams();
      params.set("limit", "500");
      const data = await api.get(`/expenses?${params.toString()}`);
      setExpenses(data?.items || []);
      setSummary(
        data?.summary || {
          count: 0,
          total: 0,
          top_category: null,
          top_category_amount: 0,
          by_category: [],
        }
      );
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити витрати");
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams]);

  useEffect(() => {
    setPage(1);
    load();
  }, [load]);

  const handleExportCsv = async () => {
    try {
      const params = buildFilterParams();
      const base = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${base}/expenses/export.csv?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      });
      if (!res.ok) throw new Error("Не вдалося сформувати CSV-файл витрат");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expenses_${isoDate()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.info("Експорт витрат у CSV сформовано");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openCreate = () => {
    setEditingExpense(null);
    setForm({
      club_id: String(defaultClubId),
      category: categoryFilter || "оренда",
      amount: "",
      expense_date: isoDate(),
      description: "",
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (exp) => {
    setEditingExpense(exp);
    setForm({
      club_id: String(exp.club_id),
      category: exp.category,
      amount: String(exp.amount),
      expense_date: exp.expense_date,
      description: exp.description || "",
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const clubId = Number(form.club_id);
    const amount = Number(form.amount);
    if (!clubId || !amount || amount <= 0) {
      setFormError("Оберіть клуб і вкажіть суму витрати (більше 0)");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        club_id: clubId,
        category: form.category,
        amount,
        expense_date: form.expense_date || isoDate(),
        description: form.description.trim() || null,
      };
      if (editingExpense) {
        await api.patch(`/expenses/${editingExpense.expense_id}`, payload);
        toast.success("Запис витрати оновлено");
      } else {
        await api.post("/expenses", payload);
        toast.success("Витрату додано");
      }
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.remove("/expenses", deleteTarget.expense_id);
      toast.success("Запис витрати видалено");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err.message);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleExpenses = expenses.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const remainingPages = Math.max(0, totalPages - currentPage);

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Витрати</h1>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={expenses.length === 0}
            onClick={handleExportCsv}
          >
            <Download size={16} aria-hidden="true" />
            <span>Експорт CSV</span>
          </button>
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={18} aria-hidden="true" />
              <span>Додати витрату</span>
            </button>
          )}
        </div>
      </div>

      {/* 2 картки KPI + горизонтальна смуга-розподіл за категоріями */}
      <div className="expenses-top-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Витрати за період ({summary.count} записів)</span>
          <span className="kpi-value tabular-nums">{formatMoney(summary.total)}</span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Найбільша категорія</span>
          <span className="kpi-value tabular-nums">
            {summary.top_category
              ? `${summary.top_category} — ${formatMoney(summary.top_category_amount)}`
              : "—"}
          </span>
        </div>
      </div>

      {Number(summary.total) > 0 && (
        <div className="panel expense-breakdown-panel">
          <div className="expense-bar" role="img" aria-label="Розподіл витрат за категоріями">
            {summary.by_category
              .filter((c) => Number(c.amount) > 0)
              .map((c) => (
                <div
                  key={c.category}
                  className="expense-bar-segment"
                  style={{
                    width: `${Math.max(Number(c.share_percent), 2)}%`,
                    backgroundColor: CATEGORY_COLORS[c.category] || "#475467",
                  }}
                  title={`${c.category}: ${formatMoney(c.amount)} (${c.share_percent} %)`}
                />
              ))}
          </div>

          <div className="expense-legend">
            {summary.by_category.map((c) => (
              <div key={c.category} className="expense-legend-item tabular-nums">
                <span
                  className="expense-legend-dot"
                  style={{ backgroundColor: CATEGORY_COLORS[c.category] || "#475467" }}
                />
                <span className="font-medium">{c.category}:</span>
                <span>{formatMoney(c.amount)}</span>
                <span className="subtle-meta">({c.share_percent} %)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Фільтри */}
      <div className="filters-bar">
        <div className="chip-group" role="group" aria-label="Період витрат">
          {[
            { key: "all", label: "Увесь час" },
            { key: "today", label: "Сьогодні" },
            { key: "7d", label: "7 днів" },
            { key: "month", label: "Місяць" },
            { key: "custom", label: "Свій період" },
          ].map((p) => (
            <button
              key={p.key}
              type="button"
              className={`filter-chip ${periodPreset === p.key ? "active" : ""}`}
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {periodPreset === "custom" && (
          <div className="field-inline">
            <input
              type="date"
              className="select-compact"
              aria-label="Дата від"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span className="subtle-meta">—</span>
            <input
              type="date"
              className="select-compact"
              aria-label="Дата до"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        )}

        <div className="chip-group" role="group" aria-label="Фільтр за категорією витрат">
          <button
            type="button"
            className={`filter-chip ${categoryFilter === "" ? "active" : ""}`}
            onClick={() => setCategoryFilter("")}
          >
            Усі категорії
          </button>
          {EXPENSE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`filter-chip ${categoryFilter === cat ? "active" : ""}`}
              onClick={() => setCategoryFilter(categoryFilter === cat ? "" : cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={6} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : expenses.length === 0 ? (
          <EmptyState
            text="За обраними фільтрами витрат немає."
            actionLabel={canEdit ? "Додати витрату" : undefined}
            onAction={canEdit ? openCreate : undefined}
          />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Клуб</th>
                  <th>Категорія</th>
                  <th>Опис</th>
                  <th className="num">Сума</th>
                  {canEdit && <th aria-label="Дії" className="actions-col" />}
                </tr>
              </thead>
              <tbody>
                {visibleExpenses.map((exp) => (
                  <tr key={exp.expense_id}>
                    <td className="tabular-nums">{formatDate(exp.expense_date)}</td>
                    <td>{exp.club_name}</td>
                    <td>
                      <Badge variant={CATEGORY_VARIANTS[exp.category] || "neutral"}>
                        {exp.category}
                      </Badge>
                    </td>
                    <td>{exp.description || "—"}</td>
                    <td className="num tabular-nums font-medium">
                      {formatMoney(exp.amount)}
                    </td>
                    {canEdit && (
                      <td className="actions">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn-icon"
                            title="Редагувати"
                            aria-label={`Редагувати витрату № ${exp.expense_id}`}
                            onClick={() => openEdit(exp)}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            className="link-danger"
                            onClick={() => setDeleteTarget(exp)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                            <span>Видалити</span>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="table-summary-bar tabular-nums">
              <span>
                Записів: <strong>{summary.count}</strong>
              </span>
              <span>
                Загальна сума: <strong>{formatMoney(summary.total)}</strong>
              </span>
            </div>
          </>
        )}
      </div>

      {!loading && !error && expenses.length > 0 && (
        <nav className="pagination-bar" aria-label="Навігація сторінками">
          <button
            type="button"
            className="pagination-arrow"
            aria-label="Попередня сторінка"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>

          <div className="pagination-info tabular-nums">
            <span className="pagination-page">
              Сторінка <strong>{currentPage}</strong> з <strong>{totalPages}</strong>
            </span>
            <span className="pagination-sep">·</span>
            <span className="pagination-remaining">{formatRemainingPages(remainingPages)}</span>
          </div>

          <button
            type="button"
            className="pagination-arrow"
            aria-label="Наступна сторінка"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
      )}

      <Drawer
        open={drawerOpen}
        title={editingExpense ? "Редагувати витрату" : "Додати витрату"}
        onClose={() => setDrawerOpen(false)}
      >
        <form className="stack-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="exp-club" className="field-label">
              Клуб <span className="required-mark">*</span>
            </label>
            <select
              id="exp-club"
              required
              value={form.club_id}
              onChange={(e) => setForm({ ...form, club_id: e.target.value })}
            >
              <option value="">Оберіть клуб…</option>
              {clubs.map((c) => (
                <option key={c.club_id} value={c.club_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="exp-category" className="field-label">
              Категорія <span className="required-mark">*</span>
            </label>
            <select
              id="exp-category"
              required
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="two-col-fields">
            <div className="field">
              <label htmlFor="exp-amount" className="field-label">
                Сума (₴) <span className="required-mark">*</span>
              </label>
              <input
                id="exp-amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                placeholder="1500.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="exp-date" className="field-label">
                Дата <span className="required-mark">*</span>
              </label>
              <input
                id="exp-date"
                type="date"
                max={isoDate()}
                required
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="exp-desc" className="field-label">
              Опис
            </label>
            <input
              id="exp-desc"
              type="text"
              maxLength={200}
              placeholder="Напр., Закупівля ігрових мишок або оплата оренди"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {formError && (
            <div className="alert" role="alert">
              {formError}
            </div>
          )}

          <div className="drawer-form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDrawerOpen(false)}
              disabled={saving}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Зберігаємо…" : editingExpense ? "Зберегти" : "Додати витрату"}
            </button>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget
            ? `Видалити витрату на суму ${formatMoney(deleteTarget.amount)}?`
            : "Видалити витрату?"
        }
        message="Цей запис витрати буде остаточно видалено з фінансового журналу."
        confirmLabel="Видалити"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

