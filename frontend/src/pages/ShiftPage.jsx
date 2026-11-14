import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  CreditCard,
  FileText,
  KeyRound,
  Lock,
  PlusCircle,
  Printer,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { api } from "../api.js";
import { Badge, StatusBadge } from "../components/Badge.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import Modal from "../components/Modal.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatTime,
} from "../format.js";

const DENOMINATIONS = [
  { label: "1000 ₴", value: 1000 },
  { label: "500 ₴", value: 500 },
  { label: "200 ₴", value: 200 },
  { label: "100 ₴", value: 100 },
  { label: "50 ₴", value: 50 },
  { label: "20 ₴", value: 20 },
  { label: "10 ₴", value: 10 },
  { label: "5 ₴", value: 5 },
  { label: "2 ₴", value: 2 },
  { label: "1 ₴", value: 1 },
  { label: "0,50 ₴", value: 0.5 },
];

const EXPENSE_CATEGORIES = [
  "господарські витрати",
  "закупівля",
  "виплата",
  "інше",
];

function opBadgeVariant(type) {
  if (type === "внесення") return "success";
  if (type === "вилучення") return "warning";
  return "info";
}

export default function ShiftPage() {
  const { user, can, clubs, selectedClubId, setSelectedClubId } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const canManage = can("shift", "full");
  const isDirector = user?.role === "director";

  const activeClubId = useMemo(() => {
    if (user?.club_id != null) return user.club_id;
    if (selectedClubId != null) return selectedClubId;
    return clubs[0]?.club_id ?? 1;
  }, [user, selectedClubId, clubs]);

  const [stateData, setStateData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("payments");

  // Стан форми відкриття зміни
  const [openingCash, setOpeningCash] = useState("0.00");
  const [openComment, setOpenComment] = useState("");
  const [openingSubmitting, setOpeningSubmitting] = useState(false);

  // Модальне вікно службової операції
  const [opModalOpen, setOpModalOpen] = useState(false);
  const [opType, setOpType] = useState("внесення");
  const [opAmount, setOpAmount] = useState("");
  const [opCategory, setOpCategory] = useState("господарські витрати");
  const [opComment, setOpComment] = useState("");
  const [opSubmitting, setOpSubmitting] = useState(false);

  // Майстер закриття зміни (3 кроки)
  const [closeWizardOpen, setCloseWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [actualCash, setActualCash] = useState("");
  const [showDenomCalc, setShowDenomCalc] = useState(false);
  const [denomCounts, setDenomCounts] = useState({});
  const [terminalCardTotal, setTerminalCardTotal] = useState("");
  const [collectionOnClose, setCollectionOnClose] = useState("0");
  const [closeComment, setCloseComment] = useState("");
  const [closeSubmitting, setCloseSubmitting] = useState(false);

  // Примусове закриття зміни (Директор)
  const [forceModalOpen, setForceModalOpen] = useState(false);
  const [forceComment, setForceComment] = useState("");
  const [forceSubmitting, setForceSubmitting] = useState(false);

  const loadShiftState = useCallback(async () => {
    if (!activeClubId) return;
    setLoading(true);
    setError("");
    try {
      const current = await api.get(`/shifts/current?club_id=${activeClubId}`);
      setStateData(current);
      if (!current.current_shift) {
        setOpeningCash(String(Number(current.suggested_opening_cash ?? 0).toFixed(2)));
        setOpenComment("");
      }
    } catch (err) {
      setError(err.message || "Не вдалося завантажити стан зміни");
    } finally {
      setLoading(false);
    }
  }, [activeClubId]);

  useEffect(() => {
    loadShiftState();
  }, [loadShiftState]);

  const currentShift = stateData?.current_shift || null;
  const lastShift = stateData?.last_closed_shift || null;
  const suggestedOpening = Number(stateData?.suggested_opening_cash ?? 0);
  const parsedOpening = Number(openingCash || 0);
  const openingDiff = useMemo(() => {
    if (Number.isNaN(parsedOpening)) return 0;
    return Number((parsedOpening - suggestedOpening).toFixed(2));
  }, [parsedOpening, suggestedOpening]);

  const handleOpenShift = async (e) => {
    e.preventDefault();
    if (Number.isNaN(parsedOpening) || parsedOpening < 0) {
      toast.error("Вкажіть коректну суму готівки на початок зміни");
      return;
    }
    if (lastShift && openingDiff !== 0 && openComment.trim().length < 3) {
      toast.error("При розбіжності з попередньою зміною коментар є обов'язковим (мін. 3 символи)");
      return;
    }
    setOpeningSubmitting(true);
    try {
      await api.post("/shifts", {
        club_id: activeClubId,
        opening_cash: Number(parsedOpening.toFixed(2)),
        comment: openComment.trim() || null,
      });
      toast.success("Зміну успішно відкрито");
      window.dispatchEvent(new CustomEvent("shift-updated"));
      await loadShiftState();
    } catch (err) {
      toast.error(err.message || "Помилка відкриття зміни");
    } finally {
      setOpeningSubmitting(false);
    }
  };

  // Службова операція
  const openOperationModal = () => {
    setOpType("внесення");
    setOpAmount("");
    setOpCategory("господарські витрати");
    setOpComment("");
    setOpModalOpen(true);
  };

  const expectedCash = Number(currentShift?.expected_cash ?? 0);

  const handleCreateOperation = async (e) => {
    e.preventDefault();
    const amountNum = Number(opAmount);
    if (!amountNum || amountNum <= 0) {
      toast.error("Сума операції має бути більшою за 0 ₴");
      return;
    }
    if ((opType === "вилучення" || opType === "інкасація") && amountNum > expectedCash) {
      toast.error(`У касі недостатньо готівки (доступно ${formatMoney(expectedCash)})`);
      return;
    }
    if (opComment.trim().length < 3) {
      toast.error("Вкажіть коментар (щонайменше 3 символи)");
      return;
    }
    setOpSubmitting(true);
    try {
      await api.post("/cash-operations", {
        club_id: activeClubId,
        type: opType,
        amount: Number(amountNum.toFixed(2)),
        category: opType === "вилучення" ? opCategory : null,
        comment: opComment.trim(),
      });
      toast.success("Службову операцію проведено");
      setOpModalOpen(false);
      await loadShiftState();
    } catch (err) {
      toast.error(err.message || "Не вдалося провести операцію");
    } finally {
      setOpSubmitting(false);
    }
  };

  // Майстер закриття зміни
  const openCloseWizard = () => {
    if (!currentShift) return;
    setWizardStep(1);
    setActualCash(String(Number(currentShift.expected_cash ?? 0).toFixed(2)));
    setShowDenomCalc(false);
    setDenomCounts({});
    setTerminalCardTotal("");
    setCollectionOnClose("0");
    setCloseComment("");
    setCloseWizardOpen(true);
  };

  const handleDenomChange = (denomValue, countStr) => {
    const count = Math.max(0, parseInt(countStr || "0", 10) || 0);
    const next = { ...denomCounts, [denomValue]: count };
    setDenomCounts(next);
    const total = DENOMINATIONS.reduce(
      (acc, d) => acc + d.value * (next[d.value] || 0),
      0
    );
    setActualCash(total.toFixed(2));
  };

  const actualCashNum = Number(actualCash || 0);
  const cashDiff = Number((actualCashNum - expectedCash).toFixed(2));
  const collectionNum = Number(collectionOnClose || 0);
  const nextShiftCashLeft = Number(Math.max(0, actualCashNum - collectionNum).toFixed(2));

  const cardSalesNum = Number(currentShift?.card_sales ?? 0);
  const hasTerminalInput = terminalCardTotal.trim() !== "";
  const terminalCardNum = hasTerminalInput ? Number(terminalCardTotal) : null;
  const cardDiff =
    terminalCardNum != null && !Number.isNaN(terminalCardNum)
      ? Number((terminalCardNum - cardSalesNum).toFixed(2))
      : null;

  const handleWizardNextFromStep2 = () => {
    if (Number.isNaN(actualCashNum) || actualCashNum < 0) {
      toast.error("Вкажіть фактичну суму готівки в касі");
      return;
    }
    if (Number.isNaN(collectionNum) || collectionNum < 0 || collectionNum > actualCashNum) {
      toast.error("Інкасація при закритті має бути в межах від 0 до фактичної суми в касі");
      return;
    }
    if (cashDiff !== 0 && closeComment.trim().length < 3) {
      toast.error("Пояснення розбіжності каси є обов'язковим (щонайменше 3 символи)");
      return;
    }
    setWizardStep(3);
  };

  const handleConfirmCloseShift = async () => {
    if (!currentShift) return;
    setCloseSubmitting(true);
    try {
      const closed = await api.post(`/shifts/${currentShift.shift_id}/close`, {
        actual_cash: Number(actualCashNum.toFixed(2)),
        collection: Number(collectionNum.toFixed(2)),
        card_terminal_total:
          terminalCardNum != null && !Number.isNaN(terminalCardNum)
            ? Number(terminalCardNum.toFixed(2))
            : null,
        comment: closeComment.trim() || null,
      });
      toast.success(`Зміну закрито. Сформовано Z-звіт ${closed.z_label}`);
      setCloseWizardOpen(false);
      window.dispatchEvent(new CustomEvent("shift-updated"));
      navigate(`/cash/z/${closed.shift_id}`);
    } catch (err) {
      toast.error(err.message || "Помилка закриття зміни");
    } finally {
      setCloseSubmitting(false);
    }
  };

  // Примусове закриття зміни
  const handleForceClose = async (e) => {
    e.preventDefault();
    if (!currentShift) return;
    if (forceComment.trim().length < 3) {
      toast.error("Вкажіть причину примусового закриття (щонайменше 3 символи)");
      return;
    }
    setForceSubmitting(true);
    try {
      const closed = await api.post(`/shifts/${currentShift.shift_id}/force-close`, {
        comment: forceComment.trim(),
      });
      toast.success("Зміну примусово закрито");
      setForceModalOpen(false);
      window.dispatchEvent(new CustomEvent("shift-updated"));
      navigate(`/cash/z/${closed.shift_id}`);
    } catch (err) {
      toast.error(err.message || "Не вдалося примусово закрити зміну");
    } finally {
      setForceSubmitting(false);
    }
  };

  const payments = currentShift?.payments || [];
  const operations = currentShift?.operations || [];
  const activeSessions = currentShift?.active_sessions || [];

  const cashCount = payments.filter((p) => p.method === "готівка").length;
  const cardCount = payments.filter((p) => p.method === "картка").length;

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="hall-title-row">
          <h1>Зміна</h1>
          {stateData?.club_name && (
            <span className="subtle-meta">{stateData.club_name}</span>
          )}
        </div>

        <div className="header-actions no-print">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadShiftState}
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>Оновити</span>
          </button>

          {currentShift && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate(`/cash/z/${currentShift.shift_id}`)}
              >
                <Printer size={15} aria-hidden="true" />
                <span>X-звіт (друк)</span>
              </button>

              {canManage && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={openOperationModal}
                  >
                    <PlusCircle size={15} aria-hidden="true" />
                    <span>Службова операція</span>
                  </button>

                  {isDirector && (
                    <button
                      type="button"
                      className="btn btn-danger-outline"
                      onClick={() => {
                        setForceComment("");
                        setForceModalOpen(true);
                      }}
                    >
                      <ShieldAlert size={15} aria-hidden="true" />
                      <span>Закрити примусово</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={openCloseWizard}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>Закрити зміну</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Якщо користувач мережевий, показуємо вкладки за клубами (як у Залі) */}
      {!user?.club_id && clubs.length > 1 && (
        <div className="tabs-bar no-print" role="tablist" aria-label="Вибір клубу">
          {clubs.map((c) => {
            const isCurrent = Number(activeClubId) === Number(c.club_id);
            return (
              <button
                key={c.club_id}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                className={`tab-btn ${isCurrent ? "active" : ""}`}
                onClick={() => setSelectedClubId(c.club_id)}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {loading && !stateData ? (
        <div className="panel">
          <SkeletonTable columns={4} rows={5} />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={loadShiftState} />
        </div>
      ) : !currentShift ? (
        /* Стан А — Зміну не відкрито */
        <div className="shift-closed-layout">
          <div className="panel shift-open-panel">
            <div className="shift-closed-banner">
              <div className="shift-closed-icon-box">
                <Lock size={24} />
              </div>
              <div className="shift-closed-banner-text">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Badge variant="neutral">Зміну не відкрито</Badge>
                  <span className="subtle-meta">{stateData?.club_name}</span>
                </div>
                <h2 style={{ marginTop: 4 }}>Відкриття нової касової зміни</h2>
                {lastShift ? (
                  <p className="subtle-meta" style={{ marginTop: 4 }}>
                    Попередня зміна:{" "}
                    <Link to={`/cash/z/${lastShift.shift_id}`} className="table-link font-medium">
                      {lastShift.z_label}
                    </Link>{" "}
                    (закрита {formatDateTime(lastShift.closed_at)}) · залишок у касі:{" "}
                    <strong className="tabular-nums" style={{ color: "var(--ink)" }}>
                      {formatMoney(lastShift.cash_left)}
                    </strong>
                  </p>
                ) : (
                  <p className="subtle-meta" style={{ marginTop: 4 }}>
                    Попередніх закритих змін у цьому клубі ще немає.
                  </p>
                )}
              </div>
            </div>

            {canManage ? (
              <form onSubmit={handleOpenShift} className="stack-form">
                <div className="two-col-fields">
                  <div className="field">
                    <label className="field-label">Клуб</label>
                    <div className="readonly-pill">
                      {stateData?.club_name || `Клуб № ${activeClubId}`}
                    </div>
                  </div>

                  <div className="field">
                    <label className="field-label" htmlFor="opening-cash-input">
                      Готівка в касі на початок (₴) <span className="required-mark">*</span>
                    </label>
                    <input
                      id="opening-cash-input"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      className="tabular-nums"
                      value={openingCash}
                      onChange={(e) => setOpeningCash(e.target.value)}
                    />
                    <span className="subtle-meta">
                      Очікується з минулої зміни:{" "}
                      <strong className="tabular-nums">{formatMoney(suggestedOpening)}</strong>
                    </span>
                  </div>
                </div>

                {lastShift && openingDiff !== 0 && (
                  <div
                    className={`alert ${openingDiff > 0 ? "alert-warning" : ""}`}
                    role="alert"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AlertTriangle size={18} />
                      <span>
                        Розбіжність із залишком попередньої зміни:{" "}
                        <strong className="tabular-nums">
                          {openingDiff > 0 ? "+" : ""}
                          {formatMoney(openingDiff)}
                        </strong>
                        . Обов'язково вкажіть причину нижче.
                      </span>
                    </div>
                  </div>
                )}

                <div className="field">
                  <label className="field-label" htmlFor="opening-comment-input">
                    Коментар / пояснення розбіжності{" "}
                    {lastShift && openingDiff !== 0 ? (
                      <span className="required-mark">*</span>
                    ) : (
                      <span className="subtle-meta">(необов'язково)</span>
                    )}
                  </label>
                  <textarea
                    id="opening-comment-input"
                    rows={2}
                    required={Boolean(lastShift && openingDiff !== 0)}
                    placeholder={
                      lastShift && openingDiff !== 0
                        ? "Опишіть причину розбіжності готівки на початок зміни…"
                        : "Нотатка до відкриття зміни (необов'язково)"
                    }
                    value={openComment}
                    onChange={(e) => setOpenComment(e.target.value)}
                  />
                </div>

                <div className="drawer-form-actions">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={openingSubmitting}
                  >
                    <KeyRound size={16} aria-hidden="true" />
                    <span>{openingSubmitting ? "Відкриття…" : "Відкрити зміну"}</span>
                  </button>
                </div>
              </form>
            ) : (
              <p className="subtle-meta">
                У цьому клубі зміна наразі закрита. Відкрити зміну може Адміністратор залу або Директор.
              </p>
            )}
          </div>
        </div>
      ) : (
        /* Стан Б — Зміна відкрита */
        <>
          <div className="panel shift-hero-panel">
            <div className="shift-hero-left">
              <div className="shift-hero-badges">
                <Badge variant="success">Зміна відкрита</Badge>
                <Badge variant="info">{currentShift.z_label}</Badge>
                <span className="subtle-meta tabular-nums">
                  Бізнес-дата: {formatDate(currentShift.business_date)}
                </span>
              </div>
              <h2 className="shift-hero-title">
                {currentShift.club_name} · відкрив {currentShift.opened_by_name}
              </h2>
              <p className="subtle-meta tabular-nums">
                Початок: {formatDateTime(currentShift.opened_at)} · триває{" "}
                <strong>{formatDuration(currentShift.duration_minutes)}</strong>
              </p>
            </div>

            <div className="shift-hero-right">
              <div className="shift-hero-stat">
                <span className="subtle-meta">Очікується готівки в шухляді</span>
                <span className="shift-hero-cash tabular-nums">
                  {formatMoney(currentShift.expected_cash)}
                </span>
              </div>
            </div>
          </div>

          {/* 6 KPI карток поточної зміни */}
          <div className="kpi-grid shift-kpi-grid-6">
            <div className="panel kpi-card">
              <span className="kpi-label">Виручка за зміну</span>
              <span className="kpi-value tabular-nums accent-text">
                {formatMoney(currentShift.revenue_total)}
              </span>
              <span className="kpi-subtext tabular-nums">
                Середній чек: {formatMoney(currentShift.avg_check)}
              </span>
            </div>

            <div className="panel kpi-card">
              <span className="kpi-label">Готівка (оплати)</span>
              <span className="kpi-value tabular-nums">
                {formatMoney(currentShift.cash_sales)}
              </span>
              <span className="kpi-subtext tabular-nums">{cashCount} чеків</span>
            </div>

            <div className="panel kpi-card">
              <span className="kpi-label">Картка (термінал)</span>
              <span className="kpi-value tabular-nums">
                {formatMoney(currentShift.card_sales)}
              </span>
              <span className="kpi-subtext tabular-nums">{cardCount} чеків</span>
            </div>

            <div className="panel kpi-card">
              <span className="kpi-label">Бонуси списано</span>
              <span className="kpi-value tabular-nums">
                {formatMoney(currentShift.bonus_sales)}
              </span>
              <span className="kpi-subtext">Не входять у грошову шухляду</span>
            </div>

            <div className="panel kpi-card">
              <span className="kpi-label">Сеансів завершено</span>
              <span className="kpi-value tabular-nums">
                {currentShift.sessions_completed}
              </span>
              <span className="kpi-subtext tabular-nums">
                Скасовано без оплати: {currentShift.sessions_cancelled}
              </span>
            </div>

            <div className="panel kpi-card">
              <span className="kpi-label">Активних сеансів зараз</span>
              <span className="kpi-value tabular-nums">
                {currentShift.active_sessions_now}
              </span>
              <span className="kpi-subtext">
                {currentShift.active_sessions_now > 0 ? (
                  <Link to="/hall" className="table-link font-medium">
                    Перейти в зал →
                  </Link>
                ) : (
                  "Усі місця вільні"
                )}
              </span>
            </div>
          </div>

          {/* Блок «Готівка в касі» (формула грошової шухляди) */}
          <div className="panel cash-drawer-panel">
            <div className="dashboard-panel-header" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Wallet size={18} className="accent-text" />
                <h2 className="section-title" style={{ marginBottom: 0 }}>
                  Готівка в касі (розрахунок грошової шухляди)
                </h2>
              </div>
              <span className="subtle-meta">
                Очікується = Початок + Готівкові оплати + Внесення − Вилучення − Інкасація
              </span>
            </div>

            <div className="cash-formula-grid">
              <div className="cash-formula-box">
                <span className="cash-formula-label">На початок зміни</span>
                <span className="cash-formula-val tabular-nums">
                  {formatMoney(currentShift.opening_cash)}
                </span>
              </div>

              <div className="cash-formula-sign">+</div>

              <div className="cash-formula-box">
                <span className="cash-formula-label">Готівкові оплати</span>
                <span className="cash-formula-val tabular-nums kpi-value-positive">
                  +{formatMoney(currentShift.cash_sales)}
                </span>
              </div>

              <div className="cash-formula-sign">+</div>

              <div className="cash-formula-box">
                <span className="cash-formula-label">Службові внесення</span>
                <span className="cash-formula-val tabular-nums kpi-value-positive">
                  +{formatMoney(currentShift.cash_in)}
                </span>
              </div>

              <div className="cash-formula-sign">−</div>

              <div className="cash-formula-box">
                <span className="cash-formula-label">Службові вилучення</span>
                <span className="cash-formula-val tabular-nums kpi-value-warning">
                  −{formatMoney(currentShift.cash_out)}
                </span>
              </div>

              <div className="cash-formula-sign">−</div>

              <div className="cash-formula-box">
                <span className="cash-formula-label">Інкасація за зміну</span>
                <span className="cash-formula-val tabular-nums text-info">
                  −{formatMoney(currentShift.collection)}
                </span>
              </div>

              <div className="cash-formula-sign">=</div>

              <div className="cash-formula-box expected">
                <span className="cash-formula-label">Очікується в касі</span>
                <span className="cash-formula-expected tabular-nums">
                  {formatMoney(currentShift.expected_cash)}
                </span>
              </div>
            </div>
          </div>

          {/* Вкладки: Оплати за зміну та Службові операції */}
          <div className="filters-bar no-print">
            <div className="tabs-bar" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "payments"}
                className={`tab-btn ${activeTab === "payments" ? "active" : ""}`}
                onClick={() => setActiveTab("payments")}
              >
                <CreditCard size={15} aria-hidden="true" />
                <span>Оплати за зміну ({payments.length})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "operations"}
                className={`tab-btn ${activeTab === "operations" ? "active" : ""}`}
                onClick={() => setActiveTab("operations")}
              >
                <FileText size={15} aria-hidden="true" />
                <span>Службові операції ({operations.length})</span>
              </button>
            </div>
          </div>

          <div className="panel table-wrap">
            {activeTab === "payments" ? (
              payments.length === 0 ? (
                <EmptyState text="У межах поточної зміни оплат ще не проведено." />
              ) : (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>№</th>
                        <th>Дата й час</th>
                        <th>Клієнт</th>
                        <th>Сеанс і місце</th>
                        <th>Тариф</th>
                        <th>Спосіб</th>
                        <th className="num">Сума</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.payment_id}>
                          <td className="tabular-nums font-medium">№ {p.payment_id}</td>
                          <td className="tabular-nums">{formatDateTime(p.payment_date)}</td>
                          <td>
                            <Link
                              to={`/clients/${p.client_id}`}
                              className="table-link font-medium"
                            >
                              {p.client_name}
                            </Link>
                          </td>
                          <td>
                            Сеанс № {p.session_id} · місце №{" "}
                            {String(p.workstation_number).padStart(2, "0")}{" "}
                            <span className="subtle-meta">({p.workstation_type})</span>
                          </td>
                          <td>{p.tariff_name}</td>
                          <td>
                            <StatusBadge status={p.method} />
                          </td>
                          <td className="num tabular-nums font-medium">
                            {formatMoney(p.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="table-summary-bar tabular-nums">
                    <span>
                      Чеків: <strong>{payments.length}</strong>
                    </span>
                    <span>
                      Готівка: <strong>{formatMoney(currentShift.cash_sales)}</strong>
                    </span>
                    <span>
                      Картка: <strong>{formatMoney(currentShift.card_sales)}</strong>
                    </span>
                    <span>
                      Бонуси: <strong>{formatMoney(currentShift.bonus_sales)}</strong>
                    </span>
                    <span>
                      Разом: <strong>{formatMoney(currentShift.revenue_total)}</strong>
                    </span>
                  </div>
                </>
              )
            ) : operations.length === 0 ? (
              <EmptyState text="Службових операцій за поточну зміну ще не проводилося." />
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Час</th>
                      <th>Тип</th>
                      <th>Категорія</th>
                      <th className="num">Сума</th>
                      <th>Хто провів</th>
                      <th>Коментар</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operations.map((op) => (
                      <tr key={op.operation_id}>
                        <td className="tabular-nums font-medium">№ {op.operation_id}</td>
                        <td className="tabular-nums">{formatDateTime(op.created_at)}</td>
                        <td>
                          <Badge variant={opBadgeVariant(op.type)}>{op.type}</Badge>
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
                    Внесення:{" "}
                    <strong className="kpi-value-positive">
                      +{formatMoney(currentShift.cash_in)}
                    </strong>
                  </span>
                  <span>
                    Вилучення:{" "}
                    <strong className="kpi-value-warning">
                      −{formatMoney(currentShift.cash_out)}
                    </strong>
                  </span>
                  <span>
                    Інкасація:{" "}
                    <strong className="text-info">
                      −{formatMoney(currentShift.collection)}
                    </strong>
                  </span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Модальне вікно «Службова операція» */}
      <Modal
        open={opModalOpen}
        onClose={() => setOpModalOpen(false)}
        title="Службова касова операція"
        subtitle={currentShift ? `${currentShift.club_name} · ${currentShift.z_label}` : ""}
        size="sm"
      >
        <form onSubmit={handleCreateOperation} className="stack-form">
          <div className="field">
            <label className="field-label">
              Тип операції <span className="required-mark">*</span>
            </label>
            <div className="payment-methods-grid">
              {[
                { key: "внесення", title: "+ Внесення", sub: "Розмін у касу" },
                { key: "вилучення", title: "− Вилучення", sub: "Витрата з каси" },
                { key: "інкасація", title: "− Інкасація", sub: "Здача в сейф" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`payment-method-btn ${opType === item.key ? "active" : ""}`}
                  onClick={() => setOpType(item.key)}
                >
                  <span className="pm-title">{item.title}</span>
                  <span className="pm-sub">{item.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="op-amount-input">
              Сума (₴) <span className="required-mark">*</span>
            </label>
            <input
              id="op-amount-input"
              type="number"
              step="0.01"
              min="0.01"
              required
              className="tabular-nums"
              placeholder="0.00"
              value={opAmount}
              onChange={(e) => setOpAmount(e.target.value)}
            />
            {(opType === "вилучення" || opType === "інкасація") && (
              <span className="subtle-meta">
                Доступно готівки в касі:{" "}
                <strong className="tabular-nums">{formatMoney(expectedCash)}</strong>
              </span>
            )}
          </div>

          {opType === "вилучення" && (
            <div className="field">
              <label className="field-label" htmlFor="op-cat-select">
                Категорія витрат <span className="required-mark">*</span>
              </label>
              <select
                id="op-cat-select"
                value={opCategory}
                onChange={(e) => setOpCategory(e.target.value)}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="op-comment-input">
              Коментар <span className="required-mark">*</span>
            </label>
            <textarea
              id="op-comment-input"
              rows={2}
              required
              minLength={3}
              placeholder="Наприклад: Розмін на початок зміни / Вода в кулер / Інкасація в сейф"
              value={opComment}
              onChange={(e) => setOpComment(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setOpModalOpen(false)}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={opSubmitting}>
              {opSubmitting ? "Збереження…" : "Провести операцію"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Майстер «Закриття зміни» (3 кроки, 640 px) */}
      <Modal
        open={closeWizardOpen}
        onClose={() => setCloseWizardOpen(false)}
        title={`Закриття зміни · Крок ${wizardStep} з 3`}
        subtitle={currentShift ? `${currentShift.club_name} · ${currentShift.z_label}` : ""}
        size="md"
      >
        <div className="wizard-steps-indicator">
          <div
            className={`wizard-step-pill ${
              wizardStep === 1 ? "active" : wizardStep > 1 ? "done" : ""
            }`}
          >
            1. Активні сеанси
          </div>
          <div
            className={`wizard-step-pill ${
              wizardStep === 2 ? "active" : wizardStep > 2 ? "done" : ""
            }`}
          >
            2. Підрахунок каси
          </div>
          <div className={`wizard-step-pill ${wizardStep === 3 ? "active" : ""}`}>
            3. Підтвердження Z-звіту
          </div>
        </div>

        {wizardStep === 1 && (
          <div className="stack-form">
            {activeSessions.length > 0 ? (
              <div className="alert alert-warning" role="status">
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>
                      У залі ще тривають {activeSessions.length} активних сеансів.
                    </strong>
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      Вони автоматично перейдуть у наступну зміну й будуть оплачені при завершенні.
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="dashboard-ok-box">
                <CheckCircle2 size={20} className="ok-icon" />
                <div>
                  <div className="font-medium">Усі сеанси завершено</div>
                  <div className="subtle-meta">
                    Активних сеансів у залі немає — можна переходити до підрахунку каси.
                  </div>
                </div>
              </div>
            )}

            {activeSessions.length > 0 && (
              <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Місце</th>
                      <th>Клієнт</th>
                      <th>Початок</th>
                      <th className="num">Триває</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSessions.map((s) => (
                      <tr key={s.session_id}>
                        <td className="font-medium">
                          № {String(s.workstation_number).padStart(2, "0")} ({s.workstation_type})
                        </td>
                        <td>{s.client_name}</td>
                        <td className="tabular-nums">{formatTime(s.start_time)}</td>
                        <td className="num tabular-nums">{formatDuration(s.duration_minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions">
              {activeSessions.length > 0 && (
                <Link to="/hall" className="btn btn-secondary" style={{ marginRight: "auto" }}>
                  Перейти в зал і завершити
                </Link>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCloseWizardOpen(false)}
              >
                Скасувати
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setWizardStep(2)}
              >
                <span>Далі: Підрахунок готівки</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {wizardStep === 2 && (
          <div className="stack-form">
            <div className="pay-total-banner">
              <span className="pay-total-label">Очікується готівки в касі:</span>
              <span className="pay-total-value tabular-nums">
                {formatMoney(expectedCash)}
              </span>
            </div>

            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="actual-cash-input">
                  Фактично в касі (перераховано, ₴) <span className="required-mark">*</span>
                </label>
                <button
                  type="button"
                  className="link-action"
                  onClick={() => setShowDenomCalc((v) => !v)}
                >
                  <Calculator size={14} />
                  <span>
                    {showDenomCalc ? "Сховати калькулятор купюр" : "Калькулятор купюр і монет"}
                  </span>
                </button>
              </div>
              <input
                id="actual-cash-input"
                type="number"
                step="0.01"
                min="0"
                required
                className="tabular-nums"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
              />
            </div>

            {showDenomCalc && (
              <div className="denom-calc-grid">
                {DENOMINATIONS.map((d) => (
                  <div key={d.value} className="denom-item">
                    <span className="denom-label tabular-nums">{d.label}</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="denom-input tabular-nums"
                      placeholder="0"
                      value={denomCounts[d.value] ?? ""}
                      onChange={(e) => handleDenomChange(d.value, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Живий бейдж різниці каси */}
            <div
              className={`diff-badge-row ${
                cashDiff === 0 ? "ok" : cashDiff > 0 ? "surplus" : "shortage"
              }`}
            >
              <span>Різниця по касі:</span>
              <strong className="tabular-nums">
                {cashDiff === 0
                  ? "0,00 ₴ — Збігається"
                  : cashDiff > 0
                  ? `+${formatMoney(cashDiff)} — Лишок`
                  : `${formatMoney(cashDiff)} — Недостача`}
              </strong>
            </div>

            <div className="two-col-fields">
              <div className="field">
                <label className="field-label" htmlFor="terminal-card-input">
                  Підсумок за терміналом (картка), необов'язково
                </label>
                <input
                  id="terminal-card-input"
                  type="number"
                  step="0.01"
                  min="0"
                  className="tabular-nums"
                  placeholder={`За системою: ${formatMoney(cardSalesNum)}`}
                  value={terminalCardTotal}
                  onChange={(e) => setTerminalCardTotal(e.target.value)}
                />
                {cardDiff != null && (
                  <span
                    className={`subtle-meta ${
                      cardDiff === 0 ? "kpi-value-positive" : "kpi-value-negative"
                    }`}
                  >
                    Різниця з терміналом:{" "}
                    <strong className="tabular-nums">
                      {cardDiff > 0 ? "+" : ""}
                      {formatMoney(cardDiff)}
                    </strong>
                  </span>
                )}
              </div>

              <div className="field">
                <label className="field-label" htmlFor="safe-drop-close-input">
                  Здати виручку в сейф (інкасація при закритті, ₴)
                </label>
                <input
                  id="safe-drop-close-input"
                  type="number"
                  step="0.01"
                  min="0"
                  max={actualCashNum}
                  className="tabular-nums"
                  value={collectionOnClose}
                  onChange={(e) => setCollectionOnClose(e.target.value)}
                />
                <span className="subtle-meta">
                  Залишок у касі на наступну зміну:{" "}
                  <strong className="tabular-nums" style={{ color: "var(--ink)" }}>
                    {formatMoney(nextShiftCashLeft)}
                  </strong>
                </span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="close-comment-input">
                Пояснення розбіжності / коментар{" "}
                {cashDiff !== 0 ? (
                  <span className="required-mark">*</span>
                ) : (
                  <span className="subtle-meta">(необов'язково)</span>
                )}
              </label>
              <textarea
                id="close-comment-input"
                rows={2}
                required={cashDiff !== 0}
                placeholder={
                  cashDiff !== 0
                    ? "Обов'язково вкажіть причину лишку або недостачі в касі…"
                    : "Нотатка до закриття зміни (необов'язково)"
                }
                value={closeComment}
                onChange={(e) => setCloseComment(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setWizardStep(1)}
              >
                Назад
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleWizardNextFromStep2}
              >
                <span>Далі: Перевірка Z-звіту</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {wizardStep === 3 && currentShift && (
          <div className="stack-form">
            <div className="alert alert-warning" role="status">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <AlertTriangle size={18} />
                <span>
                  Після закриття зміни показники Z-звіту фіксуються і не можуть бути відредаговані.
                </span>
              </div>
            </div>

            <div className="z-preview-box">
              <div className="z-preview-row">
                <span>Майбутній Z-звіт:</span>
                <strong>Z-{String(currentShift.next_z_number || 1).padStart(4, "0")}</strong>
              </div>
              <div className="z-preview-row">
                <span>Загальна виручка зміни:</span>
                <strong className="tabular-nums">
                  {formatMoney(currentShift.revenue_total)}
                </strong>
              </div>
              <div className="z-preview-row">
                <span>Очікувалось готівки в касі:</span>
                <span className="tabular-nums">{formatMoney(expectedCash)}</span>
              </div>
              <div className="z-preview-row">
                <span>Фактично перераховано в касі:</span>
                <strong className="tabular-nums">{formatMoney(actualCashNum)}</strong>
              </div>
              <div className="z-preview-row">
                <span>Різниця по касі:</span>
                <strong
                  className={`tabular-nums ${
                    cashDiff === 0
                      ? "kpi-value-positive"
                      : cashDiff > 0
                      ? "kpi-value-warning"
                      : "kpi-value-negative"
                  }`}
                >
                  {cashDiff > 0 ? "+" : ""}
                  {formatMoney(cashDiff)}
                </strong>
              </div>
              <div className="z-preview-row">
                <span>Інкасація при закритті:</span>
                <span className="tabular-nums">−{formatMoney(collectionNum)}</span>
              </div>
              <div className="z-preview-row highlight">
                <span>Залишок у касі на наступну зміну:</span>
                <strong className="tabular-nums accent-text">
                  {formatMoney(nextShiftCashLeft)}
                </strong>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setWizardStep(2)}
                disabled={closeSubmitting}
              >
                Назад
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmCloseShift}
                disabled={closeSubmitting}
              >
                <CheckCircle2 size={16} />
                <span>
                  {closeSubmitting
                    ? "Формування Z-звіту…"
                    : "Закрити зміну й сформувати Z-звіт"}
                </span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Модальне вікно примусового закриття зміни (Директор) */}
      <Modal
        open={forceModalOpen}
        onClose={() => setForceModalOpen(false)}
        title="Примусове закриття зміни"
        subtitle={currentShift ? `${currentShift.club_name} · ${currentShift.z_label}` : ""}
        size="sm"
      >
        <form onSubmit={handleForceClose} className="stack-form">
          <div className="alert alert-warning" role="status">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                Використовуйте лише якщо адміністратор покинув клуб, не закривши зміну. Фактична
                готівка буде зафіксована рівною очікуваній ({formatMoney(expectedCash)}).
              </span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="force-comment-input">
              Причина примусового закриття <span className="required-mark">*</span>
            </label>
            <textarea
              id="force-comment-input"
              rows={3}
              required
              minLength={3}
              placeholder="Вкажіть причину примусового закриття зміни директором…"
              value={forceComment}
              onChange={(e) => setForceComment(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setForceModalOpen(false)}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-danger" disabled={forceSubmitting}>
              {forceSubmitting ? "Закриття…" : "Примусово закрити зміну"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
