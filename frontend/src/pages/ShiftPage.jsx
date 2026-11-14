import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  KeyRound,
  Lock,
  PlusCircle,
  Printer,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { api } from "../api.js";
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

function opBadgeClass(type) {
  if (type === "внесення") return "badge badge-success";
  if (type === "вилучення") return "badge badge-warning";
  return "badge badge-info";
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
  const [detailData, setDetailData] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const [safeDropOnClose, setSafeDropOnClose] = useState("0");
  const [closeComment, setCloseComment] = useState("");
  const [closeSubmitting, setCloseSubmitting] = useState(false);

  // Примусове закриття зміни (Директор)
  const [forceModalOpen, setForceModalOpen] = useState(false);
  const [forceComment, setForceComment] = useState("");
  const [forceSubmitting, setForceSubmitting] = useState(false);

  const loadShiftState = useCallback(async () => {
    if (!activeClubId) return;
    setLoading(true);
    try {
      const current = await api.get(`/shifts/current?club_id=${activeClubId}`);
      setStateData(current);
      if (current.current_shift) {
        const detail = await api.get(`/shifts/${current.current_shift.shift_id}`);
        setDetailData(detail);
      } else {
        setDetailData(null);
        setOpeningCash(String(Number(current.suggested_opening_cash ?? 0).toFixed(2)));
        setOpenComment("");
      }
    } catch (err) {
      toast.error(err.message || "Не вдалося завантажити стан зміни");
    } finally {
      setLoading(false);
    }
  }, [activeClubId, toast]);

  useEffect(() => {
    loadShiftState();
  }, [loadShiftState]);

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
    if (openingDiff !== 0 && openComment.trim().length < 3) {
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

  const currentShift = detailData?.shift || stateData?.current_shift;
  const expectedCash = Number(currentShift?.expected_cash ?? 0);

  const handleCreateOperation = async (e) => {
    e.preventDefault();
    const amountNum = Number(opAmount);
    if (!amountNum || amountNum <= 0) {
      toast.error("Сума операції має бути більшою за 0 ₴");
      return;
    }
    if ((opType === "вилучення" || opType === "інкасація") && amountNum > expectedCash) {
      toast.error(
        `У касі недостатньо готівки (доступно ${formatMoney(expectedCash)})`
      );
      return;
    }
    if (opComment.trim().length < 3) {
      toast.error("Вкажіть коментар (щонайменше 3 символи)");
      return;
    }
    setOpSubmitting(true);
    try {
      await api.post("/cash-operations", {
        shift_id: currentShift.shift_id,
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
    setSafeDropOnClose("0");
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
  const safeDropNum = Number(safeDropOnClose || 0);
  const nextShiftClosingCash = Number(Math.max(0, actualCashNum - safeDropNum).toFixed(2));

  const revenueCardNum = Number(currentShift?.revenue_card ?? 0);
  const hasTerminalInput = terminalCardTotal.trim() !== "";
  const terminalCardNum = hasTerminalInput ? Number(terminalCardTotal) : null;
  const cardDiff =
    terminalCardNum != null && !Number.isNaN(terminalCardNum)
      ? Number((terminalCardNum - revenueCardNum).toFixed(2))
      : null;

  const handleWizardNextFromStep2 = () => {
    if (Number.isNaN(actualCashNum) || actualCashNum < 0) {
      toast.error("Вкажіть фактичну суму готівки в касі");
      return;
    }
    if (Number.isNaN(safeDropNum) || safeDropNum < 0 || safeDropNum > actualCashNum) {
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
        safe_drop_on_close: Number(safeDropNum.toFixed(2)),
        terminal_card_total:
          terminalCardNum != null && !Number.isNaN(terminalCardNum)
            ? Number(terminalCardNum.toFixed(2))
            : null,
        comment: closeComment.trim() || null,
      });
      toast.success(`Зміну закрито. Сформовано Z-звіт Z-${String(closed.z_number).padStart(4, "0")}`);
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

  if (loading && !stateData) {
    return (
      <div className="page-container">
        <p className="muted">Завантаження даних зміни…</p>
      </div>
    );
  }

  const lastShift = stateData?.last_closed_shift;
  const payments = detailData?.payments || [];
  const cashOperations = detailData?.cash_operations || [];
  const activeSessions = detailData?.active_sessions || [];

  return (
    <div className="page-container">
      {/* Якщо користувач мережевий і не обрав конкретний клуб, показуємо швидкий вибір клубу */}
      {user?.club_id == null && clubs.length > 1 && (
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <label className="form-label" style={{ marginBottom: 0 }}>
            Клуб для перегляду / керування зміною:
          </label>
          <select
            className="form-select"
            style={{ maxWidth: 260 }}
            value={activeClubId}
            onChange={(e) => setSelectedClubId(Number(e.target.value))}
          >
            {clubs.map((c) => (
              <option key={c.club_id} value={c.club_id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!currentShift ? (
        /* Стан А — Зміну не відкрито */
        <div className="shift-closed-wrapper">
          <div className="card shift-open-card">
            <div className="shift-closed-header">
              <div className="shift-closed-icon">
                <Lock size={26} />
              </div>
              <div>
                <div className="shift-status-pill closed">Зміну не відкрито</div>
                <h2 style={{ margin: "6px 0 4px", fontSize: 20 }}>
                  {stateData?.club_name || "Обраний клуб"}
                </h2>
                {lastShift ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    Остання зміна:{" "}
                    <Link to={`/cash/z/${lastShift.shift_id}`} className="link-inline">
                      Z-{String(lastShift.z_number || 0).padStart(4, "0")}
                    </Link>
                    , закрита {formatDateTime(lastShift.closed_at)} · залишок у касі:{" "}
                    <strong className="tabular-nums">
                      {formatMoney(lastShift.closing_cash)}
                    </strong>
                  </p>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    Попередніх закритих змін у цьому клубі ще немає.
                  </p>
                )}
              </div>
            </div>

            {canManage ? (
              <form onSubmit={handleOpenShift} className="shift-open-form">
                <h3 className="section-subtitle" style={{ marginTop: 0 }}>
                  Відкрити зміну
                </h3>

                <div className="form-group">
                  <label className="form-label">Клуб</label>
                  <input
                    type="text"
                    className="form-input"
                    value={stateData?.club_name || `Клуб № ${activeClubId}`}
                    disabled
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="opening-cash-input">
                    Готівка в касі на початок (₴) *
                  </label>
                  <input
                    id="opening-cash-input"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    className="form-input tabular-nums"
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                  />
                  <span className="form-hint">
                    Очікуваний залишок з попередньої зміни:{" "}
                    <strong className="tabular-nums">{formatMoney(suggestedOpening)}</strong>
                  </span>
                </div>

                {openingDiff !== 0 && (
                  <div
                    className={`alert ${
                      openingDiff > 0 ? "alert-warning" : "alert-danger"
                    }`}
                    style={{ marginBottom: 12 }}
                  >
                    <AlertTriangle size={18} />
                    <span>
                      Розбіжність з кінцем попередньої зміни:{" "}
                      <strong className="tabular-nums">
                        {openingDiff > 0 ? "+" : ""}
                        {formatMoney(openingDiff)}
                      </strong>
                      . Вкажіть пояснення нижче.
                    </span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="opening-comment-input">
                    Коментар / пояснення розбіжності {openingDiff !== 0 ? "*" : "(необов'язково)"}
                  </label>
                  <textarea
                    id="opening-comment-input"
                    rows={2}
                    required={openingDiff !== 0}
                    className="form-input"
                    placeholder={
                      openingDiff !== 0
                        ? "Опишіть причину розбіжності готівки на початок зміни…"
                        : "Нотатка до відкриття зміни (необов'язково)"
                    }
                    value={openComment}
                    onChange={(e) => setOpenComment(e.target.value)}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={openingSubmitting}
                  >
                    <KeyRound size={16} />
                    <span>{openingSubmitting ? "Відкриття…" : "Відкрити зміну"}</span>
                  </button>
                </div>
              </form>
            ) : (
              <p className="muted" style={{ marginTop: 16 }}>
                У цьому клубі зміна наразі закрита. Тільки Адміністратор залу або Директор може відкрити зміну.
              </p>
            )}
          </div>
        </div>
      ) : (
        /* Стан Б — Зміна відкрита */
        <>
          <div className="card shift-active-header">
            <div className="shift-active-meta">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="badge badge-success">Відкрита</span>
                <h2 style={{ margin: 0, fontSize: 19 }}>
                  Зміна Z-{String(currentShift.z_number || 1).padStart(4, "0")} (проєкт) ·{" "}
                  {currentShift.club_name}
                </h2>
              </div>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                Відкрита {formatDate(currentShift.opened_at)} о{" "}
                {formatTime(currentShift.opened_at)} · триває{" "}
                <strong>{formatDuration(currentShift.duration_min)}</strong> · відкрив{" "}
                <strong>{currentShift.opened_by_name}</strong>
              </p>
            </div>

            <div className="shift-active-actions no-print">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.print()}
              >
                <Printer size={16} />
                <span>X-звіт</span>
              </button>

              {canManage && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={openOperationModal}
                  >
                    <PlusCircle size={16} />
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
                      <ShieldAlert size={16} />
                      <span>Закрити примусово</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={openCloseWizard}
                  >
                    <CheckCircle2 size={16} />
                    <span>Закрити зміну</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 6 KPI карток поточної зміни */}
          <div className="kpi-grid shift-kpi-grid" style={{ marginTop: 16 }}>
            <div className="kpi-card">
              <div className="kpi-title">Виручка за зміну</div>
              <div className="kpi-value tabular-nums">
                {formatMoney(currentShift.revenue_total)}
              </div>
              <div className="kpi-sub">Готівка + Картка</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title">Готівка (оплати)</div>
              <div className="kpi-value tabular-nums">
                {formatMoney(currentShift.revenue_cash)}
              </div>
              <div className="kpi-sub tabular-nums">
                {currentShift.cash_payments_count} оплат
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title">Картка (термінал)</div>
              <div className="kpi-value tabular-nums">
                {formatMoney(currentShift.revenue_card)}
              </div>
              <div className="kpi-sub tabular-nums">
                {currentShift.card_payments_count} оплат
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title">Бонуси списано</div>
              <div className="kpi-value tabular-nums">
                {formatMoney(currentShift.revenue_bonus)}
              </div>
              <div className="kpi-sub">Не входять у грошову виручку</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title">Сеансів завершено</div>
              <div className="kpi-value tabular-nums">
                {currentShift.sessions_completed}
              </div>
              <div className="kpi-sub tabular-nums">
                скасовано: {currentShift.sessions_cancelled}
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-title">Активних сеансів зараз</div>
              <div className="kpi-value tabular-nums">
                {currentShift.active_sessions_count}
              </div>
              <div className="kpi-sub">
                {currentShift.active_sessions_count > 0 ? (
                  <Link to="/hall" className="link-inline">
                    Перейти в зал →
                  </Link>
                ) : (
                  "Усі місця вільні"
                )}
              </div>
            </div>
          </div>

          {/* Блок «Готівка в касі» (формула шухляди) */}
          <div className="card cash-drawer-card" style={{ marginTop: 16 }}>
            <div className="card-header-row" style={{ marginBottom: 12 }}>
              <h3 className="section-subtitle" style={{ margin: 0 }}>
                <Wallet size={18} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
                Готівка в касі (розрахунок грошової шухляди)
              </h3>
              <span className="muted" style={{ fontSize: 12 }}>
                Проміжний стан (X-звіт)
              </span>
            </div>

            <div className="cash-formula-row">
              <div className="cash-formula-item">
                <span className="cash-formula-label">На початок зміни</span>
                <span className="cash-formula-val tabular-nums">
                  {formatMoney(currentShift.opening_cash)}
                </span>
              </div>
              <span className="cash-formula-op">+</span>
              <div className="cash-formula-item">
                <span className="cash-formula-label">Готівкові оплати</span>
                <span className="cash-formula-val tabular-nums text-success">
                  +{formatMoney(currentShift.revenue_cash)}
                </span>
              </div>
              <span className="cash-formula-op">+</span>
              <div className="cash-formula-item">
                <span className="cash-formula-label">Службові внесення</span>
                <span className="cash-formula-val tabular-nums text-success">
                  +{formatMoney(currentShift.cash_in_total)}
                </span>
              </div>
              <span className="cash-formula-op">−</span>
              <div className="cash-formula-item">
                <span className="cash-formula-label">Службові вилучення</span>
                <span className="cash-formula-val tabular-nums text-warning">
                  −{formatMoney(currentShift.cash_out_total)}
                </span>
              </div>
              <span className="cash-formula-op">−</span>
              <div className="cash-formula-item">
                <span className="cash-formula-label">Інкасація за зміну</span>
                <span className="cash-formula-val tabular-nums text-info">
                  −{formatMoney(currentShift.safe_drop_total)}
                </span>
              </div>
              <span className="cash-formula-op">=</span>
              <div className="cash-formula-item expected">
                <span className="cash-formula-label">Очікується в касі</span>
                <span className="cash-formula-expected tabular-nums">
                  {formatMoney(currentShift.expected_cash)}
                </span>
              </div>
            </div>
          </div>

          {/* Вкладки: Оплати за зміну та Службові операції */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="tabs-bar no-print" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className={`tab-btn ${activeTab === "payments" ? "active" : ""}`}
                onClick={() => setActiveTab("payments")}
              >
                <CreditCard size={15} />
                <span>Оплати за зміну ({payments.length})</span>
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === "operations" ? "active" : ""}`}
                onClick={() => setActiveTab("operations")}
              >
                <FileText size={15} />
                <span>Службові операції ({cashOperations.length})</span>
              </button>
            </div>

            {activeTab === "payments" ? (
              payments.length === 0 ? (
                <p className="muted" style={{ padding: "16px 0", textAlign: "center" }}>
                  У межах поточної зміни оплат ще не проведено.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Час</th>
                        <th>Клієнт</th>
                        <th>Сеанс / Місце</th>
                        <th>Спосіб оплати</th>
                        <th className="num">Сума</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.payment_id}>
                          <td className="tabular-nums">#{p.payment_id}</td>
                          <td className="tabular-nums">{formatDateTime(p.paid_at)}</td>
                          <td>{p.client_name || "Гість без реєстрації"}</td>
                          <td>
                            Сеанс #{p.session_id} · {p.workstation_name || "—"}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                p.payment_method === "готівка"
                                  ? "badge-success"
                                  : p.payment_method === "картка"
                                  ? "badge-info"
                                  : "badge-neutral"
                              }`}
                            >
                              {p.payment_method}
                            </span>
                          </td>
                          <td className="num tabular-nums">{formatMoney(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : cashOperations.length === 0 ? (
              <p className="muted" style={{ padding: "16px 0", textAlign: "center" }}>
                Службових операцій за поточну зміну немає.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Час</th>
                      <th>Тип</th>
                      <th>Категорія</th>
                      <th className="num">Сума</th>
                      <th>Хто провів</th>
                      <th>Коментар</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashOperations.map((op) => (
                      <tr key={op.operation_id}>
                        <td className="tabular-nums">{formatDateTime(op.created_at)}</td>
                        <td>
                          <span className={opBadgeClass(op.type)}>{op.type}</span>
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
            )}
          </div>
        </>
      )}

      {/* Модальне вікно «Службова операція» */}
      <Modal
        open={opModalOpen}
        onClose={() => setOpModalOpen(false)}
        title="Службова касова операція"
        size="sm"
      >
        <form onSubmit={handleCreateOperation}>
          <div className="form-group">
            <label className="form-label">Тип операції *</label>
            <div className="segmented-control">
              {["внесення", "вилучення", "інкасація"].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`segment-btn ${opType === t ? "active" : ""}`}
                  onClick={() => setOpType(t)}
                >
                  {t === "внесення"
                    ? "+ Внесення"
                    : t === "вилучення"
                    ? "− Вилучення"
                    : "− Інкасація"}
                </button>
              ))}
            </div>
            <span className="form-hint">
              {opType === "внесення" &&
                "Поповнення каси розмінною монетою або повернення здачі."}
              {opType === "вилучення" &&
                "Дрібні господарські витрати з каси або видача під звіт (автоматично створює запис у Витратах)."}
              {opType === "інкасація" &&
                "Проміжна здача готівкової виручки в сейф протягом зміни."}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="op-amount-input">
              Сума (₴) *
            </label>
            <input
              id="op-amount-input"
              type="number"
              step="0.01"
              min="0.01"
              required
              className="form-input tabular-nums"
              placeholder="0.00"
              value={opAmount}
              onChange={(e) => setOpAmount(e.target.value)}
            />
            {(opType === "вилучення" || opType === "інкасація") && (
              <span className="form-hint">
                Доступно готівки в касі:{" "}
                <strong className="tabular-nums">{formatMoney(expectedCash)}</strong>
              </span>
            )}
          </div>

          {opType === "вилучення" && (
            <div className="form-group">
              <label className="form-label" htmlFor="op-cat-select">
                Категорія витрат *
              </label>
              <select
                id="op-cat-select"
                className="form-select"
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

          <div className="form-group">
            <label className="form-label" htmlFor="op-comment-input">
              Коментар * (мін. 3 символи)
            </label>
            <textarea
              id="op-comment-input"
              rows={2}
              required
              minLength={3}
              className="form-input"
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
        size="md"
      >
        <div className="wizard-steps-indicator">
          <div className={`wizard-step-pill ${wizardStep === 1 ? "active" : wizardStep > 1 ? "done" : ""}`}>
            1. Активні сеанси
          </div>
          <div className={`wizard-step-pill ${wizardStep === 2 ? "active" : wizardStep > 2 ? "done" : ""}`}>
            2. Підрахунок каси
          </div>
          <div className={`wizard-step-pill ${wizardStep === 3 ? "active" : ""}`}>
            3. Підтвердження Z-звіту
          </div>
        </div>

        {wizardStep === 1 && (
          <div>
            {activeSessions.length > 0 ? (
              <div className="alert alert-warning" style={{ marginBottom: 14 }}>
                <AlertTriangle size={18} />
                <div>
                  <strong>
                    У залі ще тривають {activeSessions.length} активних сеансів.
                  </strong>
                  <div style={{ fontSize: 13, marginTop: 2 }}>
                    Вони автоматично перейдуть у наступну зміну й будуть оплачені при завершенні.
                  </div>
                </div>
              </div>
            ) : (
              <div className="alert alert-success" style={{ marginBottom: 14 }}>
                <CheckCircle2 size={18} />
                <span>Усі сеанси в клубі завершено. Жоден сеанс не переноситься.</span>
              </div>
            )}

            {activeSessions.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 14 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Місце</th>
                      <th>Клієнт</th>
                      <th>Початок</th>
                      <th>Триває</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSessions.map((s) => (
                      <tr key={s.session_id}>
                        <td>{s.workstation_name}</td>
                        <td>{s.client_name}</td>
                        <td className="tabular-nums">{formatTime(s.start_time)}</td>
                        <td className="tabular-nums">{formatDuration(s.elapsed_min)}</td>
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
          <div>
            <div className="cash-summary-banner">
              <span>Очікується готівки в касі:</span>
              <strong className="tabular-nums" style={{ fontSize: 18 }}>
                {formatMoney(expectedCash)}
              </strong>
            </div>

            <div className="form-group" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="form-label" htmlFor="actual-cash-input" style={{ marginBottom: 4 }}>
                  Фактично в касі (перераховано, ₴) *
                </label>
                <button
                  type="button"
                  className="btn-link"
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
                className="form-input tabular-nums"
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
                      className="form-input denom-input tabular-nums"
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
              <span>Різниця (каса):</span>
              <strong className="tabular-nums">
                {cashDiff === 0
                  ? "0,00 ₴ — Збігається"
                  : cashDiff > 0
                  ? `+${formatMoney(cashDiff)} — Лишок`
                  : `${formatMoney(cashDiff)} — Недостача`}
              </strong>
            </div>

            <div className="form-row-2" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="terminal-card-input">
                  Підсумок за терміналом (картка), необов'язково
                </label>
                <input
                  id="terminal-card-input"
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-input tabular-nums"
                  placeholder={`За системою: ${formatMoney(revenueCardNum)}`}
                  value={terminalCardTotal}
                  onChange={(e) => setTerminalCardTotal(e.target.value)}
                />
                {cardDiff != null && (
                  <span
                    className={`form-hint ${
                      cardDiff === 0 ? "text-success" : "text-danger"
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

              <div className="form-group">
                <label className="form-label" htmlFor="safe-drop-close-input">
                  Здати виручку в сейф (інкасація при закритті, ₴)
                </label>
                <input
                  id="safe-drop-close-input"
                  type="number"
                  step="0.01"
                  min="0"
                  max={actualCashNum}
                  className="form-input tabular-nums"
                  value={safeDropOnClose}
                  onChange={(e) => setSafeDropOnClose(e.target.value)}
                />
                <span className="form-hint">
                  Залишок у касі на наступну зміну:{" "}
                  <strong className="tabular-nums">{formatMoney(nextShiftClosingCash)}</strong>
                </span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="close-comment-input">
                Пояснення розбіжності / коментар {cashDiff !== 0 ? "*" : "(необов'язково)"}
              </label>
              <textarea
                id="close-comment-input"
                rows={2}
                required={cashDiff !== 0}
                className="form-input"
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
          <div>
            <div className="alert alert-warning" style={{ marginBottom: 12 }}>
              <AlertTriangle size={18} />
              <span>
                Після закриття зміни показники Z-звіту фіксуються і не можуть бути відредаговані.
              </span>
            </div>

            <div className="z-preview-box">
              <div className="z-preview-row">
                <span>Z-звіт №:</span>
                <strong>Z-{String(currentShift.z_number || 1).padStart(4, "0")}</strong>
              </div>
              <div className="z-preview-row">
                <span>Виручка (Готівка + Картка):</span>
                <strong className="tabular-nums">
                  {formatMoney(currentShift.revenue_total)}
                </strong>
              </div>
              <div className="z-preview-row">
                <span>Очікувалось готівки в касі:</span>
                <span className="tabular-nums">{formatMoney(expectedCash)}</span>
              </div>
              <div className="z-preview-row">
                <span>Фактично готівки в касі:</span>
                <strong className="tabular-nums">{formatMoney(actualCashNum)}</strong>
              </div>
              <div className="z-preview-row">
                <span>Різниця по касі:</span>
                <strong
                  className={`tabular-nums ${
                    cashDiff === 0
                      ? "text-success"
                      : cashDiff > 0
                      ? "text-warning"
                      : "text-danger"
                  }`}
                >
                  {cashDiff > 0 ? "+" : ""}
                  {formatMoney(cashDiff)}
                </strong>
              </div>
              <div className="z-preview-row">
                <span>Інкасація при закритті:</span>
                <span className="tabular-nums">−{formatMoney(safeDropNum)}</span>
              </div>
              <div className="z-preview-row highlight">
                <span>Залишок у касі на наступну зміну:</span>
                <strong className="tabular-nums">{formatMoney(nextShiftClosingCash)}</strong>
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
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
        size="sm"
      >
        <form onSubmit={handleForceClose}>
          <div className="alert alert-warning" style={{ marginBottom: 12 }}>
            <ShieldAlert size={18} />
            <span>
              Використовуйте лише якщо адміністратор покинув клуб, не закривши зміну. Фактична
              готівка буде зафіксована рівною очікуваній ({formatMoney(expectedCash)}).
            </span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="force-comment-input">
              Причина примусового закриття *
            </label>
            <textarea
              id="force-comment-input"
              rows={3}
              required
              minLength={3}
              className="form-input"
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
    </div>
  );
}
