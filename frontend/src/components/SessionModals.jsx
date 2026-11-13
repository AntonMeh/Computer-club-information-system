import { useEffect, useMemo, useState } from "react";
import { Banknote, Coins, CreditCard, Plus, Printer, Search, UserPlus, X } from "lucide-react";
import { api } from "../api.js";
import Drawer from "./Drawer.jsx";
import { useToast } from "./Toast.jsx";
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  formatPhone,
  formatTime,
} from "../format.js";

/**
 * Обчислює поточну тривалість у хвилинах (ceil, мінімум 1) та орієнтовну вартість.
 */
export function calcLiveSession(startTimeStr, pricePerHour, nowMs = Date.now()) {
  const startMs = new Date(startTimeStr).getTime();
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const minutes = Math.max(1, Math.ceil(elapsedSec / 60));
  const rawAmount = (minutes * Number(pricePerHour || 0)) / 60;
  const amount = Math.round((rawAmount + Number.EPSILON) * 100) / 100;
  return { elapsedSec, minutes, amount };
}

export function formatTimerHMS(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Висувна панель «Почати сеанс» (3 кліки з картки місця або кнопки «Новий сеанс»).
 */
export function StartSessionDrawer({
  open,
  onClose,
  onStarted,
  presetWorkstation = null,
  presetClient = null,
  freeWorkstations = [],
  tariffs = [],
}) {
  const toast = useToast();

  const [workstationId, setWorkstationId] = useState("");
  const [tariffId, setTariffId] = useState("");

  // Вибір існуючого клієнта або створення нового прямо в панелі
  const [isNewClient, setIsNewClient] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedWs = useMemo(() => {
    if (presetWorkstation && String(presetWorkstation.workstation_id) === String(workstationId)) {
      return presetWorkstation;
    }
    return (
      freeWorkstations.find((w) => String(w.workstation_id) === String(workstationId)) ||
      presetWorkstation ||
      null
    );
  }, [presetWorkstation, freeWorkstations, workstationId]);

  const matchingTariffs = useMemo(() => {
    if (!selectedWs) return tariffs;
    return tariffs.filter((t) => t.workstation_type === selectedWs.type);
  }, [tariffs, selectedWs]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setIsNewClient(false);
    setNewClientName("");
    setNewClientPhone("");

    const initialWsId =
      presetWorkstation?.workstation_id || freeWorkstations[0]?.workstation_id || "";
    setWorkstationId(String(initialWsId));

    if (presetClient) {
      setSelectedClientId(String(presetClient.client_id));
      setClientSearch(presetClient.full_name || "");
    } else {
      setSelectedClientId("");
      setClientSearch("");
    }
  }, [open, presetWorkstation, presetClient, freeWorkstations]);

  // Автопідстановка тарифу за типом обраного місця
  useEffect(() => {
    if (!open) return;
    if (matchingTariffs.length > 0) {
      const currentValid = matchingTariffs.some((t) => String(t.tariff_id) === String(tariffId));
      if (!currentValid) {
        setTariffId(String(matchingTariffs[0].tariff_id));
      }
    } else {
      setTariffId("");
    }
  }, [open, matchingTariffs, tariffId]);

  // Пошук клієнтів із debounce 250 мс
  useEffect(() => {
    if (!open || isNewClient) return;
    const timer = setTimeout(async () => {
      try {
        const qs = clientSearch.trim()
          ? `?q=${encodeURIComponent(clientSearch.trim())}`
          : "";
        const data = await api.get(`/clients${qs}`);
        const list = Array.isArray(data) ? data : data?.items || [];
        setClients(list.slice(0, 30));
        if (!selectedClientId && list.length > 0 && clientSearch.trim()) {
          setSelectedClientId(String(list[0].client_id));
        }
      } catch {
        // ігноруємо тимчасову помилку автодоповнення
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, isNewClient, clientSearch, selectedClientId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const wsId = Number(workstationId);
    const tId = Number(tariffId);
    if (!wsId) {
      setError("Оберіть вільне робоче місце");
      return;
    }
    if (!tId) {
      setError("Оберіть тариф для цього типу місця");
      return;
    }

    const payload = {
      workstation_id: wsId,
      tariff_id: tId,
    };

    if (isNewClient) {
      if (!newClientName.trim() || !newClientPhone.trim()) {
        setError("Вкажіть ПІБ і номер телефону нового клієнта");
        return;
      }
      payload.new_client_name = newClientName.trim();
      payload.new_client_phone = newClientPhone.trim();
    } else {
      if (!selectedClientId) {
        setError("Оберіть клієнта зі списку або натисніть «+ Новий клієнт»");
        return;
      }
      payload.client_id = Number(selectedClientId);
    }

    setSubmitting(true);
    try {
      const started = await api.post("/sessions", payload);
      toast.success(
        `Сеанс розпочато: місце № ${started.workstation_number}, ${started.client_name}`
      );
      onClose();
      onStarted?.(started);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer open={open} title="Почати сеанс" onClose={onClose}>
      <form className="stack-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="start-ws" className="field-label">
            Робоче місце <span className="required-mark">*</span>
          </label>
          {presetWorkstation ? (
            <input
              id="start-ws"
              type="text"
              readOnly
              value={`№ ${String(presetWorkstation.number).padStart(2, "0")} — ${presetWorkstation.type}`}
            />
          ) : (
            <select
              id="start-ws"
              required
              value={workstationId}
              onChange={(e) => setWorkstationId(e.target.value)}
            >
              <option value="">Оберіть вільне місце…</option>
              {freeWorkstations.map((w) => (
                <option key={w.workstation_id} value={w.workstation_id}>
                  № {String(w.number).padStart(2, "0")} ({w.type})
                  {w.club_name ? ` — ${w.club_name}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Клієнт */}
        <div className="field">
          <div className="field-label-row">
            <label htmlFor="start-client-search" className="field-label">
              Клієнт <span className="required-mark">*</span>
            </label>
            <button
              type="button"
              className="link-action"
              onClick={() => {
                setIsNewClient((v) => !v);
                setError("");
              }}
            >
              {isNewClient ? (
                <span>Обрати існуючого клієнта</span>
              ) : (
                <>
                  <UserPlus size={14} aria-hidden="true" />
                  <span>+ Новий клієнт</span>
                </>
              )}
            </button>
          </div>

          {!isNewClient ? (
            <div className="client-picker">
              <div className="search-input-wrap full-width">
                <Search size={15} className="search-icon" aria-hidden="true" />
                <input
                  id="start-client-search"
                  type="search"
                  autoFocus
                  placeholder="Введіть ПІБ або телефон клієнта…"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
                {clientSearch && (
                  <button
                    type="button"
                    className="search-clear"
                    aria-label="Очистити"
                    onClick={() => setClientSearch("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <select
                aria-label="Список знайдених клієнтів"
                size={Math.min(6, Math.max(3, clients.length))}
                className="client-select-list"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
              >
                {clients.map((c) => (
                  <option key={c.client_id} value={c.client_id}>
                    {c.full_name} — {formatPhone(c.phone)} (бонуси: {formatMoney(c.bonus_balance)})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="inline-new-client">
              <div className="field">
                <label htmlFor="inline-client-name" className="field-label">
                  ПІБ нового клієнта <span className="required-mark">*</span>
                </label>
                <input
                  id="inline-client-name"
                  type="text"
                  maxLength={100}
                  required
                  placeholder="Напр., Ковальчук Дмитро"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="inline-client-phone" className="field-label">
                  Телефон <span className="required-mark">*</span>
                </label>
                <input
                  id="inline-client-phone"
                  type="text"
                  maxLength={20}
                  required
                  placeholder="+380671234567"
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Тариф (відфільтрований за типом місця) */}
        <div className="field">
          <label htmlFor="start-tariff" className="field-label">
            Тариф ({selectedWs?.type || "відповідно до типу місця"}){" "}
            <span className="required-mark">*</span>
          </label>
          <select
            id="start-tariff"
            required
            value={tariffId}
            onChange={(e) => setTariffId(e.target.value)}
          >
            {matchingTariffs.length === 0 ? (
              <option value="">Немає тарифів для цього типу місця</option>
            ) : (
              matchingTariffs.map((t) => (
                <option key={t.tariff_id} value={t.tariff_id}>
                  {t.name} — {formatMoney(t.price_per_hour)} / год
                </option>
              ))
            )}
          </select>
        </div>

        <div className="field">
          <span className="field-label">Початок</span>
          <div className="readonly-pill">Зараз (за часом сервера)</div>
        </div>

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        <div className="drawer-form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Скасувати
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Запускаємо…" : "Почати сеанс"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

/**
 * Модальне вікно «Завершити сеанс» і прийняття оплати (розділ 7.3).
 */
export function FinishSessionModal({ open, session, onClose, onFinished }) {
  const toast = useToast();
  const [method, setMethod] = useState("готівка");
  const [cashGiven, setCashGiven] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!open) return;
    setMethod("готівка");
    setCashGiven("");
    setError("");
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, [open, session]);

  if (!open || !session) return null;

  const { minutes, amount } = calcLiveSession(
    session.start_time,
    session.price_per_hour,
    nowMs
  );
  const bonusBalance = Number(session.client_bonus_balance ?? 0);
  const canPayWithBonus = bonusBalance >= amount;
  const bonusToEarn = Math.floor(amount * 0.05 * 100) / 100;

  const cashNum = Number(cashGiven);
  const changeAmount =
    method === "готівка" && cashGiven !== "" && !Number.isNaN(cashNum) && cashNum >= amount
      ? cashNum - amount
      : null;

  const handleConfirm = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const finished = await api.post(`/sessions/${session.session_id}/finish`, {
        method,
      });
      toast.success(
        `Оплату ${formatMoney(finished.payment_amount)} прийнято. Місце № ${finished.workstation_number} вільне`
      );
      onClose();
      onFinished?.(finished);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-card modal-card-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-modal-title"
      >
        <div className="modal-top-bar">
          <h2 id="finish-modal-title" className="modal-title">
            Завершити сеанс № {session.session_id}
          </h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Закрити"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <dl className="desc-list finish-summary">
          <div className="desc-row">
            <dt>Клієнт</dt>
            <dd>{session.client_name}</dd>
          </div>
          <div className="desc-row">
            <dt>Робоче місце</dt>
            <dd>
              № {String(session.workstation_number).padStart(2, "0")} ({session.workstation_type})
            </dd>
          </div>
          <div className="desc-row">
            <dt>Тариф</dt>
            <dd className="tabular-nums">
              {session.tariff_name} ({formatMoney(session.price_per_hour)} / год)
            </dd>
          </div>
          <div className="desc-row">
            <dt>Час початку</dt>
            <dd className="tabular-nums">{formatTime(session.start_time)}</dd>
          </div>
          <div className="desc-row">
            <dt>Тривалість</dt>
            <dd className="tabular-nums">{formatDuration(minutes)}</dd>
          </div>
        </dl>

        <div className="pay-total-banner">
          <span className="pay-total-label">До сплати</span>
          <span className="pay-total-value tabular-nums">{formatMoney(amount)}</span>
        </div>

        <form className="stack-form" onSubmit={handleConfirm}>
          <div className="field">
            <span className="field-label">Спосіб оплати</span>
            <div className="payment-methods-grid">
              <button
                type="button"
                className={`payment-method-btn ${method === "готівка" ? "active" : ""}`}
                onClick={() => setMethod("готівка")}
              >
                <Banknote size={20} aria-hidden="true" />
                <span className="pm-title">Готівка</span>
                <span className="pm-sub tabular-nums">+{formatMoney(bonusToEarn)} бонусів</span>
              </button>

              <button
                type="button"
                className={`payment-method-btn ${method === "картка" ? "active" : ""}`}
                onClick={() => setMethod("картка")}
              >
                <CreditCard size={20} aria-hidden="true" />
                <span className="pm-title">Картка</span>
                <span className="pm-sub tabular-nums">+{formatMoney(bonusToEarn)} бонусів</span>
              </button>

              <button
                type="button"
                disabled={!canPayWithBonus}
                className={`payment-method-btn ${method === "бонуси" ? "active" : ""}`}
                onClick={() => setMethod("бонуси")}
              >
                <Coins size={20} aria-hidden="true" />
                <span className="pm-title">Бонуси</span>
                <span className="pm-sub tabular-nums">
                  {canPayWithBonus
                    ? `Доступно ${formatMoney(bonusBalance)}`
                    : `Недостатньо (${formatMoney(bonusBalance)})`}
                </span>
              </button>
            </div>
          </div>

          {method === "готівка" && (
            <div className="two-col-fields">
              <div className="field">
                <label htmlFor="cash-given" className="field-label">
                  Отримано від клієнта (₴)
                </label>
                <input
                  id="cash-given"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={String(Math.ceil(amount))}
                  value={cashGiven}
                  onChange={(e) => setCashGiven(e.target.value)}
                />
              </div>

              <div className="field">
                <span className="field-label">Решта</span>
                <div className="readonly-pill tabular-nums font-medium">
                  {changeAmount != null ? formatMoney(changeAmount) : "—"}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Проводимо оплату…" : "Завершити й прийняти оплату"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Модальне вікно квитанції (80 мм чек для друку).
 */
export function ReceiptModal({ open, paymentId, initialPayment = null, onClose }) {
  const [payment, setPayment] = useState(initialPayment);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialPayment && initialPayment.payment_id === paymentId) {
      setPayment(initialPayment);
      return;
    }
    if (!paymentId) return;
    setLoading(true);
    api
      .get(`/payments/${paymentId}`)
      .then((data) => setPayment(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, paymentId, initialPayment]);

  if (!open) return null;

  return (
    <div className="modal-backdrop receipt-backdrop" role="presentation">
      <div
        className="modal-card receipt-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
      >
        <div className="modal-top-bar no-print">
          <h2 id="receipt-title" className="modal-title">
            Квитанція про оплату
          </h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Закрити"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {loading || !payment ? (
          <p className="muted">Завантаження квитанції…</p>
        ) : (
          <div className="receipt-sheet">
            <div className="receipt-header">
              <div className="receipt-club-name">{payment.club_name || "Клубна система"}</div>
              {payment.club_address && (
                <div className="receipt-club-meta">{payment.club_address}</div>
              )}
              {payment.club_phone && (
                <div className="receipt-club-meta">{formatPhone(payment.club_phone)}</div>
              )}
            </div>

            <div className="receipt-divider" />

            <div className="receipt-rows tabular-nums">
              <div className="receipt-row">
                <span>Чек №</span>
                <strong>{payment.payment_id}</strong>
              </div>
              <div className="receipt-row">
                <span>Дата і час</span>
                <span>{formatDateTime(payment.payment_date)}</span>
              </div>
              <div className="receipt-row">
                <span>Сеанс №</span>
                <span>{payment.session_id}</span>
              </div>
              <div className="receipt-row">
                <span>Клієнт</span>
                <span>{payment.client_name}</span>
              </div>
              <div className="receipt-row">
                <span>Місце</span>
                <span>
                  № {String(payment.workstation_number).padStart(2, "0")} ({payment.workstation_type})
                </span>
              </div>
              <div className="receipt-row">
                <span>Тариф</span>
                <span>
                  {payment.tariff_name} ({formatMoney(payment.price_per_hour)}/год)
                </span>
              </div>
              <div className="receipt-row">
                <span>Тривалість</span>
                <span>{formatDuration(payment.duration_minutes)}</span>
              </div>
              <div className="receipt-row">
                <span>Спосіб оплати</span>
                <span>{payment.method}</span>
              </div>
            </div>

            <div className="receipt-divider" />

            <div className="receipt-total-row tabular-nums">
              <span>РАЗОМ</span>
              <strong>{formatMoney(payment.amount)}</strong>
            </div>

            <div className="receipt-footer">Дякуємо за гру!</div>
          </div>
        )}

        <div className="modal-actions no-print">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Закрити
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
            disabled={!payment}
          >
            <Printer size={16} aria-hidden="true" />
            <span>Друкувати</span>
          </button>
        </div>
      </div>
    </div>
  );
}

