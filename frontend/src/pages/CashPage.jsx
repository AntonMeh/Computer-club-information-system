import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Wallet,
} from "lucide-react";
import { api, getToken } from "../api.js";
import { Badge } from "../components/Badge.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
} from "../format.js";

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
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
    return `ще ${remaining} сторінки`;
  return `ще ${remaining} сторінок`;
}

export default function CashPage() {
  const { selectedClubId } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialTab = searchParams.get("tab") || "shifts";
  const initialChip = searchParams.get("filter") || "all";

  const [activeTab, setActiveTab] = useState(initialTab);
  const [periodPreset, setPeriodPreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Вкладка 1 — Зміни
  const [shiftFilterChip, setShiftFilterChip] = useState(initialChip);
  const [shiftsData, setShiftsData] = useState({ items: [], total: 0, unreviewed_count: 0 });
  const [shiftsPage, setShiftsPage] = useState(1);

  // Вкладка 2 — Денна каса
  const [dailyData, setDailyData] = useState({ items: [], summary: null });
  const [expandedDays, setExpandedDays] = useState({});

  // Вкладка 3 — Операції
  const [opTypeFilter, setOpTypeFilter] = useState("");
  const [opCatFilter, setOpCatFilter] = useState("");
  const [opsData, setOpsData] = useState({
    items: [],
    total: 0,
    summary: { count: 0, cash_in: 0, cash_out: 0, collection: 0 },
  });
  const [opsPage, setOpsPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const buildCommonParams = useCallback(() => {
    const p = new URLSearchParams();
    if (selectedClubId) p.set("club_id", String(selectedClubId));
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    return p;
  }, [selectedClubId, dateFrom, dateTo]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const baseParams = buildCommonParams();

      if (activeTab === "shifts") {
        const sp = new URLSearchParams(baseParams);
        if (shiftFilterChip === "unreviewed") sp.set("review_status", "очікує");
        if (shiftFilterChip === "discrepancy") sp.set("with_difference", "true");
        if (shiftFilterChip === "forced") sp.set("force_closed", "true");
        const res = await api.get(`/shifts?${sp.toString()}`);
        setShiftsData(res);
      } else if (activeTab === "daily") {
        const res = await api.get(`/cash/daily?${baseParams.toString()}`);
        setDailyData(res);
      } else if (activeTab === "operations") {
        const op = new URLSearchParams(baseParams);
        if (opTypeFilter) op.set("type", opTypeFilter);
        if (opCatFilter) op.set("category", opCatFilter);
        const res = await api.get(`/cash-operations?${op.toString()}`);
        setOpsData(res);
      }
    } catch (err) {
      setError(err.message || "Помилка завантаження касових даних");
    } finally {
      setLoading(false);
    }
  }, [activeTab, buildCommonParams, shiftFilterChip, opTypeFilter, opCatFilter]);

  useEffect(() => {
    setShiftsPage(1);
    setOpsPage(1);
    loadData();
  }, [loadData]);

  const handleExportCsv = async () => {
    try {
      const base = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
      const params = buildCommonParams();
      let endpoint = "/shifts/export.csv";
      let filename = `shifts_${isoDate(new Date())}.csv`;

      if (activeTab === "shifts") {
        if (shiftFilterChip === "unreviewed") params.set("review_status", "очікує");
        if (shiftFilterChip === "discrepancy") params.set("with_difference", "true");
        if (shiftFilterChip === "forced") params.set("force_closed", "true");
      } else if (activeTab === "daily") {
        endpoint = "/cash/daily/export.csv";
        filename = `daily_cash_${isoDate(new Date())}.csv`;
      } else if (activeTab === "operations") {
        endpoint = "/cash-operations/export.csv";
        filename = `cash_operations_${isoDate(new Date())}.csv`;
        if (opTypeFilter) params.set("type", opTypeFilter);
        if (opCatFilter) params.set("category", opCatFilter);
      }

      const res = await fetch(`${base}${endpoint}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Не вдалося завантажити CSV-файл");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.info("CSV-файл сформовано");
    } catch (err) {
      toast.error(err.message || "Помилка експорту CSV");
    }
  };

  const toggleDayExpand = (key) => {
    setExpandedDays((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Пагінація для вкладки «Зміни»
  const shiftsList = shiftsData.items || [];
  const totalShiftPages = Math.max(1, Math.ceil(shiftsList.length / PAGE_SIZE));
  const currentShiftPage = Math.min(shiftsPage, totalShiftPages);
  const visibleShifts = shiftsList.slice(
    (currentShiftPage - 1) * PAGE_SIZE,
    currentShiftPage * PAGE_SIZE
  );
  const remainingShiftPages = Math.max(0, totalShiftPages - currentShiftPage);

  const shiftsSumRevenue = shiftsList.reduce(
    (acc, s) => acc + Number(s.revenue_total || 0),
    0
  );
  const shiftsSumCash = shiftsList.reduce(
    (acc, s) => acc + Number(s.cash_sales || 0),
    0
  );
  const shiftsSumCard = shiftsList.reduce(
    (acc, s) => acc + Number(s.card_sales || 0),
    0
  );
  const shiftsSumCollection = shiftsList.reduce(
    (acc, s) => acc + Number(s.collection || 0),
    0
  );

  // Пагінація для вкладки «Операції»
  const opsList = opsData.items || [];
  const totalOpPages = Math.max(1, Math.ceil(opsList.length / PAGE_SIZE));
  const currentOpPage = Math.min(opsPage, totalOpPages);
  const visibleOps = opsList.slice(
    (currentOpPage - 1) * PAGE_SIZE,
    currentOpPage * PAGE_SIZE
  );
  const remainingOpPages = Math.max(0, totalOpPages - currentOpPage);

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="hall-title-row">
          <h1>Каса і Z-звіти</h1>
          {shiftsData.unreviewed_count > 0 && (
            <button
              type="button"
              className="badge badge-warning clickable-badge"
              onClick={() => {
                setActiveTab("shifts");
                setShiftFilterChip("unreviewed");
              }}
              title="Показати Z-звіти, що очікують перевірки бухгалтером"
            >
              <AlertCircle size={13} />
              <span>Очікують перевірки: {shiftsData.unreviewed_count}</span>
            </button>
          )}
        </div>

        <div className="header-actions">
          <div className="tabs-bar" role="tablist" aria-label="Підрозділи каси">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "shifts"}
              className={`tab-btn ${activeTab === "shifts" ? "active" : ""}`}
              onClick={() => setActiveTab("shifts")}
            >
              <Landmark size={15} aria-hidden="true" />
              <span>Зміни та Z-звіти</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "daily"}
              className={`tab-btn ${activeTab === "daily" ? "active" : ""}`}
              onClick={() => setActiveTab("daily")}
            >
              <Calendar size={15} aria-hidden="true" />
              <span>Денна каса</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "operations"}
              className={`tab-btn ${activeTab === "operations" ? "active" : ""}`}
              onClick={() => setActiveTab("operations")}
            >
              <FileSpreadsheet size={15} aria-hidden="true" />
              <span>Операції</span>
            </button>
          </div>

          <Link to="/payroll" className="btn btn-secondary">
            <Wallet size={15} aria-hidden="true" />
            <span>Зарплата і табель</span>
          </Link>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportCsv}
          >
            <Download size={16} aria-hidden="true" />
            <span>
              {activeTab === "daily" ? "Експорт денної каси CSV" : "Експорт CSV"}
            </span>
          </button>
        </div>
      </div>

      {/* KPI картки відповідно до активної вкладки */}
      {activeTab === "shifts" && (
        <div className="kpi-grid">
          <div className="panel kpi-card">
            <span className="kpi-label">Виручка змін ({shiftsList.length} змін)</span>
            <span className="kpi-value tabular-nums accent-text">
              {formatMoney(shiftsSumRevenue)}
            </span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Готівкові оплати</span>
            <span className="kpi-value tabular-nums">{formatMoney(shiftsSumCash)}</span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Оплати карткою</span>
            <span className="kpi-value tabular-nums">{formatMoney(shiftsSumCard)}</span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Інкасація в сейф</span>
            <span className="kpi-value tabular-nums">{formatMoney(shiftsSumCollection)}</span>
          </div>
        </div>
      )}

      {activeTab === "daily" && dailyData.summary && (
        <div className="kpi-grid">
          <div className="panel kpi-card">
            <span className="kpi-label">
              Виручка за період ({dailyData.summary.days_count} дн. / {dailyData.summary.shifts_count} змін)
            </span>
            <span className="kpi-value tabular-nums accent-text">
              {formatMoney(dailyData.summary.revenue_total)}
            </span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Готівкові оплати</span>
            <span className="kpi-value tabular-nums">
              {formatMoney(dailyData.summary.cash_sales)}
            </span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Інкасація за період</span>
            <span className="kpi-value tabular-nums">
              {formatMoney(dailyData.summary.collection)}
            </span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Сумарна різниця каси</span>
            <span
              className={`kpi-value tabular-nums ${
                Number(dailyData.summary.cash_difference) === 0
                  ? ""
                  : Number(dailyData.summary.cash_difference) > 0
                  ? "kpi-value-warning"
                  : "kpi-value-negative"
              }`}
            >
              {Number(dailyData.summary.cash_difference) > 0 ? "+" : ""}
              {formatMoney(dailyData.summary.cash_difference)}
            </span>
          </div>
        </div>
      )}

      {activeTab === "operations" && (
        <div className="kpi-grid">
          <div className="panel kpi-card">
            <span className="kpi-label">Усього операцій</span>
            <span className="kpi-value tabular-nums">{opsData.summary?.count ?? 0}</span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Службові внесення (+)</span>
            <span className="kpi-value tabular-nums kpi-value-positive">
              +{formatMoney(opsData.summary?.cash_in)}
            </span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Службові вилучення (−)</span>
            <span className="kpi-value tabular-nums kpi-value-warning">
              −{formatMoney(opsData.summary?.cash_out)}
            </span>
          </div>
          <div className="panel kpi-card">
            <span className="kpi-label">Інкасація (−)</span>
            <span className="kpi-value tabular-nums text-info">
              −{formatMoney(opsData.summary?.collection)}
            </span>
          </div>
        </div>
      )}

      {/* Панель фільтрів */}
      <div className="filters-bar">
        <div className="chip-group" role="group" aria-label="Період">
          {[
            { id: "all", label: "Увесь час" },
            { id: "today", label: "Сьогодні" },
            { id: "yesterday", label: "Вчора" },
            { id: "7d", label: "7 днів" },
            { id: "month", label: "Місяць" },
            { id: "custom", label: "Свій період" },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              className={`filter-chip ${periodPreset === p.id ? "active" : ""}`}
              onClick={() => applyPreset(p.id)}
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

        {activeTab === "shifts" && (
          <div className="chip-group" role="group" aria-label="Фільтр змін">
            {[
              { id: "all", label: "Усі зміни" },
              { id: "unreviewed", label: "Очікують перевірки" },
              { id: "discrepancy", label: "З розбіжністю" },
              { id: "forced", label: "Закрито примусово" },
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                className={`filter-chip ${shiftFilterChip === c.id ? "active" : ""}`}
                onClick={() => setShiftFilterChip(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {activeTab === "operations" && (
          <div className="chip-group" role="group" aria-label="Фільтр типу операції">
            {[
              { id: "", label: "Усі типи" },
              { id: "внесення", label: "Внесення" },
              { id: "вилучення", label: "Вилучення" },
              { id: "інкасація", label: "Інкасація" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                className={`filter-chip ${opTypeFilter === t.id ? "active" : ""}`}
                onClick={() => setOpTypeFilter(t.id)}
              >
                {t.label}
              </button>
            ))}

            <select
              aria-label="Категорія операції"
              className="select-compact"
              value={opCatFilter}
              onChange={(e) => setOpCatFilter(e.target.value)}
            >
              <option value="">Усі категорії</option>
              <option value="господарські витрати">господарські витрати</option>
              <option value="закупівля">закупівля</option>
              <option value="виплата">виплата</option>
              <option value="інше">інше</option>
            </select>
          </div>
        )}
      </div>

      {/* Контент активної вкладки */}
      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={8} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : activeTab === "shifts" ? (
          /* Вкладка 1 — Зміни */
          shiftsList.length === 0 ? (
            <EmptyState text="За обраними фільтрами змін не знайдено." />
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Z-номер</th>
                    <th>Клуб</th>
                    <th>Дата зміни</th>
                    <th>Відкрито</th>
                    <th>Закрито</th>
                    <th className="num">Виручка</th>
                    <th className="num">Очікувалось</th>
                    <th className="num">Фактично</th>
                    <th className="num">Різниця</th>
                    <th className="num">Інкасація</th>
                    <th className="num">Залишок</th>
                    <th>Статус</th>
                    <th>Перевірка</th>
                    <th aria-label="Дії" className="actions-col" />
                  </tr>
                </thead>
                <tbody>
                  {visibleShifts.map((s) => {
                    const isOpen = s.status === "відкрита";
                    const diff = Number(s.cash_difference || 0);
                    return (
                      <tr
                        key={s.shift_id}
                        className="clickable-row"
                        onClick={() => navigate(`/cash/z/${s.shift_id}`)}
                      >
                        <td className="tabular-nums font-medium">
                          <Link
                            to={`/cash/z/${s.shift_id}`}
                            className="table-link font-medium"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {s.z_label}
                          </Link>
                        </td>
                        <td>{s.club_name}</td>
                        <td className="tabular-nums">{formatDate(s.business_date)}</td>
                        <td>
                          <span className="tabular-nums">{formatTime(s.opened_at)}</span>{" "}
                          <span className="subtle-meta">· {s.opened_by_name}</span>
                        </td>
                        <td>
                          {s.closed_at ? (
                            <>
                              <span className="tabular-nums">{formatTime(s.closed_at)}</span>{" "}
                              <span className="subtle-meta">· {s.closed_by_name}</span>
                            </>
                          ) : (
                            <span className="subtle-meta">Триває</span>
                          )}
                        </td>
                        <td className="num tabular-nums font-medium">
                          {formatMoney(s.revenue_total)}
                        </td>
                        <td className="num tabular-nums">
                          {formatMoney(s.expected_cash)}
                        </td>
                        <td className="num tabular-nums">
                          {isOpen ? "—" : formatMoney(s.actual_cash)}
                        </td>
                        <td className="num tabular-nums">
                          {isOpen ? (
                            "—"
                          ) : diff === 0 ? (
                            <Badge variant="success">0,00 ₴</Badge>
                          ) : diff > 0 ? (
                            <Badge variant="warning">+{formatMoney(diff)}</Badge>
                          ) : (
                            <Badge variant="danger">{formatMoney(diff)}</Badge>
                          )}
                        </td>
                        <td className="num tabular-nums">{formatMoney(s.collection)}</td>
                        <td className="num tabular-nums font-medium">
                          {isOpen ? "—" : formatMoney(s.cash_left)}
                        </td>
                        <td>
                          {isOpen ? (
                            <Badge variant="info">відкрита</Badge>
                          ) : s.force_closed ? (
                            <Badge variant="danger">примусово</Badge>
                          ) : (
                            <Badge variant="neutral">закрита</Badge>
                          )}
                        </td>
                        <td>
                          {isOpen ? (
                            <span className="subtle-meta">—</span>
                          ) : s.review_status === "підтверджена" ? (
                            <Badge variant="success">✓ Підтверджено</Badge>
                          ) : (
                            <Badge variant="warning">Очікує</Badge>
                          )}
                        </td>
                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          <Link
                            to={`/cash/z/${s.shift_id}`}
                            className="btn btn-secondary btn-sm"
                          >
                            <FileText size={14} aria-hidden="true" />
                            <span>{isOpen ? "X-звіт" : "Z-звіт"}</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="table-summary-bar tabular-nums">
                <span>
                  Змін: <strong>{shiftsList.length}</strong>
                </span>
                <span>
                  Готівка: <strong>{formatMoney(shiftsSumCash)}</strong>
                </span>
                <span>
                  Картка: <strong>{formatMoney(shiftsSumCard)}</strong>
                </span>
                <span>
                  Інкасація: <strong>{formatMoney(shiftsSumCollection)}</strong>
                </span>
                <span>
                  Виручка разом: <strong>{formatMoney(shiftsSumRevenue)}</strong>
                </span>
              </div>
            </>
          )
        ) : activeTab === "daily" ? (
          /* Вкладка 2 — Денна каса */
          (dailyData.items || []).length === 0 ? (
            <EmptyState text="За обраний період даних денної каси немає." />
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th>Дата</th>
                    <th>Клуб</th>
                    <th className="num">Змін</th>
                    <th className="num">Виручка</th>
                    <th className="num">Готівка</th>
                    <th className="num">Картка</th>
                    <th className="num">Бонуси</th>
                    <th className="num">Внесення</th>
                    <th className="num">Вилучення</th>
                    <th className="num">Інкасація</th>
                    <th className="num">Різниця</th>
                    <th className="num">На кінець дня</th>
                    <th>Статус дня</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyData.items.map((row) => {
                    const rowKey = `${row.business_date}_${row.club_id}`;
                    const isExpanded = Boolean(expandedDays[rowKey]);
                    const diff = Number(row.cash_difference || 0);
                    const allReviewed = (row.shifts || []).every(
                      (sh) => sh.status !== "відкрита" && sh.review_status === "підтверджена"
                    );
                    const dayStatusLabel = row.has_open_shift
                      ? "День не закрито"
                      : allReviewed
                      ? "Усі Z-звіти перевірено"
                      : "Очікує перевірки";

                    return (
                      <Fragment key={rowKey}>
                        <tr
                          className="clickable-row"
                          onClick={() => toggleDayExpand(rowKey)}
                        >
                          <td>
                            {isExpanded ? (
                              <ChevronUp size={15} />
                            ) : (
                              <ChevronDown size={15} />
                            )}
                          </td>
                          <td className="tabular-nums font-medium">
                            {formatDate(row.business_date)}
                          </td>
                          <td>{row.club_name}</td>
                          <td className="num tabular-nums">{row.shifts_count}</td>
                          <td className="num tabular-nums font-medium">
                            {formatMoney(row.revenue_total)}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(row.cash_sales)}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(row.card_sales)}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(row.bonus_sales)}
                          </td>
                          <td className="num tabular-nums kpi-value-positive">
                            +{formatMoney(row.cash_in)}
                          </td>
                          <td className="num tabular-nums kpi-value-warning">
                            −{formatMoney(row.cash_out)}
                          </td>
                          <td className="num tabular-nums text-info">
                            −{formatMoney(row.collection)}
                          </td>
                          <td
                            className={`num tabular-nums ${
                              diff === 0
                                ? ""
                                : diff > 0
                                ? "kpi-value-warning"
                                : "kpi-value-negative"
                            }`}
                          >
                            {diff > 0 ? "+" : ""}
                            {formatMoney(diff)}
                          </td>
                          <td className="num tabular-nums font-medium">
                            {formatMoney(row.cash_left_end_of_day)}
                          </td>
                          <td>
                            <Badge
                              variant={
                                row.has_open_shift
                                  ? "info"
                                  : allReviewed
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {dayStatusLabel}
                            </Badge>
                          </td>
                        </tr>

                        {isExpanded &&
                          (row.shifts || []).map((sh) => (
                            <tr key={sh.shift_id} className="sub-row">
                              <td />
                              <td colSpan={2}>
                                <Link
                                  to={`/cash/z/${sh.shift_id}`}
                                  className="table-link font-medium"
                                >
                                  {sh.z_label} ({formatTime(sh.opened_at)} —{" "}
                                  {sh.closed_at ? formatTime(sh.closed_at) : "триває"})
                                </Link>
                              </td>
                              <td className="num subtle-meta">1</td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.revenue_total)}
                              </td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.cash_sales)}
                              </td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.card_sales)}
                              </td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.bonus_sales)}
                              </td>
                              <td className="num tabular-nums">
                                +{formatMoney(sh.cash_in)}
                              </td>
                              <td className="num tabular-nums">
                                −{formatMoney(sh.cash_out)}
                              </td>
                              <td className="num tabular-nums">
                                −{formatMoney(sh.collection)}
                              </td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.cash_difference)}
                              </td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.cash_left)}
                              </td>
                              <td>
                                <span className="subtle-meta">{sh.opened_by_name}</span>
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              {dailyData.summary && (
                <div className="table-summary-bar tabular-nums">
                  <span>
                    Днів: <strong>{dailyData.summary.days_count}</strong> (змін:{" "}
                    <strong>{dailyData.summary.shifts_count}</strong>)
                  </span>
                  <span>
                    Готівка: <strong>{formatMoney(dailyData.summary.cash_sales)}</strong>
                  </span>
                  <span>
                    Картка: <strong>{formatMoney(dailyData.summary.card_sales)}</strong>
                  </span>
                  <span>
                    Внесення: <strong>+{formatMoney(dailyData.summary.cash_in)}</strong>
                  </span>
                  <span>
                    Вилучення: <strong>−{formatMoney(dailyData.summary.cash_out)}</strong>
                  </span>
                  <span>
                    Інкасація: <strong>−{formatMoney(dailyData.summary.collection)}</strong>
                  </span>
                  <span>
                    Разом виручка:{" "}
                    <strong>{formatMoney(dailyData.summary.revenue_total)}</strong>
                  </span>
                </div>
              )}
            </>
          )
        ) : /* Вкладка 3 — Операції */
        opsList.length === 0 ? (
          <EmptyState text="За обраними фільтрами службових операцій не знайдено." />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Дата й час</th>
                  <th>Клуб</th>
                  <th>Зміна</th>
                  <th>Тип</th>
                  <th>Категорія</th>
                  <th className="num">Сума</th>
                  <th>Хто провів</th>
                  <th>Коментар</th>
                </tr>
              </thead>
              <tbody>
                {visibleOps.map((op) => (
                  <tr key={op.operation_id}>
                    <td className="tabular-nums font-medium">№ {op.operation_id}</td>
                    <td className="tabular-nums">{formatDateTime(op.created_at)}</td>
                    <td>{op.club_name}</td>
                    <td>
                      <Link
                        to={`/cash/z/${op.shift_id}`}
                        className="table-link font-medium tabular-nums"
                      >
                        {op.shift_label}
                      </Link>
                    </td>
                    <td>
                      <Badge
                        variant={
                          op.type === "внесення"
                            ? "success"
                            : op.type === "вилучення"
                            ? "warning"
                            : "info"
                        }
                      >
                        {op.type}
                      </Badge>
                    </td>
                    <td>{op.category || "—"}</td>
                    <td
                      className={`num tabular-nums font-medium ${
                        op.type === "внесення"
                          ? "kpi-value-positive"
                          : "kpi-value-negative"
                      }`}
                    >
                      {op.type === "внесення" ? "+" : "−"}
                      {formatMoney(op.amount)}
                    </td>
                    <td>{op.created_by_name}</td>
                    <td>{op.comment || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="table-summary-bar tabular-nums">
              <span>
                Операцій: <strong>{opsData.summary?.count ?? opsList.length}</strong>
              </span>
              <span>
                Внесено:{" "}
                <strong className="kpi-value-positive">
                  +{formatMoney(opsData.summary?.cash_in)}
                </strong>
              </span>
              <span>
                Вилучено:{" "}
                <strong className="kpi-value-warning">
                  −{formatMoney(opsData.summary?.cash_out)}
                </strong>
              </span>
              <span>
                Інкасовано:{" "}
                <strong className="text-info">
                  −{formatMoney(opsData.summary?.collection)}
                </strong>
              </span>
            </div>
          </>
        )}
      </div>

      {/* Пагінація для вкладки «Зміни» */}
      {!loading && !error && activeTab === "shifts" && shiftsList.length > 0 && (
        <nav className="pagination-bar" aria-label="Навігація сторінками змін">
          <button
            type="button"
            className="pagination-arrow"
            aria-label="Попередня сторінка"
            disabled={currentShiftPage <= 1}
            onClick={() => setShiftsPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <div className="pagination-info tabular-nums">
            <span className="pagination-page">
              Сторінка <strong>{currentShiftPage}</strong> з{" "}
              <strong>{totalShiftPages}</strong>
            </span>
            <span className="pagination-sep">·</span>
            <span className="pagination-remaining">
              {formatRemainingPages(remainingShiftPages)}
            </span>
          </div>
          <button
            type="button"
            className="pagination-arrow"
            aria-label="Наступна сторінка"
            disabled={currentShiftPage >= totalShiftPages}
            onClick={() => setShiftsPage((p) => Math.min(totalShiftPages, p + 1))}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
      )}

      {/* Пагінація для вкладки «Операції» */}
      {!loading && !error && activeTab === "operations" && opsList.length > 0 && (
        <nav className="pagination-bar" aria-label="Навігація сторінками операцій">
          <button
            type="button"
            className="pagination-arrow"
            aria-label="Попередня сторінка"
            disabled={currentOpPage <= 1}
            onClick={() => setOpsPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <div className="pagination-info tabular-nums">
            <span className="pagination-page">
              Сторінка <strong>{currentOpPage}</strong> з{" "}
              <strong>{totalOpPages}</strong>
            </span>
            <span className="pagination-sep">·</span>
            <span className="pagination-remaining">
              {formatRemainingPages(remainingOpPages)}
            </span>
          </div>
          <button
            type="button"
            className="pagination-arrow"
            aria-label="Наступна сторінка"
            disabled={currentOpPage >= totalOpPages}
            onClick={() => setOpsPage((p) => Math.min(totalOpPages, p + 1))}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
      )}
    </section>
  );
}
