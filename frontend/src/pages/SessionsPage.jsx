import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, Receipt, Search, Square, X, XCircle } from "lucide-react";
import { api } from "../api.js";
import { StatusBadge } from "../components/Badge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import {
  FinishSessionModal,
  ReceiptModal,
  StartSessionDrawer,
  calcRemainingSeconds,
  formatTimerHMS,
} from "../components/SessionModals.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDateTime, formatDuration, formatMoney, formatTime } from "../format.js";

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

export default function SessionsPage() {
  const { user, can, selectedClubId } = useAuth();
  const toast = useToast();
  const canManage = can("sessions", "full") || user?.role === "director";

  const [sessions, setSessions] = useState([]);
  const [summary, setSummary] = useState({ count: 0, minutes: 0, amount: 0 });
  const [workstations, setWorkstations] = useState([]);
  const [tariffs, setTariffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Фільтри
  const [periodPreset, setPeriodPreset] = useState("all"); // "today" | "yesterday" | "7d" | "month" | "custom" | "all"
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [wsFilter, setWsFilter] = useState("");
  const [tariffFilter, setTariffFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);

  // Панель деталей, старт, завершення, скасування, чек
  const [detailSession, setDetailSession] = useState(null);
  const [startOpen, setStartOpen] = useState(false);
  const [finishTarget, setFinishTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [receiptPaymentId, setReceiptPaymentId] = useState(null);
  const [receiptExtra, setReceiptExtra] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const hasActiveFixed = sessions.some(
      (s) => s.status === "активний" && Boolean(s.planned_end_time)
    );
    if (!hasActiveFixed) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sessions]);

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

  const loadAux = useCallback(async () => {
    try {
      const wsQs = selectedClubId ? `?club_id=${selectedClubId}` : "";
      const [wsRes, tRes] = await Promise.all([
        api.get(`/workstations${wsQs}`).catch(() => []),
        api.get("/tariffs").catch(() => []),
      ]);
      setWorkstations(Array.isArray(wsRes) ? wsRes : []);
      setTariffs(Array.isArray(tRes) ? tRes : []);
    } catch {
      // допоміжні довідники
    }
  }, [selectedClubId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedClubId) params.set("club_id", String(selectedClubId));
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (statusFilter) params.set("status", statusFilter);
      if (wsFilter) params.set("workstation_id", wsFilter);
      if (tariffFilter) params.set("tariff_id", tariffFilter);
      if (debouncedQuery) params.set("q", debouncedQuery);
      params.set("limit", "500");

      const data = await api.get(`/sessions?${params.toString()}`);
      setSessions(data?.items || []);
      setSummary(data?.summary || { count: 0, minutes: 0, amount: 0 });
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити журнал сеансів");
    } finally {
      setLoading(false);
    }
  }, [selectedClubId, dateFrom, dateTo, statusFilter, wsFilter, tariffFilter, debouncedQuery]);

  useEffect(() => {
    loadAux();
  }, [loadAux]);

  useEffect(() => {
    setPage(1);
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleSessions = sessions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const remainingPages = Math.max(0, totalPages - currentPage);

  const freeWorkstations = workstations.filter((w) => w.status === "вільне");

  const releasePrepaidSession = async (s) => {
    try {
      await api.post(`/sessions/${s.session_id}/finish`, {});
      toast.success(`Сеанс № ${s.session_id} завершено, місце № ${s.workstation_number} вільне`);
      setDetailSession(null);
      await load();
      await loadAux();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.post(`/sessions/${cancelTarget.session_id}/cancel`, {});
      toast.success(`Сеанс № ${cancelTarget.session_id} скасовано`);
      setCancelTarget(null);
      setDetailSession(null);
      await load();
      await loadAux();
    } catch (err) {
      toast.error(err.message);
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Сеанси</h1>
        {canManage && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setStartOpen(true)}
          >
            <Plus size={18} aria-hidden="true" />
            <span>Новий сеанс</span>
          </button>
        )}
      </div>

      {/* Рядок фільтрів */}
      <div className="filters-bar">
        <div className="chip-group" role="group" aria-label="Період сеансів">
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

        <div className="chip-group" role="group" aria-label="Статус сеансу">
          {[
            { key: "", label: "Усі" },
            { key: "активний", label: "Активні" },
            { key: "завершений", label: "Завершені" },
            { key: "скасований", label: "Скасовані" },
          ].map((st) => (
            <button
              key={st.key}
              type="button"
              className={`filter-chip ${statusFilter === st.key ? "active" : ""}`}
              onClick={() => setStatusFilter(st.key)}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            placeholder="Пошук за клієнтом, телефоном або № сеансу…"
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

        <div className="field-inline">
          <select
            className="select-compact"
            aria-label="Фільтр за робочим місцем"
            value={wsFilter}
            onChange={(e) => setWsFilter(e.target.value)}
          >
            <option value="">Усі місця</option>
            {workstations.map((w) => (
              <option key={w.workstation_id} value={w.workstation_id}>
                № {String(w.number).padStart(2, "0")} ({w.type})
              </option>
            ))}
          </select>

          <select
            className="select-compact"
            aria-label="Фільтр за тарифом"
            value={tariffFilter}
            onChange={(e) => setTariffFilter(e.target.value)}
          >
            <option value="">Усі тарифи</option>
            {tariffs.map((t) => (
              <option key={t.tariff_id} value={t.tariff_id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={10} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : sessions.length === 0 ? (
          <EmptyState
            text="За обраними фільтрами сеансів не знайдено."
            actionLabel={canManage ? "Новий сеанс" : undefined}
            onAction={canManage ? () => setStartOpen(true) : undefined}
          />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Клієнт</th>
                  <th>Місце</th>
                  <th>Тариф</th>
                  <th>Початок</th>
                  <th>Кінець</th>
                  <th className="num">Тривалість</th>
                  <th className="num">Сума</th>
                  <th>Оплата</th>
                  <th>Статус</th>
                  <th aria-label="Дії" className="actions-col" />
                </tr>
              </thead>
              <tbody>
                {visibleSessions.map((s) => {
                  const isActive = s.status === "активний";
                  const isFixedActive = isActive && Boolean(s.planned_end_time);
                  const remainingSec = isFixedActive
                    ? calcRemainingSeconds(s.planned_end_time, nowMs)
                    : null;
                  return (
                    <tr
                      key={s.session_id}
                      className="clickable-row"
                      onClick={() => setDetailSession(s)}
                    >
                      <td className="tabular-nums font-medium">№ {s.session_id}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Link to={`/clients/${s.client_id}`} className="table-link font-medium">
                          {s.client_name}
                        </Link>
                      </td>
                      <td>
                        № {String(s.workstation_number).padStart(2, "0")}{" "}
                        <span className="subtle-meta">({s.workstation_type})</span>
                      </td>
                      <td>{s.tariff_name}</td>
                      <td className="tabular-nums">{formatDateTime(s.start_time)}</td>
                      <td className="tabular-nums">
                        {isFixedActive ? (
                          <span
                            className={`font-medium ${
                              remainingSec === 0 ? "text-danger" : "accent-text"
                            }`}
                          >
                            {remainingSec === 0
                              ? "Час вийшов"
                              : `Залиш. ${formatTimerHMS(remainingSec ?? 0)}`}
                          </span>
                        ) : isActive ? (
                          <span className="accent-text font-medium">триває</span>
                        ) : s.end_time ? (
                          formatDateTime(s.end_time)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num tabular-nums">
                        {isActive && !s.is_prepaid ? "≈ " : ""}
                        {formatDuration(s.duration_minutes)}
                      </td>
                      <td className="num tabular-nums font-medium">
                        {s.status === "скасований"
                          ? "—"
                          : `${isActive && !s.is_prepaid ? "≈ " : ""}${formatMoney(s.calculated_amount)}`}
                      </td>
                      <td>
                        {s.payment_method ? <StatusBadge status={s.payment_method} /> : "—"}
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          {isActive && canManage && (
                            s.is_prepaid ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => releasePrepaidSession(s)}
                              >
                                <CheckCircle2 size={13} />
                                <span>Звільнити</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => setFinishTarget(s)}
                                >
                                  <Square size={13} />
                                  <span>Завершити</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setCancelTarget(s)}
                                >
                                  <XCircle size={13} />
                                  <span>Скасувати</span>
                                </button>
                              </>
                            )
                          )}
                          {s.payment_id && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setReceiptExtra(null);
                                setReceiptPaymentId(s.payment_id);
                              }}
                            >
                              <Receipt size={13} />
                              <span>Чек</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="table-summary-bar tabular-nums">
              <span>
                Усього сеансів: <strong>{summary.count}</strong>
              </span>
              <span>
                Загальна тривалість: <strong>{formatDuration(summary.minutes)}</strong>
              </span>
              <span>
                Сума завершених сеансів: <strong>{formatMoney(summary.amount)}</strong>
              </span>
            </div>
          </>
        )}
      </div>

      {!loading && !error && sessions.length > 0 && (
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

      {/* Панель деталей сеансу по кліку на рядок */}
      <Drawer
        open={Boolean(detailSession)}
        title={detailSession ? `Сеанс № ${detailSession.session_id}` : "Деталі сеансу"}
        onClose={() => setDetailSession(null)}
      >
        {detailSession && (
          <div className="stack-form">
            <dl className="desc-list">
              <div className="desc-row">
                <dt>Статус</dt>
                <dd>
                  <StatusBadge status={detailSession.status} />
                </dd>
              </div>
              <div className="desc-row">
                <dt>Клієнт</dt>
                <dd>
                  <Link
                    to={`/clients/${detailSession.client_id}`}
                    className="table-link font-medium"
                  >
                    {detailSession.client_name}
                  </Link>
                </dd>
              </div>
              <div className="desc-row">
                <dt>Клуб і місце</dt>
                <dd>
                  {detailSession.club_name} · №{" "}
                  {String(detailSession.workstation_number).padStart(2, "0")} (
                  {detailSession.workstation_type})
                </dd>
              </div>
              <div className="desc-row">
                <dt>Тариф</dt>
                <dd className="tabular-nums">
                  {detailSession.tariff_name} ({formatMoney(detailSession.price_per_hour)} / год)
                </dd>
              </div>
              <div className="desc-row">
                <dt>Початок</dt>
                <dd className="tabular-nums">{formatDateTime(detailSession.start_time)}</dd>
              </div>
              <div className="desc-row">
                <dt>Кінець</dt>
                <dd className="tabular-nums">
                  {detailSession.end_time
                    ? formatDateTime(detailSession.end_time)
                    : detailSession.planned_end_time
                      ? `Заплановано до ${formatTime(detailSession.planned_end_time)}`
                      : "Триває зараз"}
                </dd>
              </div>
              {detailSession.is_prepaid && (
                <div className="desc-row">
                  <dt>Формат</dt>
                  <dd>Фіксований час (передоплата)</dd>
                </div>
              )}
              <div className="desc-row">
                <dt>Тривалість</dt>
                <dd className="tabular-nums">{formatDuration(detailSession.duration_minutes)}</dd>
              </div>
              <div className="desc-row">
                <dt>Розрахунок</dt>
                <dd className="tabular-nums">
                  {detailSession.duration_minutes} хв ×{" "}
                  {formatMoney(detailSession.price_per_hour)}/год ={" "}
                  <strong>{formatMoney(detailSession.calculated_amount)}</strong>
                </dd>
              </div>
              {detailSession.payment_method && (
                <div className="desc-row">
                  <dt>Оплата</dt>
                  <dd>
                    <StatusBadge status={detailSession.payment_method} /> ·{" "}
                    <span className="tabular-nums">
                      {formatDateTime(detailSession.payment_date)}
                    </span>
                  </dd>
                </div>
              )}
            </dl>

            <div className="drawer-form-actions">
              <Link
                to={`/clients/${detailSession.client_id}`}
                className="btn btn-secondary"
              >
                Відкрити клієнта
              </Link>
              {detailSession.payment_id && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReceiptPaymentId(detailSession.payment_id)}
                >
                  <Receipt size={16} />
                  <span>Квитанція</span>
                </button>
              )}
              {detailSession.status === "активний" && canManage && (
                detailSession.is_prepaid ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => releasePrepaidSession(detailSession)}
                  >
                    Звільнити місце
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const target = detailSession;
                      setDetailSession(null);
                      setFinishTarget(target);
                    }}
                  >
                    Завершити сеанс
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </Drawer>

      <StartSessionDrawer
        open={startOpen}
        onClose={() => setStartOpen(false)}
        freeWorkstations={freeWorkstations}
        tariffs={tariffs}
        onStarted={(started) => {
          load();
          loadAux();
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
          load();
          loadAux();
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
            ? `Скасувати сеанс № ${cancelTarget.session_id}?`
            : "Скасувати сеанс?"
        }
        message="Сеанс буде скасовано без оплати. Продовжити?"
        confirmLabel="Скасувати сеанс"
        loading={cancelling}
        onConfirm={confirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </section>
  );
}

