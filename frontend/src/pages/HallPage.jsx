import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Clock,
  Cpu,
  Gamepad2,
  Headphones,
  Info,
  LayoutGrid,
  List,
  Monitor,
  Play,
  Plus,
  Receipt,
  RefreshCw,
  Square,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { api } from "../api.js";
import { Badge, StatusBadge } from "../components/Badge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import {
  FinishSessionModal,
  ReceiptModal,
  StartSessionDrawer,
  calcLiveSession,
  calcRemainingSeconds,
  formatTimerHMS,
} from "../components/SessionModals.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDuration, formatMoney, formatTime } from "../format.js";

const WS_TYPES = ["Standard", "VIP", "PlayStation"];

const WORKSTATION_SPECS = {
  Standard: {
    summary: "RTX 4060 · Core i5-13400F · 24.5″ 165 Гц",
    categoryTitle: "Ігровий ПК Standard",
    hardware: [
      { label: "Процесор", value: "Intel Core i5-13400F (10 ядер, до 4.6 ГГц)" },
      { label: "Відеокарта", value: "NVIDIA GeForce RTX 4060 8 ГБ GDDR6" },
      { label: "Оперативна пам’ять", value: "32 ГБ DDR5 5600 МГц" },
      { label: "Накопичувач", value: "1 ТБ NVMe M.2 SSD" },
    ],
    peripherals: [
      { label: "Монітор", value: "24.5″ ASUS TUF Gaming IPS, Full HD, 165 Гц" },
      { label: "Мишка", value: "Logitech G102 Lightsync (8000 DPI)" },
      { label: "Клавіатура", value: "HyperX Alloy Origins Core (механічна)" },
      { label: "Гарнітура", value: "HyperX Cloud II 7.1 Surround" },
      { label: "Крісло", value: "Hator Sport Essential (ігрове ергономічне)" },
    ],
  },
  VIP: {
    summary: "RTX 4080 Super · Ryzen 7 7800X3D · 27″ 240 Гц OLED",
    categoryTitle: "Преміум ігровий ПК VIP",
    hardware: [
      { label: "Процесор", value: "AMD Ryzen 7 7800X3D (8 ядер / 16 потоків, до 5.0 ГГц)" },
      { label: "Відеокарта", value: "NVIDIA GeForce RTX 4080 Super 16 ГБ GDDR6X" },
      { label: "Оперативна пам’ять", value: "64 ГБ DDR5 6000 МГц Dual Channel" },
      { label: "Накопичувач", value: "2 ТБ Samsung 990 PRO NVMe SSD" },
    ],
    peripherals: [
      { label: "Монітор", value: "27″ ASUS ROG Swift OLED, 2K QHD, 240 Гц, 0.03 мс" },
      { label: "Мишка", value: "Logitech G PRO X Superlight 2 Wireless" },
      { label: "Клавіатура", value: "Razer Huntsman V3 Pro TKL (оптико-механічна)" },
      { label: "Гарнітура", value: "Logitech G PRO X 2 Lightspeed Wireless" },
      { label: "Крісло", value: "Secretlab TITAN Evo (преміум підтримка спини)" },
    ],
  },
  PlayStation: {
    summary: "Sony PlayStation 5 · 2 геймпади DualSense · 65″ OLED 4K",
    categoryTitle: "Консольна зона PlayStation 5",
    hardware: [
      { label: "Консоль", value: "Sony PlayStation 5 (4K 120 Гц HDR, 1 ТБ SSD)" },
      { label: "Геймпади", value: "2× бездротові геймпади Sony DualSense + зарядна станція" },
    ],
    peripherals: [
      { label: "Екран", value: "65″ Телевізор LG OLED evo C3 4K Ultra HD, 120 Гц" },
      { label: "Звук і гарнітура", value: "Саундбар Sony Dolby Atmos + 2× Sony Pulse 3D Wireless" },
      { label: "Посадка", value: "М’який лаунж-диван та ігрові пуфи" },
    ],
  },
};

export default function HallPage() {
  const { user, can, clubs, selectedClubId, setSelectedClubId } = useAuth();
  const toast = useToast();

  // Адмін залу та Директор можуть керувати сеансами; Сисадмін — лише ставити/знімати ремонт
  const canManageSessions = can("hall", "full") || user?.role === "director";
  const canRepair =
    can("hall", "repair") || can("workstations", "full") || user?.role === "director";

  const [hallData, setHallData] = useState(null);
  const [tariffs, setTariffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [offlineWarning, setOfflineWarning] = useState(false);

  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "list"

  // Локальний тік щосекунди для живих таймерів
  const [nowMs, setNowMs] = useState(Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  // Потоки «Почати сеанс», «Завершити сеанс», «Скасувати», «Квитанція», «Характеристики»
  const [startDrawerOpen, setStartDrawerOpen] = useState(false);
  const [presetWs, setPresetWs] = useState(null);
  const [finishTarget, setFinishTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [receiptPaymentId, setReceiptPaymentId] = useState(null);
  const [receiptExtra, setReceiptExtra] = useState(null);
  const [specWs, setSpecWs] = useState(null);

  const activeClubId = selectedClubId || hallData?.club_id || clubs[0]?.club_id || null;

  const loadHall = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedClubId) params.set("club_id", String(selectedClubId));
        if (typeFilter) params.set("type", typeFilter);
        if (statusFilter) params.set("status", statusFilter);
        const qs = params.toString();

        const [hRes, tRes] = await Promise.all([
          api.get(`/hall${qs ? `?${qs}` : ""}`),
          tariffs.length === 0 ? api.get("/tariffs").catch(() => []) : Promise.resolve(tariffs),
        ]);
        setHallData(hRes);
        if (Array.isArray(tRes) && tRes.length > 0 && tariffs.length === 0) {
          setTariffs(tRes);
        }
        if (hRes?.server_time) {
          const srvMs = new Date(hRes.server_time).getTime();
          if (!Number.isNaN(srvMs)) {
            setServerOffsetMs(srvMs - Date.now());
          }
        }
        const now = new Date();
        setLastUpdated(
          `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`
        );
        setOfflineWarning(false);
        setError("");
      } catch (e) {
        if (hallData) {
          setOfflineWarning(true);
        } else {
          setError(e.message || "Не вдалося завантажити стан залу");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedClubId, typeFilter, statusFilter, tariffs.length]
  );

  useEffect(() => {
    loadHall(false);
  }, [selectedClubId, typeFilter, statusFilter]);

  // Автооновлення кожні 15 секунд (п. 7.3)
  useEffect(() => {
    const pollId = setInterval(() => {
      loadHall(true);
    }, 15000);
    return () => clearInterval(pollId);
  }, [loadHall]);

  // Щосекундний таймер для карток зайнятих місць
  useEffect(() => {
    const tickId = setInterval(() => {
      setNowMs(Date.now() + serverOffsetMs);
    }, 1000);
    return () => clearInterval(tickId);
  }, [serverOffsetMs]);

  // Закриття модального вікна характеристик за клавішею Escape
  useEffect(() => {
    if (!specWs) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setSpecWs(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [specWs]);

  const openStartForWs = (ws = null) => {
    setPresetWs(ws);
    setStartDrawerOpen(true);
  };

  const openFinishForWs = (ws) => {
    const act = ws.active_session;
    if (!act) return;
    if (act.is_prepaid) {
      releasePrepaidSession(ws);
      return;
    }
    setFinishTarget({
      ...act,
      workstation_id: ws.workstation_id,
      workstation_number: ws.number,
      workstation_type: ws.type,
    });
  };

  const releasePrepaidSession = async (ws) => {
    const act = ws.active_session;
    if (!act) return;
    try {
      await api.post(`/sessions/${act.session_id}/finish`, {});
      toast.success(`Сеанс на місці № ${ws.number} завершено, місце вільне`);
      await loadHall(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleRepair = async (ws) => {
    const nextStatus = ws.status === "на ремонті" ? "вільне" : "на ремонті";
    try {
      await api.patch(`/workstations/${ws.workstation_id}/status`, { status: nextStatus });
      toast.success(
        nextStatus === "на ремонті"
          ? `Місце № ${ws.number} переведено на ремонт`
          : `Місце № ${ws.number} повернуто в роботу`
      );
      await loadHall(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const confirmCancelSession = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.post(`/sessions/${cancelTarget.session_id}/cancel`, {});
      toast.success(`Сеанс № ${cancelTarget.session_id} скасовано без оплати`);
      setCancelTarget(null);
      await loadHall(true);
    } catch (err) {
      toast.error(err.message);
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  };

  const items = hallData?.items || [];
  const summary = hallData?.summary || { total: 0, free: 0, busy: 0, repair: 0 };
  const isShiftOpen = hallData ? Boolean(hallData.shift_open) : true;
  const freeWorkstations = useMemo(
    () => (hallData?.items || []).filter((w) => w.status === "вільне"),
    [hallData]
  );
  const activeSpecs = specWs ? WORKSTATION_SPECS[specWs.type] || WORKSTATION_SPECS.Standard : null;

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="hall-title-row">
          <h1>Зал</h1>
          {lastUpdated && (
            <span className="subtle-meta tabular-nums">Оновлено {lastUpdated}</span>
          )}
        </div>

        <div className="header-actions">
          <div className="tabs-bar" role="group" aria-label="Вид залу">
            <button
              type="button"
              className={`tab-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid size={15} aria-hidden="true" />
              <span>Сітка</span>
            </button>
            <button
              type="button"
              className={`tab-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <List size={15} aria-hidden="true" />
              <span>Список</span>
            </button>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => loadHall(false)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            <span>Оновити</span>
          </button>

          {canManageSessions && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={freeWorkstations.length === 0 || !isShiftOpen}
              title={!isShiftOpen ? "Спочатку відкрийте зміну" : undefined}
              onClick={() => openStartForWs(null)}
            >
              <Plus size={18} aria-hidden="true" />
              <span>Новий сеанс</span>
            </button>
          )}
        </div>
      </div>

      {/* Якщо обрано «Усі клуби», показуємо вкладки за клубами */}
      {!user?.club_id && clubs.length > 1 && (
        <div className="tabs-bar" role="tablist" aria-label="Вибір клубу залу">
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

      {hallData && !isShiftOpen && (
        <div className="alert alert-warning" role="alert">
          <span>
            <strong>Зміну не відкрито.</strong> Відкрийте зміну, щоб починати сеанси та приймати оплату.
          </span>
          <Link to="/shift" className="btn btn-primary btn-sm">
            Відкрити зміну →
          </Link>
        </div>
      )}

      {offlineWarning && (
        <div className="alert alert-warning" role="status">
          <span>
            Немає зв’язку з сервером. Показано дані станом на {lastUpdated || "останнє оновлення"}.
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => loadHall(false)}
          >
            Спробувати знову
          </button>
        </div>
      )}

      {/* Панель фільтрів і лічильників-таблеток */}
      <div className="filters-bar">
        <div className="chip-group" role="group" aria-label="Фільтр за статусом місця">
          <button
            type="button"
            className={`filter-chip ${statusFilter === "" ? "active" : ""}`}
            onClick={() => setStatusFilter("")}
          >
            Усі ({summary.total})
          </button>
          <button
            type="button"
            className={`filter-chip status-pill-free ${statusFilter === "вільне" ? "active" : ""}`}
            onClick={() => setStatusFilter(statusFilter === "вільне" ? "" : "вільне")}
          >
            Вільно ({summary.free})
          </button>
          <button
            type="button"
            className={`filter-chip status-pill-busy ${statusFilter === "зайняте" ? "active" : ""}`}
            onClick={() => setStatusFilter(statusFilter === "зайняте" ? "" : "зайняте")}
          >
            Зайнято ({summary.busy})
          </button>
          <button
            type="button"
            className={`filter-chip status-pill-repair ${statusFilter === "на ремонті" ? "active" : ""}`}
            onClick={() => setStatusFilter(statusFilter === "на ремонті" ? "" : "на ремонті")}
          >
            Ремонт ({summary.repair})
          </button>
        </div>

        <div className="chip-group" role="group" aria-label="Фільтр за типом місця">
          <button
            type="button"
            className={`filter-chip ${typeFilter === "" ? "active" : ""}`}
            onClick={() => setTypeFilter("")}
          >
            Усі типи
          </button>
          {WS_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`filter-chip ${typeFilter === t ? "active" : ""}`}
              onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="panel">
          <SkeletonTable columns={4} rows={5} />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={() => loadHall(false)} />
        </div>
      ) : items.length === 0 ? (
        <div className="panel">
          <EmptyState text="За обраними фільтрами робочих місць у залі немає." />
        </div>
      ) : viewMode === "grid" ? (
        <div className="hall-grid">
          {items.map((ws) => {
            const act = ws.active_session;
            const live = act
              ? calcLiveSession(act.start_time, act.price_per_hour, nowMs)
              : null;
            const isFixed = Boolean(act?.planned_end_time);
            const remainingSec = isFixed
              ? calcRemainingSeconds(act.planned_end_time, nowMs)
              : null;
            const totalPlannedSec =
              isFixed && act.planned_minutes ? act.planned_minutes * 60 : null;
            const progressPct =
              isFixed && totalPlannedSec && remainingSec != null
                ? Math.min(100, Math.max(0, (remainingSec / totalPlannedSec) * 100))
                : 0;
            const isExpired = isFixed && remainingSec === 0;
            const isExpiring = isFixed && remainingSec != null && remainingSec > 0 && remainingSec <= 600;
            const statusClass =
              ws.status === "вільне"
                ? "free"
                : ws.status === "зайняте"
                  ? "busy"
                  : "repair";
            const timerStateClass = isExpired
              ? "hall-card-expired"
              : isExpiring
                ? "hall-card-expiring"
                : "";
            const specInfo = WORKSTATION_SPECS[ws.type] || WORKSTATION_SPECS.Standard;

            return (
              <article
                key={ws.workstation_id}
                className={`hall-card hall-card-${statusClass} ${timerStateClass}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget) {
                    if (ws.status === "вільне" && canManageSessions) openStartForWs(ws);
                    else if (ws.status === "зайняте" && canManageSessions) openFinishForWs(ws);
                  }
                }}
              >
                <div className="hall-card-header">
                  <div className="hall-card-num-wrap">
                    <span className="hall-card-num tabular-nums">
                      № {String(ws.number).padStart(2, "0")}
                    </span>
                    <Badge
                      variant={
                        ws.type === "VIP"
                          ? "warning"
                          : ws.type === "PlayStation"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {ws.type}
                    </Badge>
                  </div>

                  <div className="hall-card-header-right">
                    <StatusBadge status={ws.status} />
                    <button
                      type="button"
                      className="hall-spec-trigger"
                      title="Характеристики та периферія місця"
                      aria-label={`Характеристики місця № ${ws.number}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSpecWs(ws);
                      }}
                    >
                      <Info size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Короткий рядок заліза прямо на картці */}
                <button
                  type="button"
                  className="hall-spec-summary-btn"
                  onClick={() => setSpecWs(ws)}
                  title="Натисніть, щоб переглянути повну комплектацію"
                >
                  {ws.type === "PlayStation" ? (
                    <Gamepad2 size={13} aria-hidden="true" />
                  ) : (
                    <Cpu size={13} aria-hidden="true" />
                  )}
                  <span className="hall-spec-summary-text">{specInfo.summary}</span>
                </button>

                {ws.status === "вільне" && (
                  <div className="hall-card-body">
                    <p className="hall-card-hint">Готове до роботи</p>
                    <div className="hall-card-actions">
                      {canManageSessions && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm hall-main-btn"
                          disabled={!isShiftOpen}
                          title={!isShiftOpen ? "Спочатку відкрийте зміну" : undefined}
                          onClick={() => openStartForWs(ws)}
                        >
                          <Play size={14} aria-hidden="true" />
                          <span>Почати сеанс</span>
                        </button>
                      )}
                      {canRepair && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm hall-sub-btn"
                          title="Позначити на ремонті"
                          onClick={() => toggleRepair(ws)}
                        >
                          <Wrench size={14} aria-hidden="true" />
                          <span>На ремонт</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {ws.status === "зайняте" && act && live && (
                  <div className="hall-card-body">
                    <div className="hall-busy-meta">
                      <Link to={`/clients/${act.client_id}`} className="table-link font-medium">
                        {act.client_name}
                      </Link>
                      <span className="subtle-meta tabular-nums">
                        {act.tariff_name} · з {formatTime(act.start_time)}
                        {isFixed && act.planned_end_time
                          ? ` до ${formatTime(act.planned_end_time)}`
                          : ""}
                      </span>
                    </div>

                    {isFixed ? (
                      <div className="hall-countdown-wrap tabular-nums">
                        <div className="hall-countdown-top">
                          <span
                            className={`hall-countdown-label ${
                              isExpired
                                ? "is-expired"
                                : isExpiring
                                  ? "is-expiring"
                                  : ""
                            }`}
                          >
                            <Clock size={12} aria-hidden="true" />
                            <span>{isExpired ? "Час вийшов" : "Залишилось"}</span>
                          </span>
                          <span className="hall-prepaid-pill">
                            Оплачено · {formatMoney(act.payment_amount ?? act.estimated_amount)}
                          </span>
                        </div>
                        <div className="hall-countdown-main">
                          <span
                            className={`hall-timer ${
                              isExpired
                                ? "is-expired"
                                : isExpiring
                                  ? "is-expiring"
                                  : ""
                            }`}
                          >
                            {formatTimerHMS(remainingSec ?? 0)}
                          </span>
                          <span className="subtle-meta">
                            з {formatDuration(act.planned_minutes)}
                          </span>
                        </div>
                        <div className="hall-countdown-bar" aria-hidden="true">
                          <div
                            className={`hall-countdown-fill ${
                              isExpired
                                ? "is-expired"
                                : isExpiring
                                  ? "is-expiring"
                                  : ""
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="hall-live-row tabular-nums">
                        <span className="hall-timer">{formatTimerHMS(live.elapsedSec)}</span>
                        <span className="hall-live-cost">≈ {formatMoney(live.amount)}</span>
                      </div>
                    )}

                    {canManageSessions && (
                      <div className="hall-card-actions">
                        {act.is_prepaid ? (
                          <>
                            <button
                              type="button"
                              className={`btn btn-sm hall-main-btn ${
                                isExpired ? "btn-primary" : "btn-secondary"
                              }`}
                              onClick={() => releasePrepaidSession(ws)}
                            >
                              <CheckCircle2 size={14} aria-hidden="true" />
                              <span>Звільнити місце</span>
                            </button>
                            {act.payment_id && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm hall-sub-btn"
                                title="Відкрити чек оплати"
                                onClick={() => {
                                  setReceiptExtra(null);
                                  setReceiptPaymentId(act.payment_id);
                                }}
                              >
                                <Receipt size={14} aria-hidden="true" />
                                <span>Чек</span>
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm hall-main-btn"
                              disabled={!isShiftOpen}
                              title={!isShiftOpen ? "Спочатку відкрийте зміну" : undefined}
                              onClick={() => openFinishForWs(ws)}
                            >
                              <Square size={14} aria-hidden="true" />
                              <span>Завершити</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm hall-sub-btn"
                              title="Скасувати помилково розпочатий сеанс"
                              onClick={() =>
                                setCancelTarget({
                                  session_id: act.session_id,
                                  workstation_number: ws.number,
                                  client_name: act.client_name,
                                })
                              }
                            >
                              <XCircle size={14} aria-hidden="true" />
                              <span>Скасувати</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {ws.status === "на ремонті" && (
                  <div className="hall-card-body">
                    <p className="hall-card-hint">Недоступне для клієнтів</p>
                    {canRepair && (
                      <div className="hall-card-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm hall-main-btn"
                          onClick={() => toggleRepair(ws)}
                        >
                          <CheckCircle2 size={14} aria-hidden="true" />
                          <span>Повернути в роботу</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Місце</th>
                <th>Тип</th>
                <th>Комплектація</th>
                <th>Статус</th>
                <th>Клієнт</th>
                <th>Тариф</th>
                <th>Початок</th>
                <th className="num">Таймер</th>
                <th className="num">Поточна сума</th>
                <th aria-label="Дії" className="actions-col" />
              </tr>
            </thead>
            <tbody>
              {items.map((ws) => {
                const act = ws.active_session;
                const live = act
                  ? calcLiveSession(act.start_time, act.price_per_hour, nowMs)
                  : null;
                const isFixed = Boolean(act?.planned_end_time);
                const remainingSec = isFixed
                  ? calcRemainingSeconds(act.planned_end_time, nowMs)
                  : null;
                const isExpired = isFixed && remainingSec === 0;
                const specInfo = WORKSTATION_SPECS[ws.type] || WORKSTATION_SPECS.Standard;
                return (
                  <tr key={ws.workstation_id}>
                    <td className="font-medium tabular-nums">
                      № {String(ws.number).padStart(2, "0")}
                    </td>
                    <td>
                      <Badge
                        variant={
                          ws.type === "VIP"
                            ? "warning"
                            : ws.type === "PlayStation"
                              ? "info"
                              : "neutral"
                        }
                      >
                        {ws.type}
                      </Badge>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link-action"
                        onClick={() => setSpecWs(ws)}
                      >
                        <Info size={14} aria-hidden="true" />
                        <span>{specInfo.summary}</span>
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={ws.status} />
                    </td>
                    <td>
                      {act ? (
                        <Link to={`/clients/${act.client_id}`} className="table-link font-medium">
                          {act.client_name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{act ? act.tariff_name : "—"}</td>
                    <td className="tabular-nums">
                      {act ? formatTime(act.start_time) : "—"}
                    </td>
                    <td className="num tabular-nums font-medium">
                      {isFixed ? (
                        <span className={isExpired ? "text-danger" : ""}>
                          {isExpired
                            ? "Час вийшов"
                            : `Залиш. ${formatTimerHMS(remainingSec ?? 0)}`}
                        </span>
                      ) : live ? (
                        formatTimerHMS(live.elapsedSec)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num tabular-nums font-medium">
                      {act?.is_prepaid
                        ? `Оплачено ${formatMoney(act.payment_amount ?? act.estimated_amount)}`
                        : live
                          ? `≈ ${formatMoney(live.amount)}`
                          : "—"}
                    </td>
                    <td className="actions">
                      <div className="row-actions">
                        {ws.status === "вільне" && canManageSessions && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!isShiftOpen}
                            title={!isShiftOpen ? "Спочатку відкрийте зміну" : undefined}
                            onClick={() => openStartForWs(ws)}
                          >
                            <Play size={14} />
                            <span>Почати сеанс</span>
                          </button>
                        )}
                        {ws.status === "зайняте" && act && canManageSessions && (
                          act.is_prepaid ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => releasePrepaidSession(ws)}
                              >
                                <CheckCircle2 size={14} />
                                <span>Звільнити</span>
                              </button>
                              {act.payment_id && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => {
                                    setReceiptExtra(null);
                                    setReceiptPaymentId(act.payment_id);
                                  }}
                                >
                                  <Receipt size={14} />
                                  <span>Чек</span>
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={!isShiftOpen}
                                title={!isShiftOpen ? "Спочатку відкрийте зміну" : undefined}
                                onClick={() => openFinishForWs(ws)}
                              >
                                <Square size={14} />
                                <span>Завершити</span>
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() =>
                                  setCancelTarget({
                                    session_id: act.session_id,
                                    workstation_number: ws.number,
                                    client_name: act.client_name,
                                  })
                                }
                              >
                                Скасувати
                              </button>
                            </>
                          )
                        )}
                        {ws.status !== "зайняте" && canRepair && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => toggleRepair(ws)}
                          >
                            <Wrench size={14} />
                            <span>
                              {ws.status === "на ремонті" ? "У роботу" : "На ремонт"}
                            </span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Модальне вікно характеристик і периферії робочого місця */}
      {specWs && activeSpecs && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSpecWs(null);
          }}
        >
          <div
            className="modal-card modal-card-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ws-spec-title"
          >
            <div className="modal-top-bar">
              <div className="spec-modal-title-group">
                <h2 id="ws-spec-title" className="modal-title">
                  Місце № {String(specWs.number).padStart(2, "0")} — {activeSpecs.categoryTitle}
                </h2>
                <div className="spec-modal-badges">
                  <Badge
                    variant={
                      specWs.type === "VIP"
                        ? "warning"
                        : specWs.type === "PlayStation"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {specWs.type}
                  </Badge>
                  <StatusBadge status={specWs.status} />
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                aria-label="Закрити"
                onClick={() => setSpecWs(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="spec-sections">
              <div className="spec-section-block">
                <div className="spec-section-header">
                  {specWs.type === "PlayStation" ? (
                    <Gamepad2 size={16} aria-hidden="true" />
                  ) : (
                    <Cpu size={16} aria-hidden="true" />
                  )}
                  <span>
                    {specWs.type === "PlayStation"
                      ? "Консоль та геймпади"
                      : "Характеристики системного блока"}
                  </span>
                </div>
                <dl className="spec-dl">
                  {activeSpecs.hardware.map((row) => (
                    <div key={row.label} className="spec-dl-row">
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="spec-section-block">
                <div className="spec-section-header">
                  {specWs.type === "PlayStation" ? (
                    <Monitor size={16} aria-hidden="true" />
                  ) : (
                    <Headphones size={16} aria-hidden="true" />
                  )}
                  <span>
                    {specWs.type === "PlayStation"
                      ? "Екран, звук та зона відпочинку"
                      : "Ігрова периферія та крісло"}
                  </span>
                </div>
                <dl className="spec-dl">
                  {activeSpecs.peripherals.map((row) => (
                    <div key={row.label} className="spec-dl-row">
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSpecWs(null)}
              >
                Закрити
              </button>
              {specWs.status === "вільне" && canManageSessions && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const target = specWs;
                    setSpecWs(null);
                    openStartForWs(target);
                  }}
                >
                  <Play size={15} aria-hidden="true" />
                  <span>Почати сеанс на цьому місці</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <StartSessionDrawer
        open={startDrawerOpen}
        onClose={() => setStartDrawerOpen(false)}
        presetWorkstation={presetWs}
        freeWorkstations={freeWorkstations}
        tariffs={tariffs}
        onStarted={(started) => {
          loadHall(true);
          if (started?.payment_id) {
            setReceiptExtra({
              cash_given: started.cash_given ?? null,
              change_amount: started.change_amount ?? null,
              bonus_earned: started.bonus_earned ?? null,
              bonus_spent: started.bonus_spent ?? null,
            });
            setReceiptPaymentId(started.payment_id);
          }
        }}
      />

      <FinishSessionModal
        open={Boolean(finishTarget)}
        session={finishTarget}
        onClose={() => setFinishTarget(null)}
        onFinished={(finished) => {
          loadHall(true);
          if (finished?.payment_id) {
            setReceiptExtra({
              cash_given: finished.cash_given ?? null,
              change_amount: finished.change_amount ?? null,
              bonus_earned: finished.bonus_earned ?? null,
              bonus_spent: finished.bonus_spent ?? null,
            });
            setReceiptPaymentId(finished.payment_id);
          }
        }}
      />

      <ReceiptModal
        open={Boolean(receiptPaymentId)}
        paymentId={receiptPaymentId}
        extraInfo={receiptExtra}
        onClose={() => {
          setReceiptPaymentId(null);
          setReceiptExtra(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        variant="warning"
        title={
          cancelTarget
            ? `Скасувати сеанс на місці № ${cancelTarget.workstation_number}?`
            : "Скасувати сеанс?"
        }
        message="Сеанс буде скасовано без створення оплати, а робоче місце звільниться. Адміністратор залу може скасувати сеанс до 5 хвилин від початку; довший сеанс скасовує Директор."
        confirmLabel="Скасувати сеанс"
        loading={cancelling}
        onConfirm={confirmCancelSession}
        onCancel={() => setCancelTarget(null)}
      />
    </section>
  );
}
