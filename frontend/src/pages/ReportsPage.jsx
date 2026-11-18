import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  Clock,
  Download,
  Flame,
  Printer,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { api, getToken } from "../api.js";
import { Badge } from "../components/Badge.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatMoney, formatPhone } from "../format.js";

const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);

const EXPENSE_LABELS = {
  оренда: "Оренда приміщення",
  зарплата: "Зарплата персоналу",
  закупівлі: "Закупівлі та обладнання",
  комунальні: "Комунальні послуги та інтернет",
  інше: "Інші операційні витрати",
};

const WS_TYPE_VARIANT = {
  Standard: "neutral",
  VIP: "warning",
  PlayStation: "info",
};

function isoDate(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getPresetDates(preset) {
  const today = new Date();
  const to = isoDate(today);
  if (preset === "today") {
    return { from: to, to };
  }
  if (preset === "7d") {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return { from: isoDate(d), to };
  }
  if (preset === "month") {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    return { from: isoDate(d), to };
  }
  if (preset === "quarter") {
    const d = new Date(today);
    d.setDate(d.getDate() - 89);
    return { from: isoDate(d), to };
  }
  if (preset === "year") {
    const d = new Date(today);
    d.setDate(d.getDate() - 364);
    return { from: isoDate(d), to };
  }
  return { from: to, to };
}

export default function ReportsPage() {
  const { can, selectedClubId } = useAuth();
  const toast = useToast();
  const canSeeFinance = can("reports", "full");

  const [activeTab, setActiveTab] = useState(() =>
    canSeeFinance ? "finance" : "occupancy"
  );
  const [periodPreset, setPeriodPreset] = useState("month");
  const [dateFrom, setDateFrom] = useState(() => getPresetDates("month").from);
  const [dateTo, setDateTo] = useState(() => getPresetDates("month").to);
  const [granularity, setGranularity] = useState("day");

  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canSeeFinance && activeTab === "finance") {
      setActiveTab("occupancy");
    }
  }, [canSeeFinance, activeTab]);

  const handlePresetChange = (preset) => {
    setPeriodPreset(preset);
    if (preset !== "custom") {
      const { from, to } = getPresetDates(preset);
      setDateFrom(from);
      setDateTo(to);
      if (preset === "year") setGranularity("month");
      else if (preset === "quarter") setGranularity("week");
      else setGranularity("day");
    }
  };

  const buildQueryParams = useCallback(
    (extra = {}) => {
      const params = new URLSearchParams();
      if (selectedClubId) params.set("club_id", String(selectedClubId));
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (activeTab === "finance" || activeTab === "clients") {
        params.set("granularity", granularity);
      }
      Object.entries(extra).forEach(([k, v]) => {
        if (v !== undefined && v !== null) params.set(k, String(v));
      });
      return params.toString();
    },
    [selectedClubId, dateFrom, dateTo, activeTab, granularity]
  );

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = buildQueryParams();
      const res = await api.get(`/reports/${activeTab}?${qs}`);
      setReportData(res);
    } catch (err) {
      setError(err.message || "Не вдалося сформувати звіт");
    } finally {
      setLoading(false);
    }
  }, [activeTab, buildQueryParams]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExportCsv = async () => {
    try {
      const qs = buildQueryParams({ format: "csv" });
      const base = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${base}/reports/${activeTab}?${qs}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Не вдалося завантажити CSV");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report_${activeTab}_${dateFrom}_${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV-файл звіту завантажено");
    } catch (err) {
      toast.error(err.message || "Помилка експорту CSV");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const tabs = [
    ...(canSeeFinance
      ? [{ id: "finance", label: "Фінанси", icon: Wallet }]
      : []),
    { id: "occupancy", label: "Завантаженість", icon: Clock },
    { id: "tariffs", label: "Тарифи і місця", icon: BarChart3 },
    { id: "clients", label: "Клієнти", icon: Users },
    { id: "tournaments", label: "Турніри", icon: Trophy },
  ];

  return (
    <div className="page reports-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Звіти</h1>
          <p className="subtle-meta">
            Період: {formatDate(dateFrom)} — {formatDate(dateTo)}
          </p>
        </div>
        <div className="header-actions no-print">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportCsv}
          >
            <Download size={16} />
            Експорт CSV
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePrint}
          >
            <Printer size={16} />
            Друкувати
          </button>
        </div>
      </div>

      {/* Вкладки звітів */}
      <div className="reports-controls-row no-print">
        <div className="tabs-bar" role="tablist">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`tab-btn ${activeTab === t.id ? "active" : ""}`}
                onClick={() => {
                  setReportData(null);
                  setActiveTab(t.id);
                }}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Період та деталізація */}
        <div className="filters-bar">
          <div className="chip-group">
            {[
              { id: "today", label: "Сьогодні" },
              { id: "7d", label: "7 днів" },
              { id: "month", label: "Місяць" },
              { id: "quarter", label: "Квартал" },
              { id: "year", label: "Рік" },
              { id: "custom", label: "Свій період" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={`filter-chip ${periodPreset === p.id ? "active" : ""}`}
                onClick={() => handlePresetChange(p.id)}
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
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span className="subtle-meta">—</span>
              <input
                type="date"
                className="select-compact"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          )}

          {(activeTab === "finance" || activeTab === "clients") && (
            <div className="field-inline">
              <span className="subtle-meta">Групування:</span>
              <select
                className="select-compact"
                value={granularity}
                onChange={(e) => setGranularity(e.target.value)}
              >
                <option value="day">За днями</option>
                <option value="week">За тижнями</option>
                <option value="month">За місяцями</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Тіло активної вкладки */}
      {loading ? (
        <div className="panel">
          <SkeletonTable rows={6} cols={5} />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={loadReport} />
        </div>
      ) : (
        <>
          {activeTab === "finance" && reportData && (
            <FinanceTabContent data={reportData} />
          )}
          {activeTab === "occupancy" && reportData && (
            <OccupancyTabContent data={reportData} />
          )}
          {activeTab === "tariffs" && reportData && (
            <TariffsTabContent data={reportData} selectedClubId={selectedClubId} />
          )}
          {activeTab === "clients" && reportData && (
            <ClientsTabContent data={reportData} />
          )}
          {activeTab === "tournaments" && reportData && (
            <TournamentsTabContent data={reportData} />
          )}
        </>
      )}
    </div>
  );
}

/* ==========================================================================
   1. ВКЛАДКА «ФІНАНСИ»
   ========================================================================== */
function FinanceTabContent({ data }) {
  const profitNum = Number(data.profit ?? 0);
  const series = data.series || [];
  const maxVal = Math.max(
    1,
    ...series.flatMap((b) => [Number(b.revenue || 0), Number(b.expenses || 0)])
  );

  return (
    <div className="report-tab-stack">
      <div className="kpi-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Виручка за період</span>
          <span className="kpi-value num">{formatMoney(data.revenue_total)}</span>
          <span className="kpi-subtext">
            Готівка: {formatMoney(data.revenue_cash)} · Картка:{" "}
            {formatMoney(data.revenue_card)}
          </span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Витрати за період</span>
          <span className="kpi-value num">{formatMoney(data.expenses_total)}</span>
          <span className="kpi-subtext">Усі категорії витрат</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Прибуток (Виручка − Витрати)</span>
          <span
            className={`kpi-value num ${
              profitNum >= 0 ? "kpi-value-positive" : "kpi-value-negative"
            }`}
          >
            {formatMoney(data.profit)}
          </span>
          <span className="kpi-subtext">
            {profitNum >= 0 ? "Прибуткова діяльність" : "Збитковий період"}
          </span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Середній чек</span>
          <span className="kpi-value num">{formatMoney(data.avg_check)}</span>
          <span className="kpi-subtext">Оплат за період: {data.payments_count}</span>
        </div>
      </div>

      {/* Стовпчиковий графік «Виручка і витрати» */}
      <div className="panel report-section-panel">
        <div className="dashboard-panel-header">
          <div>
            <h2 className="section-title" style={{ marginBottom: 2 }}>
              Динаміка виручки та витрат
            </h2>
            <p className="subtle-meta">
              Порівняння надходжень і операційних витрат за обраними інтервалами
            </p>
          </div>
          <div className="chart-legend">
            <span className="chart-legend-item">
              <span className="chart-legend-swatch revenue" /> Виручка
            </span>
            <span className="chart-legend-item">
              <span className="chart-legend-swatch expense" /> Витрати
            </span>
          </div>
        </div>

        {series.length === 0 ? (
          <EmptyState message="Немає даних для побудови графіка за цей період." />
        ) : (
          <div className="chart-canvas-wrap">
            <div className="chart-grid-lines" aria-hidden="true">
              {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                <div key={ratio} className="chart-grid-line">
                  <span className="chart-axis-label tabular-nums">
                    {Math.round(maxVal * ratio)} ₴
                  </span>
                </div>
              ))}
            </div>
            <div className="dual-bar-chart-scroll">
              <div className="dual-bar-chart">
                {series.map((b) => {
                  const rev = Number(b.revenue || 0);
                  const exp = Number(b.expenses || 0);
                  const revPct = rev > 0 ? Math.max(4, Math.round((rev / maxVal) * 100)) : 2;
                  const expPct = exp > 0 ? Math.max(4, Math.round((exp / maxVal) * 100)) : 2;
                  return (
                    <div
                      key={b.period_key}
                      className="dual-bar-group"
                      title={`${b.period_label}\nВиручка: ${formatMoney(rev)}\nВитрати: ${formatMoney(exp)}\nПрибуток: ${formatMoney(b.profit)}`}
                    >
                      <div className="dual-bar-pair">
                        <div
                          className={`dual-bar revenue ${rev === 0 ? "zero" : ""}`}
                          style={{ height: `${revPct}%` }}
                        />
                        <div
                          className={`dual-bar expense ${exp === 0 ? "zero" : ""}`}
                          style={{ height: `${expPct}%` }}
                        />
                      </div>
                      <div className="dual-bar-label num">{b.period_label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Звіт про прибутки і збитки (P&L) */}
      <div className="panel">
        <div className="panel-inner-header">
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            Прибутки і збитки (P&L)
          </h2>
          <p className="subtle-meta">
            Структура доходів за способом оплати та витрат за статтями
          </p>
        </div>
        <div className="table-wrap">
          <table className="pnl-table">
            <thead>
              <tr>
                <th>Стаття звіту</th>
                <th className="num">Сума</th>
                <th className="num">Частка</th>
              </tr>
            </thead>
            <tbody>
              <tr className="pnl-group-row">
                <td colSpan={3}>1. Виручка від ігрових сеансів</td>
              </tr>
              {[
                { label: "Готівка", val: Number(data.revenue_cash || 0) },
                { label: "Банківська картка", val: Number(data.revenue_card || 0) },
                { label: "Оплата бонусами", val: Number(data.revenue_bonus || 0) },
              ].map((item) => {
                const revTotal = Number(data.revenue_total || 0);
                const pct = revTotal > 0 ? (item.val / revTotal) * 100 : 0;
                return (
                  <tr key={item.label}>
                    <td className="pnl-indent">{item.label}</td>
                    <td className="num tabular-nums">{formatMoney(item.val)}</td>
                    <td className="num">
                      <div className="inline-progress-cell">
                        <div className="inline-progress-track">
                          <div
                            className="inline-progress-fill"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="tabular-nums">
                          {pct.toFixed(1).replace(".", ",")}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="pnl-subtotal-row">
                <td>Усього виручка</td>
                <td className="num tabular-nums">{formatMoney(data.revenue_total)}</td>
                <td className="num tabular-nums">100,0%</td>
              </tr>

              <tr className="pnl-group-row">
                <td colSpan={3}>2. Операційні витрати за категоріями</td>
              </tr>
              {Object.entries(EXPENSE_LABELS).map(([catKey, label]) => {
                const amt = Number(data.expenses_by_category?.[catKey] || 0);
                const expTotal = Number(data.expenses_total || 0);
                const pct = expTotal > 0 ? (amt / expTotal) * 100 : 0;
                return (
                  <tr key={catKey}>
                    <td className="pnl-indent">{label}</td>
                    <td className="num tabular-nums">{formatMoney(amt)}</td>
                    <td className="num">
                      <div className="inline-progress-cell">
                        <div className="inline-progress-track">
                          <div
                            className="inline-progress-fill expense-fill"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="tabular-nums">
                          {pct.toFixed(1).replace(".", ",")}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="pnl-subtotal-row">
                <td>Усього витрати</td>
                <td className="num tabular-nums">{formatMoney(data.expenses_total)}</td>
                <td className="num tabular-nums">100,0%</td>
              </tr>

              <tr className="pnl-total-row">
                <td>3. Чистий фінансовий результат (Прибуток / Збиток)</td>
                <td
                  className={`num ${
                    profitNum >= 0 ? "kpi-value-positive" : "kpi-value-negative"
                  }`}
                >
                  {formatMoney(data.profit)}
                </td>
                <td className="num">
                  {Number(data.revenue_total) > 0
                    ? `Рентабельність: ${(
                        (profitNum / Number(data.revenue_total)) *
                        100
                      )
                        .toFixed(1)
                        .replace(".", ",")}%`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   2. ВКЛАДКА «ЗАВАНТАЖЕНІСТЬ»
   ========================================================================== */
function OccupancyTabContent({ data }) {
  const heatmap = data.heatmap || [];
  const peakHours = data.peak_hours || [];
  const byType = data.by_type || [];

  return (
    <div className="report-tab-stack">
      <div className="kpi-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Середня завантаженість</span>
          <span className="kpi-value num">
            {Number(data.overall_occupancy_percent ?? 0)
              .toFixed(1)
              .replace(".", ",")}
            %
          </span>
          <span className="kpi-subtext">За формулою без місць на ремонті</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Відпрацьовано годин</span>
          <span className="kpi-value num">
            {Number(data.total_hours ?? 0).toFixed(1).replace(".", ",")} год
          </span>
          <span className="kpi-subtext">Сумарний ігровий час</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Кількість сеансів</span>
          <span className="kpi-value num">{data.total_sessions ?? 0}</span>
          <span className="kpi-subtext">Активні та завершені сеанси</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Доступно місць</span>
          <span className="kpi-value num">{data.available_workstations ?? 0}</span>
          <span className="kpi-subtext">Враховано у знаменнику</span>
        </div>
      </div>

      {/* 3 пікові години */}
      <div className="panel report-section-panel">
        <div className="dashboard-panel-header">
          <div className="hall-title-row">
            <Flame size={18} className="accent-text" />
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              Пікові години навантаження
            </h2>
          </div>
          <span className="subtle-meta">Топ-3 найзавантаженіші часові слоти тижня</span>
        </div>

        {peakHours.length === 0 ? (
          <p className="muted" style={{ padding: 0 }}>
            За обраний період достатньої активності для визначення пікових годин немає.
          </p>
        ) : (
          <div className="peak-hours-grid">
            {peakHours.map((ph, idx) => (
              <div key={`${ph.weekday}-${ph.hour}`} className="peak-hour-card">
                <div className="peak-hour-rank num">#{idx + 1}</div>
                <div className="peak-hour-info">
                  <div className="font-medium">
                    {ph.weekday_label} · <span className="num">{ph.hour_label}</span>
                  </div>
                  <div className="subtle-meta">
                    Середня завантаженість слоту:{" "}
                    <strong className="num accent-text">
                      {Number(ph.occupancy_percent).toFixed(1).replace(".", ",")}%
                    </strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Теплова карта «День тижня × Година» */}
      <div className="panel report-section-panel">
        <div className="dashboard-panel-header">
          <div>
            <h2 className="section-title" style={{ marginBottom: 2 }}>
              Теплова карта завантаженості (день тижня × година)
            </h2>
            <p className="subtle-meta">
              Наведіть курсор на комірку, щоб побачити середній відсоток зайнятості за годину
            </p>
          </div>
          <div className="heatmap-legend tabular-nums">
            <span className="subtle-meta">Шкала:</span>
            <span className="heatmap-legend-step lvl-0">0%</span>
            <span className="heatmap-legend-step lvl-1">25%</span>
            <span className="heatmap-legend-step lvl-2">50%</span>
            <span className="heatmap-legend-step lvl-3">75%+</span>
          </div>
        </div>

        <div className="heatmap-scroll">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th className="heatmap-day-col">День</th>
                {HOURS_24.map((h) => (
                  <th key={h} className="heatmap-hour-col num">
                    {String(h).padStart(2, "0")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAY_NAMES.map((dayLabel, wdIdx) => {
                const row = heatmap[wdIdx] || [];
                return (
                  <tr key={dayLabel}>
                    <td className="heatmap-day-label font-medium">{dayLabel}</td>
                    {HOURS_24.map((h) => {
                      const pct = Number(row[h] ?? 0);
                      const levelClass =
                        pct <= 0
                          ? "lvl-0"
                          : pct < 35
                          ? "lvl-1"
                          : pct < 65
                          ? "lvl-2"
                          : "lvl-3";
                      return (
                        <td
                          key={h}
                          className={`heatmap-cell num ${levelClass}`}
                          title={`${dayLabel}, ${String(h).padStart(2, "0")}:00–${String(
                            (h + 1) % 24
                          ).padStart(2, "0")}:00 — ${pct.toFixed(1).replace(".", ",")}%`}
                        >
                          {pct >= 1 ? Math.round(pct) : ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Таблиця за типом місця */}
      <div className="panel">
        <div className="panel-inner-header">
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            Завантаженість за типом місця
          </h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тип місця</th>
                <th className="num">Доступних місць</th>
                <th className="num">Сеансів</th>
                <th className="num">Відпрацьовано годин</th>
                <th className="num">Завантаженість</th>
              </tr>
            </thead>
            <tbody>
              {byType.map((row) => {
                const pct = Number(row.occupancy_percent ?? 0);
                return (
                  <tr key={row.type}>
                    <td>
                      <Badge variant={WS_TYPE_VARIANT[row.type] || "neutral"}>
                        {row.type}
                      </Badge>
                    </td>
                    <td className="num">{row.workstations_count}</td>
                    <td className="num">{row.sessions_count}</td>
                    <td className="num">
                      {Number(row.hours).toFixed(1).replace(".", ",")} год
                    </td>
                    <td className="num">
                      <div className="inline-progress-cell">
                        <div className="inline-progress-track">
                          <div
                            className="inline-progress-fill"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="num font-medium">
                          {pct.toFixed(1).replace(".", ",")}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   3. ВКЛАДКА «ТАРИФИ І МІСЦЯ»
   ========================================================================== */
function TariffsTabContent({ data, selectedClubId }) {
  const tariffs = data.tariffs || [];
  const workstations = data.workstations || [];
  const maxTariffRev = Math.max(
    1,
    ...tariffs.map((t) => Number(t.revenue || 0))
  );

  return (
    <div className="report-tab-stack">
      {/* Виручка за тарифами */}
      <div className="panel">
        <div className="panel-inner-header">
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            Виручка та попит за тарифами
          </h2>
          <p className="subtle-meta">
            Порівняння кількості сеансів, відпрацьованих годин та виручки за кожним тарифом
          </p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тариф</th>
                <th>Тип місця</th>
                <th className="num">Ціна / год</th>
                <th className="num">Сеансів</th>
                <th className="num">Годин</th>
                <th className="num">Виручка</th>
                <th className="num">Частка виручки</th>
              </tr>
            </thead>
            <tbody>
              {tariffs.map((t) => {
                const rev = Number(t.revenue || 0);
                const pct = Math.round((rev / maxTariffRev) * 100);
                return (
                  <tr key={t.tariff_id}>
                    <td className="font-medium">{t.name}</td>
                    <td>
                      <Badge variant={WS_TYPE_VARIANT[t.workstation_type] || "neutral"}>
                        {t.workstation_type}
                      </Badge>
                    </td>
                    <td className="num">{formatMoney(t.price_per_hour)}</td>
                    <td className="num">{t.sessions_count}</td>
                    <td className="num">
                      {Number(t.hours).toFixed(1).replace(".", ",")} год
                    </td>
                    <td className="num font-medium">{formatMoney(t.revenue)}</td>
                    <td className="num">
                      <div className="inline-progress-cell">
                        <div className="inline-progress-track">
                          <div
                            className="inline-progress-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Таблиця місць з виділенням найбільш і найменш завантаженого */}
      <div className="panel">
        <div className="panel-inner-header">
          <h2 className="section-title" style={{ marginBottom: 4 }}>
            Завантаженість і виручка за робочими місцями
          </h2>
          <p className="subtle-meta">
            Автоматичне виділення найбільш завантаженого та найменш завантаженого місця за період
          </p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Місце</th>
                {!selectedClubId && <th>Клуб</th>}
                <th>Тип</th>
                <th>Поточний статус</th>
                <th className="num">Сеансів</th>
                <th className="num">Годин</th>
                <th className="num">Виручка</th>
                <th className="num">Завантаженість</th>
              </tr>
            </thead>
            <tbody>
              {workstations.map((w) => (
                <tr
                  key={w.workstation_id}
                  className={
                    w.is_most_loaded
                      ? "row-most-loaded"
                      : w.is_least_loaded
                      ? "row-least-loaded"
                      : ""
                  }
                >
                  <td>
                    <div className="badge-stack">
                      <span className="font-medium num">
                        № {String(w.number).padStart(2, "0")}
                      </span>
                      {w.is_most_loaded && (
                        <Badge variant="success">Найбільш завантажене</Badge>
                      )}
                      {w.is_least_loaded && (
                        <Badge variant="warning">Найменш завантажене</Badge>
                      )}
                    </div>
                  </td>
                  {!selectedClubId && <td>{w.club_name}</td>}
                  <td>
                    <Badge variant={WS_TYPE_VARIANT[w.type] || "neutral"}>
                      {w.type}
                    </Badge>
                  </td>
                  <td>
                    <Badge
                      variant={
                        w.status === "вільне"
                          ? "success"
                          : w.status === "зайняте"
                          ? "info"
                          : "neutral"
                      }
                    >
                      {w.status}
                    </Badge>
                  </td>
                  <td className="num">{w.sessions_count}</td>
                  <td className="num">
                    {Number(w.hours).toFixed(1).replace(".", ",")} год
                  </td>
                  <td className="num font-medium">{formatMoney(w.revenue)}</td>
                  <td className="num">
                    {Number(w.occupancy_percent).toFixed(1).replace(".", ",")}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   4. ВКЛАДКА «КЛІЄНТИ»
   ========================================================================== */
function ClientsTabContent({ data }) {
  const series = data.new_clients_series || [];
  const topClients = data.top_clients || [];
  const maxNewCount = Math.max(1, ...series.map((b) => Number(b.count || 0)));

  return (
    <div className="report-tab-stack">
      <div className="kpi-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Усього клієнтів у базі</span>
          <span className="kpi-value num">{data.total_clients}</span>
          <span className="kpi-subtext">Зареєстровані профілі</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Нові за період</span>
          <span className="kpi-value num">{data.new_clients_period}</span>
          <span className="kpi-subtext">За датою реєстрації</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Активні за період</span>
          <span className="kpi-value num">{data.active_clients_period}</span>
          <span className="kpi-subtext">Мають принаймні 1 сеанс</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Частка клієнтів, що повернулися</span>
          <span className="kpi-value num">
            {Number(data.returning_share_percent ?? 0)
              .toFixed(1)
              .replace(".", ",")}
            %
          </span>
          <span className="kpi-subtext">
            Повторних візитів (2+ сеанси): {data.returning_clients_count} ос.
          </span>
        </div>
      </div>

      {/* Графік нових клієнтів */}
      <div className="panel report-section-panel">
        <div className="dashboard-panel-header">
          <div>
            <h2 className="section-title" style={{ marginBottom: 2 }}>
              Нові клієнти за період
            </h2>
            <p className="subtle-meta">
              Кількість нових реєстрацій клієнтів у розрізі обраного групування
            </p>
          </div>
        </div>

        <div className="dual-bar-chart-scroll">
          <div className="dual-bar-chart">
            {series.map((b) => {
              const cnt = Number(b.count || 0);
              const pct = cnt > 0 ? Math.max(8, Math.round((cnt / maxNewCount) * 100)) : 2;
              return (
                <div
                  key={b.period_key}
                  className="dual-bar-group"
                  title={`${b.period_label}: ${cnt} нових клієнтів`}
                >
                  <div className="bar-col-amount num">{cnt > 0 ? cnt : ""}</div>
                  <div className="dual-bar-pair single">
                    <div
                      className={`dual-bar revenue ${cnt === 0 ? "zero" : ""}`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <div className="dual-bar-label num">{b.period_label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Топ-10 клієнтів за витратами */}
      <div className="panel">
        <div className="panel-inner-header">
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            Топ-10 клієнтів за витратами за період
          </h2>
        </div>
        {topClients.length === 0 ? (
          <EmptyState message="За обраний період сеансів клієнтів не знайдено." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">№</th>
                  <th>Клієнт</th>
                  <th>Телефон</th>
                  <th className="num">Сеансів за період</th>
                  <th className="num">Витрачено за період</th>
                  <th className="num">Поточний бонусний баланс</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map((c, idx) => (
                  <tr key={c.client_id}>
                    <td className="num">{idx + 1}</td>
                    <td>
                      <Link
                        to={`/clients/${c.client_id}`}
                        className="table-link font-medium"
                      >
                        {c.full_name}
                      </Link>
                    </td>
                    <td className="num">{formatPhone(c.phone)}</td>
                    <td className="num">{c.sessions_count}</td>
                    <td className="num font-medium">{formatMoney(c.total_spent)}</td>
                    <td className="num accent-text">{formatMoney(c.bonus_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   5. ВКЛАДКА «ТУРНІРИ»
   ========================================================================== */
function TournamentsTabContent({ data }) {
  const items = data.items || [];

  return (
    <div className="report-tab-stack">
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="panel kpi-card">
          <span className="kpi-label">Кількість турнірів</span>
          <span className="kpi-value num">{data.tournaments_count}</span>
          <span className="kpi-subtext">За обраний період</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Усього учасників</span>
          <span className="kpi-value num">{data.participants_total}</span>
          <span className="kpi-subtext">Зареєстровано в турнірах періоду</span>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Сума призових фондів</span>
          <span className="kpi-value num">{formatMoney(data.prize_fund_total)}</span>
          <span className="kpi-subtext">Сумарний призовий фонд</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-inner-header">
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            Підсумки турнірів за період
          </h2>
        </div>
        {items.length === 0 ? (
          <EmptyState message="За обраний період турнірів не знайдено." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Турнір</th>
                  <th>Дисципліна</th>
                  <th>Клуб</th>
                  <th>Дата проведення</th>
                  <th>Статус</th>
                  <th className="num">Учасників</th>
                  <th className="num">Призовий фонд</th>
                  <th>Переможець (1 місце)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.tournament_id}>
                    <td>
                      <Link
                        to={`/tournaments/${t.tournament_id}`}
                        className="table-link font-medium"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td>{t.game}</td>
                    <td>{t.club_name}</td>
                    <td className="num">{formatDate(t.date)}</td>
                    <td>
                      <Badge
                        variant={
                          t.status === "запланований"
                            ? "info"
                            : t.status === "триває сьогодні"
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {t.status}
                      </Badge>
                    </td>
                    <td className="num">{t.participants_count}</td>
                    <td className="num font-medium">{formatMoney(t.prize_fund)}</td>
                    <td>
                      {t.winner_name ? (
                        <span
                          className="font-medium accent-text"
                          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                        >
                          <Trophy size={14} aria-hidden="true" />
                          <span>{t.winner_name}</span>
                        </span>
                      ) : (
                        <span className="subtle-meta">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

