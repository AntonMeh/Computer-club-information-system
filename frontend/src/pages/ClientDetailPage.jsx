import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Coins, CreditCard, Edit2, Gamepad2, Trophy } from "lucide-react";
import { api } from "../api.js";
import { Badge, StatusBadge } from "../components/Badge.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatDateTime, formatMoney, formatPhone } from "../format.js";

export default function ClientDetailPage() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const toast = useToast();
  const canEdit = can("clients", "full");
  const isDirector = user?.role === "director";

  const [client, setClient] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState("sessions"); // "sessions" | "payments" | "tournaments"

  // Редагування профілю клієнта
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: "", phone: "", email: "" });
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Коригування бонусів (лише для Директора)
  const [bonusOpen, setBonusOpen] = useState(false);
  const [bonusForm, setBonusForm] = useState({ delta: "", reason: "" });
  const [bonusError, setBonusError] = useState("");
  const [bonusSaving, setBonusSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cData, sData, pData, tData] = await Promise.all([
        api.get(`/clients/${id}`),
        api.get(`/clients/${id}/sessions`),
        api.get(`/clients/${id}/payments`),
        api.get(`/clients/${id}/tournaments`),
      ]);
      setClient(cData);
      setSessions(Array.isArray(sData) ? sData : []);
      setPayments(Array.isArray(pData) ? pData : []);
      setTournaments(Array.isArray(tData) ? tData : []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити картку клієнта");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = () => {
    if (!client) return;
    setEditForm({
      full_name: client.full_name || "",
      phone: client.phone || "",
      email: client.email || "",
    });
    setEditError("");
    setEditOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError("");
    const fullName = editForm.full_name.trim();
    const phone = editForm.phone.trim();
    const email = editForm.email.trim() || null;
    if (!fullName || !phone) {
      setEditError("Заповніть ПІБ та номер телефону");
      return;
    }

    setEditSaving(true);
    try {
      const updated = await api.patch(`/clients/${id}`, {
        full_name: fullName,
        phone,
        email,
      });
      setClient(updated);
      setEditOpen(false);
      toast.success("Дані клієнта оновлено");
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const openBonusModal = () => {
    setBonusForm({ delta: "", reason: "" });
    setBonusError("");
    setBonusOpen(true);
  };

  const handleBonusSubmit = async (e) => {
    e.preventDefault();
    setBonusError("");
    const delta = Number(bonusForm.delta);
    const reason = bonusForm.reason.trim();
    if (!delta || Number.isNaN(delta)) {
      setBonusError("Вкажіть ненульову суму зміни бонусів (напр., 50 або -20)");
      return;
    }
    if (!reason) {
      setBonusError("Вкажіть причину коригування бонусів");
      return;
    }

    setBonusSaving(true);
    try {
      const updated = await api.post(`/clients/${id}/bonus-adjustment`, {
        delta,
        reason,
      });
      setClient(updated);
      setBonusOpen(false);
      toast.success(
        delta > 0
          ? `Нараховано ${formatMoney(delta)} бонусів`
          : `Списано ${formatMoney(Math.abs(delta))} бонусів`
      );
    } catch (err) {
      setBonusError(err.message);
    } finally {
      setBonusSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="page-section">
        <div className="panel">
          <SkeletonTable columns={4} rows={5} />
        </div>
      </section>
    );
  }

  if (error || !client) {
    return (
      <section className="page-section">
        <div className="panel">
          <ErrorState message={error || "Клієнта не знайдено"} onRetry={load} />
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="detail-header-left">
          <Link to="/clients" className="back-link">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>До списку клієнтів</span>
          </Link>
          <h1>{client.full_name}</h1>
          <div className="detail-meta-row">
            <span className="tabular-nums">{formatPhone(client.phone)}</span>
            {client.email && (
              <>
                <span className="meta-dot">·</span>
                <span>{client.email}</span>
              </>
            )}
            <span className="meta-dot">·</span>
            <span>Зареєстрований {formatDate(client.reg_date)}</span>
          </div>
        </div>

        <div className="header-actions">
          {isDirector && (
            <button type="button" className="btn btn-secondary" onClick={openBonusModal}>
              <Coins size={16} aria-hidden="true" />
              <span>Скоригувати бонуси</span>
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={openEdit}>
              <Edit2 size={16} aria-hidden="true" />
              <span>Редагувати</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI картки */}
      <div className="kpi-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Бонусний баланс</span>
          <span className="kpi-value tabular-nums accent-text">
            {formatMoney(client.bonus_balance)}
          </span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Усього сеансів</span>
          <span className="kpi-value tabular-nums">{client.sessions_count ?? 0}</span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Витрачено всього</span>
          <span className="kpi-value tabular-nums">{formatMoney(client.total_spent ?? 0)}</span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Середній чек</span>
          <span className="kpi-value tabular-nums">{formatMoney(client.avg_check ?? 0)}</span>
        </div>
      </div>

      {/* Вкладки історії */}
      <div className="tabs-bar" role="tablist" aria-label="Історія клієнта">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sessions"}
          className={`tab-btn ${activeTab === "sessions" ? "active" : ""}`}
          onClick={() => setActiveTab("sessions")}
        >
          <Gamepad2 size={16} aria-hidden="true" />
          <span>Сеанси ({sessions.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "payments"}
          className={`tab-btn ${activeTab === "payments" ? "active" : ""}`}
          onClick={() => setActiveTab("payments")}
        >
          <CreditCard size={16} aria-hidden="true" />
          <span>Оплати ({payments.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "tournaments"}
          className={`tab-btn ${activeTab === "tournaments" ? "active" : ""}`}
          onClick={() => setActiveTab("tournaments")}
        >
          <Trophy size={16} aria-hidden="true" />
          <span>Турніри ({tournaments.length})</span>
        </button>
      </div>

      {activeTab === "sessions" && (
        <div className="panel table-wrap">
          {sessions.length === 0 ? (
            <EmptyState text="У клієнта ще немає жодного ігрового сеансу." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Клуб</th>
                  <th>Місце</th>
                  <th>Тариф</th>
                  <th>Початок</th>
                  <th>Завершення</th>
                  <th>Статус</th>
                  <th className="num">Сума</th>
                  <th>Оплата</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td className="tabular-nums">№ {s.session_id}</td>
                    <td>{s.club_name}</td>
                    <td>
                      № {String(s.workstation_number).padStart(2, "0")}{" "}
                      <span className="subtle-meta">({s.workstation_type})</span>
                    </td>
                    <td>
                      {s.tariff_name}{" "}
                      <span className="subtle-meta tabular-nums">
                        ({formatMoney(s.price_per_hour)}/год)
                      </span>
                    </td>
                    <td className="tabular-nums">{formatDateTime(s.start_time)}</td>
                    <td className="tabular-nums">
                      {s.end_time ? formatDateTime(s.end_time) : "—"}
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="num tabular-nums font-medium">
                      {s.amount != null ? formatMoney(s.amount) : "—"}
                    </td>
                    <td>
                      {s.payment_method ? <StatusBadge status={s.payment_method} /> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "payments" && (
        <div className="panel table-wrap">
          {payments.length === 0 ? (
            <EmptyState text="Історія оплат клієнта порожня." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>№ оплати</th>
                  <th>Дата й час</th>
                  <th>Сеанс</th>
                  <th>Клуб</th>
                  <th>Місце</th>
                  <th>Спосіб оплати</th>
                  <th className="num">Сума</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.payment_id}>
                    <td className="tabular-nums">№ {p.payment_id}</td>
                    <td className="tabular-nums">{formatDateTime(p.payment_date)}</td>
                    <td className="tabular-nums">№ {p.session_id}</td>
                    <td>{p.club_name}</td>
                    <td className="tabular-nums">
                      № {String(p.workstation_number).padStart(2, "0")}
                    </td>
                    <td>
                      <StatusBadge status={p.method} />
                    </td>
                    <td className="num tabular-nums font-medium">{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "tournaments" && (
        <div className="panel table-wrap">
          {tournaments.length === 0 ? (
            <EmptyState text="Клієнт ще не брав участі в турнірах." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Турнір</th>
                  <th>Гра</th>
                  <th>Дата</th>
                  <th>Клуб</th>
                  <th className="num">Призовий фонд</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {tournaments.map((t) => (
                  <tr key={t.participation_id}>
                    <td>
                      <Link to={`/tournaments/${t.tournament_id}`} className="table-link font-medium">
                        {t.tournament_name}
                      </Link>
                    </td>
                    <td>{t.game}</td>
                    <td className="tabular-nums">{formatDate(t.date)}</td>
                    <td>{t.club_name}</td>
                    <td className="num tabular-nums">{formatMoney(t.prize_fund)}</td>
                    <td>
                      {t.place === 1 ? (
                        <Badge variant="warning">1 місце</Badge>
                      ) : t.place === 2 ? (
                        <Badge variant="info">2 місце</Badge>
                      ) : t.place === 3 ? (
                        <Badge variant="success">3 місце</Badge>
                      ) : t.place ? (
                        <Badge variant="neutral">{t.place} місце</Badge>
                      ) : (
                        <span className="subtle-meta">Учасник</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Панель редагування клієнта */}
      <Drawer
        open={editOpen}
        title="Редагувати клієнта"
        onClose={() => setEditOpen(false)}
      >
        <form className="stack-form" onSubmit={handleEditSubmit}>
          <div className="field">
            <label htmlFor="detail-name" className="field-label">
              ПІБ <span className="required-mark">*</span>
            </label>
            <input
              id="detail-name"
              type="text"
              maxLength={100}
              required
              value={editForm.full_name}
              onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="detail-phone" className="field-label">
              Телефон <span className="required-mark">*</span>
            </label>
            <input
              id="detail-phone"
              type="text"
              maxLength={20}
              required
              value={editForm.phone}
              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="detail-email" className="field-label">
              Email
            </label>
            <input
              id="detail-email"
              type="email"
              maxLength={100}
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
            />
          </div>

          {editError && (
            <div className="alert" role="alert">
              {editError}
            </div>
          )}

          <div className="drawer-form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditOpen(false)}
              disabled={editSaving}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={editSaving}>
              {editSaving ? "Зберігаємо…" : "Зберегти"}
            </button>
          </div>
        </form>
      </Drawer>

      {/* Панель ручного коригування бонусів (Директор) */}
      <Drawer
        open={bonusOpen}
        title="Коригування бонусного балансу"
        onClose={() => setBonusOpen(false)}
      >
        <form className="stack-form" onSubmit={handleBonusSubmit}>
          <p className="subtle-meta">
            Поточний баланс клієнта:{" "}
            <strong className="tabular-nums">{formatMoney(client.bonus_balance)}</strong>. Вкажіть
            додатне число для нарахування або від’ємне (напр., <code>-50</code>) для списання.
          </p>

          <div className="field">
            <label htmlFor="bonus-delta" className="field-label">
              Сума зміни (₴) <span className="required-mark">*</span>
            </label>
            <input
              id="bonus-delta"
              type="number"
              step="0.01"
              required
              placeholder="Напр., 100 або -50"
              value={bonusForm.delta}
              onChange={(e) => setBonusForm({ ...bonusForm, delta: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="bonus-reason" className="field-label">
              Причина коригування <span className="required-mark">*</span>
            </label>
            <input
              id="bonus-reason"
              type="text"
              maxLength={200}
              required
              placeholder="Напр., Бонус за участь в акції"
              value={bonusForm.reason}
              onChange={(e) => setBonusForm({ ...bonusForm, reason: e.target.value })}
            />
          </div>

          {bonusError && (
            <div className="alert" role="alert">
              {bonusError}
            </div>
          )}

          <div className="drawer-form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setBonusOpen(false)}
              disabled={bonusSaving}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={bonusSaving}>
              {bonusSaving ? "Застосовуємо…" : "Застосувати"}
            </button>
          </div>
        </form>
      </Drawer>
    </section>
  );
}

