import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Banknote,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Edit2,
  FileText,
  Landmark,
  Plus,
  Printer,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { api, getToken } from "../api.js";
import { Badge } from "../components/Badge.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import Modal from "../components/Modal.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatDateTime, formatMoney } from "../format.js";

const STAFF_POSITIONS = [
  "Директор клубу",
  "Заступник директора (адміністратор клубу)",
  "Оператор-адміністратор залу",
  "Технічний персонал",
  "Бухгалтер",
  "Системний адміністратор",
  "Менеджер з реклами та маркетингу",
  "Менеджер з організації турнірів та заходів",
];

function isoDate(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getMonthStartIso() {
  const now = new Date();
  return isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function statusBadgeVariant(status) {
  if (status === "виплачено") return "success";
  if (status === "частково") return "info";
  if (status === "очікує виплати") return "warning";
  return "neutral";
}

export default function PayrollPage() {
  const { user, can, selectedClubId } = useAuth();
  const toast = useToast();

  const canManage =
    can("cash", "full") ||
    user?.role === "director" ||
    user?.role === "accountant";

  const [activeTab, setActiveTab] = useState("statement"); // "statement" | "timesheet" | "payouts"
  const [periodPreset, setPeriodPreset] = useState("month");
  const [dateFrom, setDateFrom] = useState(() => getMonthStartIso());
  const [dateTo, setDateTo] = useState(() => isoDate());
  const [positionFilter, setPositionFilter] = useState("");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedStaff, setExpandedStaff] = useState({});

  // Модальне вікно внесення відпрацьованих годин у табель
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logStaffId, setLogStaffId] = useState("");
  const [logDate, setLogDate] = useState(() => isoDate());
  const [logHours, setLogHours] = useState("8");
  const [logBonus, setLogBonus] = useState("0");
  const [logComment, setLogComment] = useState("");
  const [logSaving, setLogSaving] = useState(false);

  // Модальне вікно виплати зарплати
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [payoutTarget, setPayoutTarget] = useState(null);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("картка");
  const [payoutNote, setPayoutNote] = useState("");
  const [payoutCreateExpense, setPayoutCreateExpense] = useState(true);
  const [payoutSaving, setPayoutSaving] = useState(false);

  // Модальне вікно зміни погодинної ставки
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [rateTarget, setRateTarget] = useState(null);
  const [newRate, setNewRate] = useState("");
  const [rateSaving, setRateSaving] = useState(false);

  // Модальне вікно розрахункового листа (Payslip для друку)
  const [payslipTarget, setPayslipTarget] = useState(null);

  const applyPreset = (preset) => {
    setPeriodPreset(preset);
    const now = new Date();
    if (preset === "today") {
      const s = isoDate(now);
      setDateFrom(s);
      setDateTo(s);
    } else if (preset === "7d") {
      const d = new Date(now);
      d.setDate(now.getDate() - 6);
      setDateFrom(isoDate(d));
      setDateTo(isoDate(now));
    } else if (preset === "month") {
      setDateFrom(getMonthStartIso());
      setDateTo(isoDate(now));
    } else if (preset === "prev_month") {
      const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
      setDateFrom(isoDate(firstPrev));
      setDateTo(isoDate(lastPrev));
    } else if (preset === "year") {
      const firstYear = new Date(now.getFullYear(), 0, 1);
      setDateFrom(isoDate(firstYear));
      setDateTo(isoDate(now));
    }
  };

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (selectedClubId) p.set("club_id", String(selectedClubId));
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (positionFilter) p.set("position", positionFilter);
    return p;
  }, [selectedClubId, dateFrom, dateTo, positionFilter]);

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = buildParams().toString();
      const res = await api.get(`/payroll?${qs}`);
      setReport(res);
    } catch (err) {
      setError(err.message || "Не вдалося завантажити зарплатну відомість");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    loadPayroll();
  }, [loadPayroll]);

  const handleExportCsv = async () => {
    try {
      const base = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
      const qs = buildParams().toString();
      const res = await fetch(`${base}/payroll/export.csv?${qs}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Не вдалося сформувати CSV зарплатної відомості");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll_${dateFrom}_${dateTo}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.info("Зарплатну відомість у форматі CSV завантажено");
    } catch (err) {
      toast.error(err.message || "Помилка експорту CSV");
    }
  };

  const toggleExpand = (staffId) => {
    setExpandedStaff((prev) => ({ ...prev, [staffId]: !prev[staffId] }));
  };

  // Додавання відпрацьованих годин
  const openAddHoursModal = (staffRow = null) => {
    const firstId = staffRow?.staff_id || report?.items?.[0]?.staff_id || "";
    setLogStaffId(String(firstId));
    setLogDate(isoDate());
    setLogHours("12");
    setLogBonus("0");
    setLogComment("");
    setLogModalOpen(true);
  };

  const handleCreateWorkLog = async (e) => {
    e.preventDefault();
    const hoursNum = Number(logHours);
    const bonusNum = Number(logBonus || 0);
    if (!logStaffId || !hoursNum || hoursNum <= 0 || hoursNum > 24) {
      toast.error("Вкажіть співробітника та кількість годин (від 0.25 до 24)");
      return;
    }
    setLogSaving(true);
    try {
      await api.post("/payroll/work-logs", {
        staff_id: Number(logStaffId),
        work_date: logDate || isoDate(),
        hours_worked: Number(hoursNum.toFixed(2)),
        bonus_amount: Number(Math.max(0, bonusNum).toFixed(2)),
        comment: logComment.trim() || null,
      });
      toast.success("Відпрацьовані години додано в табель");
      setLogModalOpen(false);
      await loadPayroll();
    } catch (err) {
      toast.error(err.message || "Не вдалося зберегти запис табеля");
    } finally {
      setLogSaving(false);
    }
  };

  const handleDeleteWorkLog = async (logId) => {
    try {
      await api.remove("/payroll/work-logs", logId);
      toast.info("Запис табеля видалено");
      await loadPayroll();
    } catch (err) {
      toast.error(err.message || "Не вдалося видалити запис");
    }
  };

  // Виплата зарплати
  const openPayoutModal = (staffRow) => {
    setPayoutTarget(staffRow);
    const suggested =
      Number(staffRow.balance_due) > 0
        ? Number(staffRow.balance_due).toFixed(2)
        : Number(staffRow.total_accrued || staffRow.hourly_rate * 8).toFixed(2);
    setPayoutAmount(suggested);
    setPayoutMethod("картка");
    setPayoutNote(
      `Виплата за період ${formatDate(dateFrom)}–${formatDate(dateTo)} (${staffRow.hours_worked} год)`
    );
    setPayoutCreateExpense(true);
    setPayoutModalOpen(true);
  };

  const handleCreatePayout = async (e) => {
    e.preventDefault();
    if (!payoutTarget) return;
    const amtNum = Number(payoutAmount);
    if (!amtNum || amtNum <= 0) {
      toast.error("Сума виплати має бути більшою за 0 ₴");
      return;
    }
    setPayoutSaving(true);
    try {
      await api.post("/payroll/payouts", {
        staff_id: payoutTarget.staff_id,
        period_from: dateFrom || getMonthStartIso(),
        period_to: dateTo || isoDate(),
        hours_paid: Number(payoutTarget.hours_worked || 0),
        base_amount: Number(payoutTarget.base_pay || 0),
        bonus_amount: Number(payoutTarget.bonus_pay || 0),
        amount_paid: Number(amtNum.toFixed(2)),
        payment_method: payoutMethod,
        note: payoutNote.trim() || null,
        create_expense: payoutCreateExpense,
      });
      toast.success(
        `Виплату ${formatMoney(amtNum)} для «${payoutTarget.full_name}» проведено`
      );
      setPayoutModalOpen(false);
      await loadPayroll();
    } catch (err) {
      toast.error(err.message || "Не вдалося провести виплату");
    } finally {
      setPayoutSaving(false);
    }
  };

  // Зміна погодинної ставки
  const openRateModal = (staffRow) => {
    setRateTarget(staffRow);
    setNewRate(String(Number(staffRow.hourly_rate).toFixed(2)));
    setRateModalOpen(true);
  };

  const handleSaveRate = async (e) => {
    e.preventDefault();
    if (!rateTarget) return;
    const rateNum = Number(newRate);
    if (!rateNum || rateNum <= 0) {
      toast.error("Вкажіть коректну погодинну ставку (> 0 ₴)");
      return;
    }
    setRateSaving(true);
    try {
      await api.patch(`/staff/${rateTarget.staff_id}`, {
        hourly_rate: Number(rateNum.toFixed(2)),
      });
      toast.success(
        `Погодинну ставку для «${rateTarget.full_name}» оновлено: ${formatMoney(rateNum)}/год`
      );
      setRateModalOpen(false);
      await loadPayroll();
    } catch (err) {
      toast.error(err.message || "Не вдалося оновити ставку");
    } finally {
      setRateSaving(false);
    }
  };

  const items = report?.items || [];
  const summary = report?.summary || {
    staff_count: 0,
    total_hours: 0,
    total_base_pay: 0,
    total_bonus_pay: 0,
    total_accrued: 0,
    total_paid: 0,
    total_balance_due: 0,
  };
  const recentPayouts = report?.recent_payouts || [];

  // Усі записи табеля у хронологічному порядку для вкладки 2
  const allWorkLogs = items
    .flatMap((r) => r.work_logs || [])
    .sort((a, b) => new Date(b.work_date) - new Date(a.work_date) || b.log_id - a.log_id);

  const maxStaffAccrued = Math.max(
    1,
    ...items.map((r) => Number(r.total_accrued || 0))
  );

  const selectedLogStaff = items.find(
    (r) => String(r.staff_id) === String(logStaffId)
  );
  const previewLogPay = selectedLogStaff
    ? Number(logHours || 0) * Number(selectedLogStaff.hourly_rate || 0) +
      Number(logBonus || 0)
    : 0;

  return (
    <section className="page-section">
      <div className="page-header no-print">
        <div className="hall-title-row">
          <h1>Бухгалтерія: Зарплата і табель</h1>
          <span className="subtle-meta tabular-nums">
            {formatDate(dateFrom)} — {formatDate(dateTo)}
          </span>
        </div>

        <div className="header-actions">
          <Link to="/cash" className="btn btn-secondary">
            <Landmark size={15} aria-hidden="true" />
            <span>Каса і Z-звіти</span>
          </Link>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportCsv}
            disabled={items.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            <span>Експорт відомості CSV</span>
          </button>

          {canManage && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openAddHoursModal(null)}
            >
              <Plus size={17} aria-hidden="true" />
              <span>Внести години в табель</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 KPI-картки бухгалтерії заробітної плати */}
      <div className="kpi-grid no-print">
        <div className="panel kpi-card">
          <span className="kpi-label">Фонд оплати праці (нараховано)</span>
          <span className="kpi-value tabular-nums accent-text">
            {formatMoney(summary.total_accrued)}
          </span>
          <span className="kpi-subtext tabular-nums">
            За години: {formatMoney(summary.total_base_pay)} · Премії:{" "}
            {formatMoney(summary.total_bonus_pay)}
          </span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Відпрацьовано годин</span>
          <span className="kpi-value tabular-nums">
            {Number(summary.total_hours).toFixed(1).replace(".", ",")} год
          </span>
          <span className="kpi-subtext tabular-nums">
            Співробітників у відомості: {summary.staff_count}
          </span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Виплачено за період</span>
          <span className="kpi-value tabular-nums kpi-value-positive">
            {formatMoney(summary.total_paid)}
          </span>
          <span className="kpi-subtext">
            Автоматично враховано у статті «Витрати → Зарплата»
          </span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Залишок до виплати</span>
          <span
            className={`kpi-value tabular-nums ${
              Number(summary.total_balance_due) > 0 ? "kpi-value-warning" : ""
            }`}
          >
            {formatMoney(summary.total_balance_due)}
          </span>
          <span className="kpi-subtext tabular-nums">
            Очікують розрахунку:{" "}
            {items.filter((i) => Number(i.balance_due) > 0).length} осіб
          </span>
        </div>
      </div>

      {/* Візуальний графік нарахувань та годин по співробітниках */}
      {!loading && !error && items.length > 0 && Number(summary.total_accrued) > 0 && (
        <div className="panel payroll-chart-panel no-print">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="section-title" style={{ marginBottom: 2 }}>
                Розподіл нарахованої зарплати та відпрацьованих годин
              </h2>
              <p className="subtle-meta">
                Порівняння нарахувань за погодинною ставкою, премій та фактичних виплат по кожному співробітнику
              </p>
            </div>
            <div className="chart-legend">
              <span className="chart-legend-item">
                <span className="chart-legend-swatch revenue" /> Виплачено
              </span>
              <span className="chart-legend-item">
                <span className="chart-legend-swatch expense" /> Залишок до виплати
              </span>
            </div>
          </div>

          <div className="payroll-bars-grid">
            {items
              .filter((r) => Number(r.total_accrued) > 0)
              .sort((a, b) => Number(b.total_accrued) - Number(a.total_accrued))
              .slice(0, 8)
              .map((r) => {
                const accrued = Number(r.total_accrued || 0);
                const paid = Math.min(accrued, Number(r.total_paid || 0));
                const widthPct = Math.max(6, Math.round((accrued / maxStaffAccrued) * 100));
                const paidSharePct = accrued > 0 ? Math.round((paid / accrued) * 100) : 0;

                return (
                  <div key={r.staff_id} className="payroll-bar-row">
                    <div className="payroll-bar-meta">
                      <div>
                        <span className="font-medium">{r.full_name}</span>
                        <span className="subtle-meta"> · {r.position}</span>
                      </div>
                      <div className="tabular-nums" style={{ fontSize: 13 }}>
                        <span className="subtle-meta">
                          {Number(r.hours_worked).toFixed(1).replace(".", ",")} год ×{" "}
                          {formatMoney(r.hourly_rate)} ={" "}
                        </span>
                        <strong>{formatMoney(r.total_accrued)}</strong>
                      </div>
                    </div>
                    <div className="payroll-bar-track">
                      <div
                        className="payroll-bar-total"
                        style={{ width: `${widthPct}%` }}
                      >
                        <div
                          className="payroll-bar-paid"
                          style={{ width: `${paidSharePct}%` }}
                          title={`Виплачено: ${formatMoney(r.total_paid)}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Панель фільтрів і вкладок */}
      <div className="filters-bar no-print">
        <div className="tabs-bar" role="tablist" aria-label="Розділи бухгалтерії">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "statement"}
            className={`tab-btn ${activeTab === "statement" ? "active" : ""}`}
            onClick={() => setActiveTab("statement")}
          >
            <Users size={15} aria-hidden="true" />
            <span>Зарплатна відомість ({items.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "timesheet"}
            className={`tab-btn ${activeTab === "timesheet" ? "active" : ""}`}
            onClick={() => setActiveTab("timesheet")}
          >
            <Clock size={15} aria-hidden="true" />
            <span>Табель робочого часу ({allWorkLogs.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "payouts"}
            className={`tab-btn ${activeTab === "payouts" ? "active" : ""}`}
            onClick={() => setActiveTab("payouts")}
          >
            <Wallet size={15} aria-hidden="true" />
            <span>Журнал виплат ({recentPayouts.length})</span>
          </button>
        </div>

        <div className="chip-group" role="group" aria-label="Період розрахунку">
          {[
            { id: "month", label: "Цей місяць" },
            { id: "prev_month", label: "Минулий місяць" },
            { id: "7d", label: "7 днів" },
            { id: "year", label: "Рік" },
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

        <select
          aria-label="Фільтр за посадою"
          className="select-compact"
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
        >
          <option value="">Усі посади</option>
          {STAFF_POSITIONS.map((pos) => (
            <option key={pos} value={pos}>
              {pos}
            </option>
          ))}
        </select>
      </div>

      {/* Вміст вкладок */}
      <div className="panel table-wrap no-print">
        {loading ? (
          <SkeletonTable columns={9} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadPayroll} />
        ) : activeTab === "statement" ? (
          items.length === 0 ? (
            <EmptyState text="Співробітників за обраними критеріями не знайдено." />
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th>Співробітник</th>
                    <th>Посада / Клуб</th>
                    <th className="num">Ставка / год</th>
                    <th className="num">Змін</th>
                    <th className="num">Годин</th>
                    <th className="num">За години</th>
                    <th className="num">Премії</th>
                    <th className="num">Нараховано</th>
                    <th className="num">Виплачено</th>
                    <th className="num">До виплати</th>
                    <th>Статус</th>
                    <th aria-label="Дії" className="actions-col" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const isExpanded = Boolean(expandedStaff[row.staff_id]);
                    return (
                      <Fragment key={row.staff_id}>
                        <tr
                          className="clickable-row"
                          onClick={() => toggleExpand(row.staff_id)}
                        >
                          <td>
                            {isExpanded ? (
                              <ChevronUp size={15} />
                            ) : (
                              <ChevronDown size={15} />
                            )}
                          </td>
                          <td className="font-medium">{row.full_name}</td>
                          <td>
                            <div>{row.position}</div>
                            <div className="subtle-meta">{row.club_name}</div>
                          </td>
                          <td
                            className="num tabular-nums"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {canManage ? (
                              <button
                                type="button"
                                className="rate-edit-trigger tabular-nums"
                                title="Натисніть, щоб змінити погодинну ставку"
                                onClick={() => openRateModal(row)}
                              >
                                <span>{formatMoney(row.hourly_rate)}</span>
                                <Edit2 size={12} />
                              </button>
                            ) : (
                              formatMoney(row.hourly_rate)
                            )}
                          </td>
                          <td className="num tabular-nums">{row.shifts_count}</td>
                          <td className="num tabular-nums font-medium">
                            {Number(row.hours_worked).toFixed(1).replace(".", ",")} год
                          </td>
                          <td className="num tabular-nums">
                            {formatMoney(row.base_pay)}
                          </td>
                          <td className="num tabular-nums">
                            {Number(row.bonus_pay) > 0 ? (
                              <span className="kpi-value-positive">
                                +{formatMoney(row.bonus_pay)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="num tabular-nums font-medium">
                            {formatMoney(row.total_accrued)}
                          </td>
                          <td className="num tabular-nums kpi-value-positive">
                            {formatMoney(row.total_paid)}
                          </td>
                          <td
                            className={`num tabular-nums font-medium ${
                              Number(row.balance_due) > 0 ? "kpi-value-warning" : ""
                            }`}
                          >
                            {formatMoney(row.balance_due)}
                          </td>
                          <td>
                            <Badge variant={statusBadgeVariant(row.status)}>
                              {row.status === "виплачено"
                                ? "✓ Виплачено"
                                : row.status}
                            </Badge>
                          </td>
                          <td className="actions" onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {canManage && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    title="Додати відпрацьовані години"
                                    onClick={() => openAddHoursModal(row)}
                                  >
                                    <Plus size={14} />
                                    <span>Години</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    title="Провести виплату зарплати"
                                    onClick={() => openPayoutModal(row)}
                                  >
                                    <Banknote size={14} />
                                    <span>Виплатити</span>
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="btn-icon"
                                title="Розрахунковий лист (друк)"
                                onClick={() => setPayslipTarget(row)}
                              >
                                <Printer size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="sub-row">
                            <td colSpan={13} style={{ padding: "14px 20px" }}>
                              <div className="staff-payroll-details">
                                <div>
                                  <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                                    Табель відпрацьованих змін ({row.work_logs.length})
                                  </h4>
                                  {row.work_logs.length === 0 ? (
                                    <p className="subtle-meta">
                                      За цей період записів у табелі ще немає.
                                    </p>
                                  ) : (
                                    <div className="mini-log-list">
                                      {row.work_logs.map((lg) => (
                                        <div key={lg.log_id} className="mini-log-item tabular-nums">
                                          <div>
                                            <strong>{formatDate(lg.work_date)}</strong> ·{" "}
                                            <span>
                                              {Number(lg.hours_worked)
                                                .toFixed(1)
                                                .replace(".", ",")}{" "}
                                              год × {formatMoney(lg.hourly_rate_snapshot)}
                                            </span>
                                            {Number(lg.bonus_amount) > 0 && (
                                              <span className="kpi-value-positive">
                                                {" "}
                                                + премія {formatMoney(lg.bonus_amount)}
                                              </span>
                                            )}
                                            {lg.shift_id && (
                                              <>
                                                {" "}
                                                ·{" "}
                                                <Link
                                                  to={`/cash/z/${lg.shift_id}`}
                                                  className="table-link"
                                                >
                                                  {lg.shift_label}
                                                </Link>
                                              </>
                                            )}
                                            <span className="subtle-meta">
                                              {" "}
                                              — {lg.comment}
                                            </span>
                                          </div>
                                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <strong>{formatMoney(lg.total_pay)}</strong>
                                            {canManage && !lg.shift_id && (
                                              <button
                                                type="button"
                                                className="link-danger"
                                                title="Видалити запис"
                                                onClick={() => handleDeleteWorkLog(lg.log_id)}
                                              >
                                                <Trash2 size={13} />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                                    Виплати за період ({row.payouts.length})
                                  </h4>
                                  {row.payouts.length === 0 ? (
                                    <p className="subtle-meta">
                                      Виплат за обраний період ще не проводилося.
                                    </p>
                                  ) : (
                                    <div className="mini-log-list">
                                      {row.payouts.map((po) => (
                                        <div key={po.payout_id} className="mini-log-item tabular-nums">
                                          <div>
                                            <strong>{formatDateTime(po.paid_at)}</strong> ·{" "}
                                            <Badge variant="info">{po.payment_method}</Badge>{" "}
                                            <span className="subtle-meta">
                                              {po.note || "Виплата ЗП"}
                                            </span>
                                          </div>
                                          <strong className="kpi-value-positive">
                                            {formatMoney(po.amount_paid)}
                                          </strong>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              <div className="table-summary-bar tabular-nums">
                <span>
                  Співробітників: <strong>{summary.staff_count}</strong>
                </span>
                <span>
                  Відпрацьовано:{" "}
                  <strong>
                    {Number(summary.total_hours).toFixed(1).replace(".", ",")} год
                  </strong>
                </span>
                <span>
                  За години: <strong>{formatMoney(summary.total_base_pay)}</strong>
                </span>
                <span>
                  Премії: <strong>{formatMoney(summary.total_bonus_pay)}</strong>
                </span>
                <span>
                  Нараховано разом:{" "}
                  <strong className="accent-text">
                    {formatMoney(summary.total_accrued)}
                  </strong>
                </span>
                <span>
                  Виплачено:{" "}
                  <strong className="kpi-value-positive">
                    {formatMoney(summary.total_paid)}
                  </strong>
                </span>
                <span>
                  Залишок до виплати:{" "}
                  <strong className="kpi-value-warning">
                    {formatMoney(summary.total_balance_due)}
                  </strong>
                </span>
              </div>
            </>
          )
        ) : activeTab === "timesheet" ? (
          /* Вкладка 2 — Табель робочого часу */
          allWorkLogs.length === 0 ? (
            <EmptyState text="За обраний період записів у табелі робочого часу немає." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Дата зміни</th>
                  <th>Співробітник</th>
                  <th>Посада</th>
                  <th>Клуб</th>
                  <th>Касова зміна</th>
                  <th className="num">Годин</th>
                  <th className="num">Ставка</th>
                  <th className="num">За години</th>
                  <th className="num">Премія</th>
                  <th className="num">Разом</th>
                  <th>Коментар</th>
                  {canManage && <th aria-label="Дії" className="actions-col" />}
                </tr>
              </thead>
              <tbody>
                {allWorkLogs.map((lg) => (
                  <tr key={lg.log_id}>
                    <td className="tabular-nums font-medium">
                      {formatDate(lg.work_date)}
                    </td>
                    <td className="font-medium">{lg.staff_name}</td>
                    <td>{lg.position}</td>
                    <td>{lg.club_name}</td>
                    <td className="tabular-nums">
                      {lg.shift_id ? (
                        <Link
                          to={`/cash/z/${lg.shift_id}`}
                          className="table-link font-medium"
                        >
                          {lg.shift_label}
                        </Link>
                      ) : (
                        <span className="subtle-meta">Табель</span>
                      )}
                    </td>
                    <td className="num tabular-nums font-medium">
                      {Number(lg.hours_worked).toFixed(1).replace(".", ",")} год
                    </td>
                    <td className="num tabular-nums">
                      {formatMoney(lg.hourly_rate_snapshot)}
                    </td>
                    <td className="num tabular-nums">{formatMoney(lg.base_pay)}</td>
                    <td className="num tabular-nums">
                      {Number(lg.bonus_amount) > 0
                        ? `+${formatMoney(lg.bonus_amount)}`
                        : "—"}
                    </td>
                    <td className="num tabular-nums font-medium">
                      {formatMoney(lg.total_pay)}
                    </td>
                    <td>{lg.comment || "—"}</td>
                    {canManage && (
                      <td className="actions">
                        {!lg.shift_id && (
                          <button
                            type="button"
                            className="link-danger"
                            onClick={() => handleDeleteWorkLog(lg.log_id)}
                          >
                            <Trash2 size={14} />
                            <span>Видалити</span>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : /* Вкладка 3 — Журнал виплат */
        recentPayouts.length === 0 ? (
          <EmptyState text="Виплат заробітної плати за обраний період не знайдено." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Дата й час виплати</th>
                <th>Співробітник</th>
                <th>Посада / Клуб</th>
                <th>Період</th>
                <th className="num">Оплачено годин</th>
                <th>Спосіб</th>
                <th className="num">Сума виплати</th>
                <th>Провів</th>
                <th>Примітка</th>
              </tr>
            </thead>
            <tbody>
              {recentPayouts.map((po) => (
                <tr key={po.payout_id}>
                  <td className="tabular-nums font-medium">№ {po.payout_id}</td>
                  <td className="tabular-nums">{formatDateTime(po.paid_at)}</td>
                  <td className="font-medium">{po.staff_name}</td>
                  <td>
                    <div>{po.position}</div>
                    <div className="subtle-meta">{po.club_name}</div>
                  </td>
                  <td className="tabular-nums">
                    {formatDate(po.period_from)} — {formatDate(po.period_to)}
                  </td>
                  <td className="num tabular-nums">
                    {Number(po.hours_paid).toFixed(1).replace(".", ",")} год
                  </td>
                  <td>
                    <Badge variant="info">{po.payment_method}</Badge>
                  </td>
                  <td className="num tabular-nums font-medium kpi-value-positive">
                    {formatMoney(po.amount_paid)}
                  </td>
                  <td>{po.paid_by_name || "Бухгалтерія"}</td>
                  <td>{po.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Модальне вікно «Внести години в табель» */}
      <Modal
        open={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        title="Внести відпрацьовані години в табель"
        subtitle="Нарахування за погодинною ставкою співробітника"
        size="sm"
      >
        <form onSubmit={handleCreateWorkLog} className="stack-form">
          <div className="field">
            <label className="field-label" htmlFor="log-staff-select">
              Співробітник <span className="required-mark">*</span>
            </label>
            <select
              id="log-staff-select"
              required
              value={logStaffId}
              onChange={(e) => setLogStaffId(e.target.value)}
            >
              {items.map((r) => (
                <option key={r.staff_id} value={r.staff_id}>
                  {r.full_name} — {r.position} ({formatMoney(r.hourly_rate)}/год)
                </option>
              ))}
            </select>
          </div>

          <div className="two-col-fields">
            <div className="field">
              <label className="field-label" htmlFor="log-date-input">
                Дата зміни <span className="required-mark">*</span>
              </label>
              <input
                id="log-date-input"
                type="date"
                required
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="log-hours-input">
                Годин (0.5–24) <span className="required-mark">*</span>
              </label>
              <input
                id="log-hours-input"
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                required
                className="tabular-nums"
                value={logHours}
                onChange={(e) => setLogHours(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="log-bonus-input">
              Премія / доплата за зміну (₴, необов'язково)
            </label>
            <input
              id="log-bonus-input"
              type="number"
              step="10"
              min="0"
              className="tabular-nums"
              value={logBonus}
              onChange={(e) => setLogBonus(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="log-comment-input">
              Опис робіт / зміни
            </label>
            <input
              id="log-comment-input"
              type="text"
              maxLength={200}
              placeholder="Наприклад: Денна зміна в залі (12 год)"
              value={logComment}
              onChange={(e) => setLogComment(e.target.value)}
            />
          </div>

          {selectedLogStaff && (
            <div className="pay-total-banner">
              <span className="pay-total-label">Буде нараховано за зміну:</span>
              <span className="pay-total-value tabular-nums">
                {formatMoney(previewLogPay)}
              </span>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setLogModalOpen(false)}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={logSaving}>
              {logSaving ? "Збереження…" : "Додати в табель"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Модальне вікно «Виплатити зарплату» */}
      <Modal
        open={payoutModalOpen}
        onClose={() => setPayoutModalOpen(false)}
        title="Виплата заробітної плати"
        subtitle={
          payoutTarget
            ? `${payoutTarget.full_name} · ${payoutTarget.position}`
            : ""
        }
        size="sm"
      >
        {payoutTarget && (
          <form onSubmit={handleCreatePayout} className="stack-form">
            <div className="z-preview-box">
              <div className="z-preview-row">
                <span>Відпрацьовано годин за період:</span>
                <strong className="tabular-nums">
                  {Number(payoutTarget.hours_worked).toFixed(1).replace(".", ",")} год
                </strong>
              </div>
              <div className="z-preview-row">
                <span>Погодинна ставка:</span>
                <span className="tabular-nums">
                  {formatMoney(payoutTarget.hourly_rate)} / год
                </span>
              </div>
              <div className="z-preview-row">
                <span>Нараховано (ставка + премії):</span>
                <strong className="tabular-nums">
                  {formatMoney(payoutTarget.total_accrued)}
                </strong>
              </div>
              <div className="z-preview-row">
                <span>Уже виплачено:</span>
                <span className="tabular-nums kpi-value-positive">
                  {formatMoney(payoutTarget.total_paid)}
                </span>
              </div>
              <div className="z-preview-row highlight">
                <span>Залишок до виплати:</span>
                <strong className="tabular-nums accent-text">
                  {formatMoney(payoutTarget.balance_due)}
                </strong>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="payout-amount-input">
                Сума до виплати (₴) <span className="required-mark">*</span>
              </label>
              <input
                id="payout-amount-input"
                type="number"
                step="0.01"
                min="1"
                required
                className="tabular-nums"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
              />
            </div>

            <div className="field">
              <span className="field-label">Спосіб виплати</span>
              <div className="payment-methods-grid">
                {[
                  { key: "картка", title: "На картку", sub: "Зарплатний проєкт" },
                  { key: "переказ", title: "Переказ IBAN", sub: "Безготівково" },
                  { key: "готівка", title: "Готівка", sub: "З каси / сейфа" },
                ].map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`payment-method-btn ${
                      payoutMethod === m.key ? "active" : ""
                    }`}
                    onClick={() => setPayoutMethod(m.key)}
                  >
                    <span className="pm-title">{m.title}</span>
                    <span className="pm-sub">{m.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="payout-note-input">
                Примітка до виплати
              </label>
              <input
                id="payout-note-input"
                type="text"
                maxLength={200}
                value={payoutNote}
                onChange={(e) => setPayoutNote(e.target.value)}
              />
            </div>

            <label className="switch-row">
              <input
                type="checkbox"
                checked={payoutCreateExpense}
                onChange={(e) => setPayoutCreateExpense(e.target.checked)}
              />
              <span>
                Автоматично створити запис у розділі «Витрати» (категорія «зарплата») для звіту P&L
              </span>
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPayoutModalOpen(false)}
              >
                Скасувати
              </button>
              <button type="submit" className="btn btn-primary" disabled={payoutSaving}>
                <CheckCircle2 size={16} />
                <span>
                  {payoutSaving ? "Проведення…" : "Підтвердити виплату ЗП"}
                </span>
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Модальне вікно редагування погодинної ставки */}
      <Modal
        open={rateModalOpen}
        onClose={() => setRateModalOpen(false)}
        title="Погодинна ставка співробітника"
        subtitle={
          rateTarget ? `${rateTarget.full_name} · ${rateTarget.position}` : ""
        }
        size="sm"
      >
        <form onSubmit={handleSaveRate} className="stack-form">
          <div className="field">
            <label className="field-label" htmlFor="staff-rate-input">
              Ставка за 1 відпрацьовану годину (₴) <span className="required-mark">*</span>
            </label>
            <input
              id="staff-rate-input"
              type="number"
              step="5"
              min="10"
              required
              className="tabular-nums"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
            />
            <span className="subtle-meta">
              Нова ставка застосовуватиметься до всіх наступних змін співробітника.
            </span>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRateModalOpen(false)}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={rateSaving}>
              {rateSaving ? "Збереження…" : "Зберегти ставку"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Модальне вікно розрахункового листа співробітника (Payslip) */}
      <Modal
        open={Boolean(payslipTarget)}
        onClose={() => setPayslipTarget(null)}
        title="Розрахунковий лист співробітника"
        subtitle={
          payslipTarget
            ? `Період: ${formatDate(dateFrom)} — ${formatDate(dateTo)}`
            : ""
        }
        size="sm"
      >
        {payslipTarget && (
          <div className="stack-form">
            <div className="receipt-sheet">
              <div className="receipt-header">
                <div className="receipt-club-name">{payslipTarget.club_name}</div>
                <div className="receipt-club-meta">
                  РОЗРАХУНКОВИЙ ЛИСТ ЗАРОБІТНОЇ ПЛАТИ
                </div>
                <div className="receipt-club-meta tabular-nums">
                  Період: {formatDate(dateFrom)} — {formatDate(dateTo)}
                </div>
              </div>

              <div className="receipt-divider" />

              <div className="receipt-rows tabular-nums">
                <div className="receipt-row">
                  <span>Співробітник</span>
                  <strong>{payslipTarget.full_name}</strong>
                </div>
                <div className="receipt-row">
                  <span>Посада</span>
                  <span>{payslipTarget.position}</span>
                </div>
                <div className="receipt-row">
                  <span>Погодинна ставка</span>
                  <span>{formatMoney(payslipTarget.hourly_rate)} / год</span>
                </div>
                <div className="receipt-row">
                  <span>Відпрацьовано змін</span>
                  <span>{payslipTarget.shifts_count}</span>
                </div>
                <div className="receipt-row">
                  <span>Відпрацьовано годин</span>
                  <strong>
                    {Number(payslipTarget.hours_worked).toFixed(1).replace(".", ",")} год
                  </strong>
                </div>
              </div>

              <div className="receipt-divider" />

              <div className="receipt-rows tabular-nums">
                <div className="receipt-row">
                  <span>Нараховано за години</span>
                  <span>{formatMoney(payslipTarget.base_pay)}</span>
                </div>
                <div className="receipt-row">
                  <span>Премії та надбавки</span>
                  <span>{formatMoney(payslipTarget.bonus_pay)}</span>
                </div>
                <div className="receipt-row">
                  <strong>РАЗОМ НАРАХОВАНО</strong>
                  <strong>{formatMoney(payslipTarget.total_accrued)}</strong>
                </div>
                <div className="receipt-row">
                  <span>Виплачено за період</span>
                  <span>{formatMoney(payslipTarget.total_paid)}</span>
                </div>
              </div>

              <div className="receipt-divider" />

              <div className="receipt-total-row tabular-nums">
                <span>ДО ВИПЛАТИ</span>
                <strong>{formatMoney(payslipTarget.balance_due)}</strong>
              </div>
            </div>

            <div className="modal-actions no-print">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPayslipTarget(null)}
              >
                Закрити
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.print()}
              >
                <Printer size={15} />
                <span>Друкувати розрахунковий лист</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
