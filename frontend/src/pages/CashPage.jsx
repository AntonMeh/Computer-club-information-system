import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Landmark,
  ListFilter,
} from "lucide-react";
import { api, getToken } from "../api.js";
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
  const [shiftsData, setShiftsData] = useState({ items: [], unreviewed_count: 0 });
  const [shiftsPage, setShiftsPage] = useState(1);

  // Вкладка 2 — Денна каса
  const [dailyData, setDailyData] = useState({ items: [], summary: null });
  const [expandedDays, setExpandedDays] = useState({});

  // Вкладка 3 — Операції
  const [opTypeFilter, setOpTypeFilter] = useState("");
  const [opCatFilter, setOpCatFilter] = useState("");
  const [opsData, setOpsData] = useState({
    items: [],
    summary: { cash_in_total: 0, cash_out_total: 0, safe_drop_total: 0 },
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
        if (shiftFilterChip === "unreviewed") sp.set("unreviewed_only", "true");
        if (shiftFilterChip === "discrepancy") sp.set("with_discrepancy", "true");
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
        if (shiftFilterChip === "unreviewed") params.set("unreviewed_only", "true");
        if (shiftFilterChip === "discrepancy") params.set("with_discrepancy", "true");
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

  // Пагінація для вкладки «Операції»
  const opsList = opsData.items || [];
  const totalOpPages = Math.max(1, Math.ceil(opsList.length / PAGE_SIZE));
  const currentOpPage = Math.min(opsPage, totalOpPages);
  const visibleOps = opsList.slice(
    (currentOpPage - 1) * PAGE_SIZE,
    currentOpPage * PAGE_SIZE
  );

  return (
    <section className="page-section">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
              <AlertCircle size={13} style={{ marginRight: 4 }} />
              Очікують перевірки: {shiftsData.unreviewed_count}
            </button>
          )}
        </div>

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

      {/* Панель періоду */}
      <div className="panel filter-bar" style={{ marginBottom: 14 }}>
        <div className="chip-group" role="group" aria-label="Період">
          {[
            { id: "all", label: "Весь час" },
            { id: "today", label: "Сьогодні" },
            { id: "yesterday", label: "Вчора" },
            { id: "7d", label: "7 днів" },
            { id: "month", label: "Місяць" },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${periodPreset === p.id ? "active" : ""}`}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="filter-dates">
          <input
            type="date"
            aria-label="Дата від"
            value={dateFrom}
            onChange={(e) => {
              setPeriodPreset("custom");
              setDateFrom(e.target.value);
            }}
          />
          <span className="muted">—</span>
          <input
            type="date"
            aria-label="Дата до"
            value={dateTo}
            onChange={(e) => {
              setPeriodPreset("custom");
              setDateTo(e.target.value);
            }}
          />
        </div>
      </div>

      {/* Три вкладки */}
      <div className="tabs-bar" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`tab-btn ${activeTab === "shifts" ? "active" : ""}`}
          onClick={() => setActiveTab("shifts")}
        >
          <Landmark size={15} />
          <span>Зміни та Z-звіти</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "daily" ? "active" : ""}`}
          onClick={() => setActiveTab("daily")}
        >
          <Calendar size={15} />
          <span>Денна каса</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "operations" ? "active" : ""}`}
          onClick={() => setActiveTab("operations")}
        >
          <FileSpreadsheet size={15} />
          <span>Операції</span>
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : loading ? (
        <SkeletonTable rows={6} cols={8} />
      ) : activeTab === "shifts" ? (
        /* Вкладка 1 — Зміни */
        <div className="panel">
          <div className="filter-bar" style={{ marginBottom: 12 }}>
            <div className="chip-group">
              {[
                { id: "all", label: "Усі" },
                { id: "unreviewed", label: "Очікують перевірки" },
                { id: "discrepancy", label: "З розбіжністю" },
                { id: "forced", label: "Закрито примусово" },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${shiftFilterChip === c.id ? "active" : ""}`}
                  onClick={() => setShiftFilterChip(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {shiftsList.length === 0 ? (
            <EmptyState
              title="Змін не знайдено"
              description="Спробуйте змінити період або фільтр статусу."
            />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
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
                      <th>Перевірено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleShifts.map((s) => {
                      const diff =
                        s.cash_difference != null ? Number(s.cash_difference) : null;
                      const totalSafeDrop =
                        Number(s.safe_drop_total || 0) +
                        Number(s.safe_drop_on_close || 0);
                      return (
                        <tr
                          key={s.shift_id}
                          className="clickable-row"
                          onClick={() => navigate(`/cash/z/${s.shift_id}`)}
                        >
                          <td className="tabular-nums">
                            <strong>
                              {s.z_number
                                ? `Z-${String(s.z_number).padStart(4, "0")}`
                                : "— (відкрита)"}
                            </strong>
                          </td>
                          <td>{s.club_name}</td>
                          <td className="tabular-nums">{formatDate(s.business_date)}</td>
                          <td>
                            <div className="tabular-nums">{formatTime(s.opened_at)}</div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {s.opened_by_name}
                            </div>
                          </td>
                          <td>
                            {s.closed_at ? (
                              <>
                                <div className="tabular-nums">{formatTime(s.closed_at)}</div>
                                <div className="muted" style={{ fontSize: 11 }}>
                                  {s.closed_by_name}
                                </div>
                              </>
                            ) : (
                              <span className="muted">Триває</span>
                            )}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(s.revenue_total)}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(s.expected_cash)}
                          </td>
                          <td className="num tabular-nums">
                            {s.actual_cash != null ? formatMoney(s.actual_cash) : "—"}
                          </td>
                          <td className="num tabular-nums">
                            {diff == null ? (
                              "—"
                            ) : diff === 0 ? (
                              <span className="badge badge-success">0,00 ₴</span>
                            ) : diff > 0 ? (
                              <span className="badge badge-warning">
                                +{formatMoney(diff)}
                              </span>
                            ) : (
                              <span className="badge badge-danger">
                                {formatMoney(diff)}
                              </span>
                            )}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(totalSafeDrop)}
                          </td>
                          <td className="num tabular-nums">
                            {s.closing_cash != null ? formatMoney(s.closing_cash) : "—"}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                s.status === "відкрита"
                                  ? "badge-info"
                                  : s.status === "закрита"
                                  ? "badge-neutral"
                                  : "badge-danger"
                              }`}
                            >
                              {s.status === "закрита примусово" ? "примусово" : s.status}
                            </span>
                          </td>
                          <td>
                            {s.status === "відкрита" ? (
                              <span className="muted">—</span>
                            ) : s.reviewed_at ? (
                              <span className="badge badge-success">✓ Підтверджено</span>
                            ) : (
                              <span className="badge badge-warning">Очікує</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalShiftPages > 1 && (
                <div className="pagination-bar">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={currentShiftPage <= 1}
                    onClick={() => setShiftsPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="pagination-info tabular-nums">
                    Сторінка {currentShiftPage} з {totalShiftPages} ·{" "}
                    {formatRemainingPages(totalShiftPages - currentShiftPage)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={currentShiftPage >= totalShiftPages}
                    onClick={() =>
                      setShiftsPage((p) => Math.min(totalShiftPages, p + 1))
                    }
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : activeTab === "daily" ? (
        /* Вкладка 2 — Денна каса */
        <div className="panel">
          {(dailyData.items || []).length === 0 ? (
            <EmptyState
              title="Даних денної каси немає"
              description="За вибраний період зміни не відкривалися."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Дата</th>
                    <th>Клуб</th>
                    <th className="num">Змін</th>
                    <th className="num">На початок дня</th>
                    <th className="num">Готівка (оплати)</th>
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
                          <td className="tabular-nums">
                            <strong>{formatDate(row.business_date)}</strong>
                          </td>
                          <td>{row.club_name}</td>
                          <td className="num tabular-nums">{row.shifts_count}</td>
                          <td className="num tabular-nums">
                            {formatMoney(row.opening_cash)}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(row.revenue_cash)}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(row.revenue_card)}
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(row.revenue_bonus)}
                          </td>
                          <td className="num tabular-nums text-success">
                            +{formatMoney(row.cash_in_total)}
                          </td>
                          <td className="num tabular-nums text-warning">
                            −{formatMoney(row.cash_out_total)}
                          </td>
                          <td className="num tabular-nums text-info">
                            −{formatMoney(row.safe_drop_total)}
                          </td>
                          <td
                            className={`num tabular-nums ${
                              diff === 0
                                ? ""
                                : diff > 0
                                ? "text-warning"
                                : "text-danger"
                            }`}
                          >
                            {diff > 0 ? "+" : ""}
                            {formatMoney(diff)}
                          </td>
                          <td className="num tabular-nums">
                            <strong>
                              {row.closing_cash != null
                                ? formatMoney(row.closing_cash)
                                : "—"}
                            </strong>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                row.day_status === "Усі Z-звіти перевірено"
                                  ? "badge-success"
                                  : row.day_status === "День не закрито"
                                  ? "badge-info"
                                  : "badge-warning"
                              }`}
                            >
                              {row.day_status}
                            </span>
                          </td>
                        </tr>

                        {isExpanded &&
                          (row.shifts || []).map((sh) => (
                            <tr key={sh.shift_id} className="sub-row">
                              <td />
                              <td colSpan={2} style={{ paddingLeft: 18 }}>
                                <Link
                                  to={`/cash/z/${sh.shift_id}`}
                                  className="link-inline"
                                >
                                  {sh.z_number
                                    ? `Z-${String(sh.z_number).padStart(4, "0")}`
                                    : "Відкрита зміна"}{" "}
                                  ({formatTime(sh.opened_at)} —{" "}
                                  {sh.closed_at ? formatTime(sh.closed_at) : "триває"})
                                </Link>
                              </td>
                              <td className="num muted">1</td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.opening_cash)}
                              </td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.revenue_cash)}
                              </td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.revenue_card)}
                              </td>
                              <td className="num tabular-nums">
                                {formatMoney(sh.revenue_bonus)}
                              </td>
                              <td className="num tabular-nums">
                                +{formatMoney(sh.cash_in_total)}
                              </td>
                              <td className="num tabular-nums">
                                −{formatMoney(sh.cash_out_total)}
                              </td>
                              <td className="num tabular-nums">
                                −
                                {formatMoney(
                                  Number(sh.safe_drop_total || 0) +
                                    Number(sh.safe_drop_on_close || 0)
                                )}
                              </td>
                              <td className="num tabular-nums">
                                {sh.cash_difference != null
                                  ? formatMoney(sh.cash_difference)
                                  : "—"}
                              </td>
                              <td className="num tabular-nums">
                                {sh.closing_cash != null
                                  ? formatMoney(sh.closing_cash)
                                  : "—"}
                              </td>
                              <td>
                                <span className="muted" style={{ fontSize: 12 }}>
                                  {sh.opened_by_name}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>

                {dailyData.summary && (
                  <tfoot>
                    <tr className="table-summary-row">
                      <td colSpan={3}>
                        <strong>Разом за період</strong>
                      </td>
                      <td className="num tabular-nums">
                        <strong>{dailyData.summary.shifts_count}</strong>
                      </td>
                      <td className="num">—</td>
                      <td className="num tabular-nums">
                        <strong>{formatMoney(dailyData.summary.revenue_cash)}</strong>
                      </td>
                      <td className="num tabular-nums">
                        <strong>{formatMoney(dailyData.summary.revenue_card)}</strong>
                      </td>
                      <td className="num tabular-nums">
                        <strong>{formatMoney(dailyData.summary.revenue_bonus)}</strong>
                      </td>
                      <td className="num tabular-nums text-success">
                        <strong>+{formatMoney(dailyData.summary.cash_in_total)}</strong>
                      </td>
                      <td className="num tabular-nums text-warning">
                        <strong>−{formatMoney(dailyData.summary.cash_out_total)}</strong>
                      </td>
                      <td className="num tabular-nums text-info">
                        <strong>−{formatMoney(dailyData.summary.safe_drop_total)}</strong>
                      </td>
                      <td className="num tabular-nums">
                        <strong>
                          {formatMoney(dailyData.summary.cash_difference)}
                        </strong>
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Вкладка 3 — Операції */
        <div className="panel">
          <div className="filter-bar" style={{ marginBottom: 12 }}>
            <div className="chip-group">
              {[
                { id: "", label: "Усі типи" },
                { id: "внесення", label: "Внесення" },
                { id: "вилучення", label: "Вилучення" },
                { id: "інкасація", label: "Інкасація" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chip ${opTypeFilter === t.id ? "active" : ""}`}
                  onClick={() => setOpTypeFilter(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Категорія операції"
              className="form-select"
              style={{ maxWidth: 220 }}
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

          {opsList.length === 0 ? (
            <EmptyState
              title="Службових операцій немає"
              description="За вибраними фільтрами операцій не знайдено."
            />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
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
                        <td className="tabular-nums">
                          {formatDateTime(op.created_at)}
                        </td>
                        <td>{op.club_name}</td>
                        <td>
                          <Link
                            to={`/cash/z/${op.shift_id}`}
                            className="link-inline tabular-nums"
                          >
                            {op.z_number
                              ? `Z-${String(op.z_number).padStart(4, "0")}`
                              : `#${op.shift_id}`}
                          </Link>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              op.type === "внесення"
                                ? "badge-success"
                                : op.type === "вилучення"
                                ? "badge-warning"
                                : "badge-info"
                            }`}
                          >
                            {op.type}
                          </span>
                        </td>
                        <td>{op.category || "—"}</td>
                        <td
                          className={`num tabular-nums ${
                            op.type === "внесення" ? "text-success" : "text-danger"
                          }`}
                        >
                          {op.type === "внесення" ? "+" : "−"}
                          {formatMoney(op.amount)}
                        </td>
                        <td>{op.staff_name}</td>
                        <td>{op.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ops-summary-footer">
                <span>
                  Внесено:{" "}
                  <strong className="tabular-nums text-success">
                    +{formatMoney(opsData.summary?.cash_in_total)}
                  </strong>
                </span>
                <span>·</span>
                <span>
                  Вилучено:{" "}
                  <strong className="tabular-nums text-warning">
                    −{formatMoney(opsData.summary?.cash_out_total)}
                  </strong>
                </span>
                <span>·</span>
                <span>
                  Інкасовано:{" "}
                  <strong className="tabular-nums text-info">
                    −{formatMoney(opsData.summary?.safe_drop_total)}
                  </strong>
                </span>
              </div>

              {totalOpPages > 1 && (
                <div className="pagination-bar">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={currentOpPage <= 1}
                    onClick={() => setOpsPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="pagination-info tabular-nums">
                    Сторінка {currentOpPage} з {totalOpPages} ·{" "}
                    {formatRemainingPages(totalOpPages - currentOpPage)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={currentOpPage >= totalOpPages}
                    onClick={() => setOpsPage((p) => Math.min(totalOpPages, p + 1))}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
