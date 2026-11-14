import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, Receipt, Search, X } from "lucide-react";
import { api, getToken } from "../api.js";
import { StatusBadge } from "../components/Badge.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { ReceiptModal } from "../components/SessionModals.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDateTime, formatDuration, formatMoney } from "../format.js";

const PAGE_SIZE = 17;

function isoDate(d) {
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

function sharePct(part, total) {
  const t = Number(total || 0);
  if (t <= 0) return "0 %";
  return `${Math.round((Number(part || 0) / t) * 100)} %`;
}

export default function PaymentsPage() {
  const { selectedClubId } = useAuth();
  const toast = useToast();

  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState({
    count: 0,
    total: 0,
    cash: 0,
    card: 0,
    bonus: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [periodPreset, setPeriodPreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);

  const [detailPayment, setDetailPayment] = useState(null);
  const [receiptPayment, setReceiptPayment] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

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
    } else if (preset === "yesterday") {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      const s = isoDate(y);
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
    if (methodFilter) params.set("method", methodFilter);
    if (debouncedQuery) params.set("q", debouncedQuery);
    return params;
  }, [selectedClubId, dateFrom, dateTo, methodFilter, debouncedQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildFilterParams();
      params.set("limit", "500");
      const data = await api.get(`/payments?${params.toString()}`);
      setPayments(data?.items || []);
      setSummary(
        data?.summary || { count: 0, total: 0, cash: 0, card: 0, bonus: 0 }
      );
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити реєстр оплат");
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
      const res = await fetch(`${base}/payments/export.csv?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      });
      if (!res.ok) {
        throw new Error("Не вдалося завантажити CSV-файл");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payments_${isoDate(new Date())}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.info("Експорт CSV сформовано");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const totalPages = Math.max(1, Math.ceil(payments.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visiblePayments = payments.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const remainingPages = Math.max(0, totalPages - currentPage);

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Оплати</h1>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={payments.length === 0}
          onClick={handleExportCsv}
        >
          <Download size={16} aria-hidden="true" />
          <span>Експорт CSV</span>
        </button>
      </div>

      {/* 4 картки-підсумки: Усього · Готівка · Картка · Бонуси */}
      <div className="kpi-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Усього ({summary.count} чеків)</span>
          <span className="kpi-value tabular-nums accent-text">
            {formatMoney(summary.total)}
          </span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">
            Готівка ({sharePct(summary.cash, summary.total)})
          </span>
          <span className="kpi-value tabular-nums">{formatMoney(summary.cash)}</span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">
            Картка ({sharePct(summary.card, summary.total)})
          </span>
          <span className="kpi-value tabular-nums">{formatMoney(summary.card)}</span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">
            Бонуси ({sharePct(summary.bonus, summary.total)})
          </span>
          <span className="kpi-value tabular-nums">{formatMoney(summary.bonus)}</span>
        </div>
      </div>

      {/* Фільтри */}
      <div className="filters-bar">
        <div className="chip-group" role="group" aria-label="Період оплат">
          {[
            { key: "all", label: "Увесь час" },
            { key: "today", label: "Сьогодні" },
            { key: "yesterday", label: "Вчора" },
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

        <div className="chip-group" role="group" aria-label="Спосіб оплати">
          {[
            { key: "", label: "Усі способи" },
            { key: "готівка", label: "Готівка" },
            { key: "картка", label: "Картка" },
            { key: "бонуси", label: "Бонуси" },
          ].map((m) => (
            <button
              key={m.key}
              type="button"
              className={`filter-chip ${methodFilter === m.key ? "active" : ""}`}
              onClick={() => setMethodFilter(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="search-input-wrap">
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            placeholder="Пошук за клієнтом або № чека…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className="search-clear"
              aria-label="Очистити"
              onClick={() => setSearchInput("")}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={7} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : payments.length === 0 ? (
          <EmptyState text="За обраний період оплат не знайдено." />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Дата й час</th>
                  <th>Зміна</th>
                  <th>Клієнт</th>
                  <th>Сеанс і місце</th>
                  <th>Спосіб</th>
                  <th className="num">Сума</th>
                  <th aria-label="Дії" className="actions-col" />
                </tr>
              </thead>
              <tbody>
                {visiblePayments.map((p) => (
                  <tr
                    key={p.payment_id}
                    className="clickable-row"
                    onClick={() => setDetailPayment(p)}
                  >
                    <td className="tabular-nums font-medium">№ {p.payment_id}</td>
                    <td className="tabular-nums">{formatDateTime(p.payment_date)}</td>
                    <td className="tabular-nums" onClick={(e) => e.stopPropagation()}>
                      {p.shift_id ? (
                        <Link to={`/cash/z/${p.shift_id}`} className="table-link font-medium">
                          {p.shift_label || `#${p.shift_id}`}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Link to={`/clients/${p.client_id}`} className="table-link font-medium">
                        {p.client_name}
                      </Link>
                    </td>
                    <td>
                      Сеанс № {p.session_id}, місце №{" "}
                      {String(p.workstation_number).padStart(2, "0")}{" "}
                      <span className="subtle-meta">({p.workstation_type})</span>
                    </td>
                    <td>
                      <StatusBadge status={p.method} />
                    </td>
                    <td className="num tabular-nums font-medium">{formatMoney(p.amount)}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setReceiptPayment(p)}
                      >
                        <Receipt size={14} aria-hidden="true" />
                        <span>Квитанція</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="table-summary-bar tabular-nums">
              <span>
                Чеків: <strong>{summary.count}</strong>
              </span>
              <span>
                Готівка: <strong>{formatMoney(summary.cash)}</strong>
              </span>
              <span>
                Картка: <strong>{formatMoney(summary.card)}</strong>
              </span>
              <span>
                Бонуси: <strong>{formatMoney(summary.bonus)}</strong>
              </span>
              <span>
                Разом: <strong>{formatMoney(summary.total)}</strong>
              </span>
            </div>
          </>
        )}
      </div>

      {!loading && !error && payments.length > 0 && (
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

      {/* Деталі оплати в Drawer */}
      <Drawer
        open={Boolean(detailPayment)}
        title={detailPayment ? `Оплата № ${detailPayment.payment_id}` : "Деталі оплати"}
        onClose={() => setDetailPayment(null)}
      >
        {detailPayment && (
          <div className="stack-form">
            <dl className="desc-list">
              <div className="desc-row">
                <dt>Дата й час оплати</dt>
                <dd className="tabular-nums">{formatDateTime(detailPayment.payment_date)}</dd>
              </div>
              <div className="desc-row">
                <dt>Клуб</dt>
                <dd>{detailPayment.club_name}</dd>
              </div>
              <div className="desc-row">
                <dt>Зміна</dt>
                <dd className="tabular-nums">
                  {detailPayment.shift_id ? (
                    <Link
                      to={`/cash/z/${detailPayment.shift_id}`}
                      className="table-link font-medium"
                    >
                      {detailPayment.shift_label || `#${detailPayment.shift_id}`}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="desc-row">
                <dt>Клієнт</dt>
                <dd>
                  <Link
                    to={`/clients/${detailPayment.client_id}`}
                    className="table-link font-medium"
                  >
                    {detailPayment.client_name}
                  </Link>
                </dd>
              </div>
              <div className="desc-row">
                <dt>Сеанс і місце</dt>
                <dd>
                  № {detailPayment.session_id} · місце №{" "}
                  {String(detailPayment.workstation_number).padStart(2, "0")} (
                  {detailPayment.workstation_type})
                </dd>
              </div>
              <div className="desc-row">
                <dt>Тариф</dt>
                <dd className="tabular-nums">
                  {detailPayment.tariff_name} ({formatMoney(detailPayment.price_per_hour)} / год)
                </dd>
              </div>
              <div className="desc-row">
                <dt>Тривалість сеансу</dt>
                <dd className="tabular-nums">{formatDuration(detailPayment.duration_minutes)}</dd>
              </div>
              <div className="desc-row">
                <dt>Спосіб оплати</dt>
                <dd>
                  <StatusBadge status={detailPayment.method} />
                </dd>
              </div>
              <div className="desc-row">
                <dt>Сума</dt>
                <dd className="tabular-nums font-medium">
                  {formatMoney(detailPayment.amount)}
                </dd>
              </div>
            </dl>

            <div className="drawer-form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const target = detailPayment;
                  setDetailPayment(null);
                  setReceiptPayment(target);
                }}
              >
                <Receipt size={16} aria-hidden="true" />
                <span>Квитанція</span>
              </button>
            </div>
          </div>
        )}
      </Drawer>

      <ReceiptModal
        open={Boolean(receiptPayment)}
        paymentId={receiptPayment?.payment_id}
        initialPayment={receiptPayment}
        onClose={() => setReceiptPayment(null)}
      />
    </section>
  );
}

