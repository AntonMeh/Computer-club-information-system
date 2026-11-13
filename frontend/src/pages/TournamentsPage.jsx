import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, Gamepad2, MapPin, Plus, Trophy, Users } from "lucide-react";
import { api } from "../api.js";
import { StatusBadge } from "../components/Badge.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatMoney } from "../format.js";

const DEFAULT_GAMES = [
  "Counter-Strike 2",
  "Dota 2",
  "Valorant",
  "EA Sports FC 25",
  "Mortal Kombat 1",
  "Tekken 8",
];

function isoDate(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function TournamentsPage() {
  const { can, clubs, selectedClubId } = useAuth();
  const toast = useToast();
  const canEdit = can("tournaments", "full");

  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusTab, setStatusTab] = useState("all"); // "upcoming" | "completed" | "all"

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({
    club_id: "",
    name: "",
    game: "",
    date: isoDate(),
    prize_fund: "5000",
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const defaultClubId = selectedClubId || clubs[0]?.club_id || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedClubId) params.set("club_id", String(selectedClubId));
      if (statusTab && statusTab !== "all") params.set("status", statusTab);
      const qs = params.toString();
      const data = await api.get(`/tournaments${qs ? `?${qs}` : ""}`);
      setTournaments(Array.isArray(data) ? data : []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити турніри");
    } finally {
      setLoading(false);
    }
  }, [selectedClubId, statusTab]);

  useEffect(() => {
    load();
  }, [load]);

  const knownGames = useMemo(() => {
    const set = new Set(DEFAULT_GAMES);
    for (const t of tournaments) {
      if (t.game) set.add(t.game);
    }
    return Array.from(set);
  }, [tournaments]);

  const openCreate = () => {
    setForm({
      club_id: String(defaultClubId),
      name: "",
      game: "",
      date: isoDate(),
      prize_fund: "5000",
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const clubId = Number(form.club_id);
    const name = form.name.trim();
    const game = form.game.trim();
    const prizeFund = Number(form.prize_fund || 0);

    if (!clubId || !name || !game || !form.date || prizeFund < 0) {
      setFormError("Заповніть усі обов'язкові поля турніру");
      return;
    }

    setSaving(true);
    try {
      const created = await api.post("/tournaments", {
        club_id: clubId,
        name,
        game,
        date: form.date,
        prize_fund: prizeFund,
      });
      toast.success(`Турнір «${created.name}» створено`);
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Турніри</h1>
        <div className="header-actions">
          <div className="tabs-bar" role="tablist" aria-label="Фільтр турнірів за часом">
            {[
              { key: "upcoming", label: "Майбутні" },
              { key: "completed", label: "Завершені" },
              { key: "all", label: "Усі" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={statusTab === tab.key}
                className={`tab-btn ${statusTab === tab.key ? "active" : ""}`}
                onClick={() => setStatusTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={18} aria-hidden="true" />
              <span>Додати турнір</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="panel">
          <SkeletonTable columns={3} rows={4} />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : tournaments.length === 0 ? (
        <div className="panel">
          <EmptyState
            text="За обраним фільтром турнірів ще немає."
            actionLabel={canEdit ? "Додати турнір" : undefined}
            onAction={canEdit ? openCreate : undefined}
          />
        </div>
      ) : (
        <div className="tournaments-grid">
          {tournaments.map((t) => (
            <Link
              key={t.tournament_id}
              to={`/tournaments/${t.tournament_id}`}
              className="panel tournament-card"
            >
              <div className="tournament-card-top">
                <StatusBadge status={t.status} />
                <span className="tournament-prize tabular-nums">
                  <Trophy size={15} aria-hidden="true" />
                  <span>{formatMoney(t.prize_fund)}</span>
                </span>
              </div>

              <h2 className="tournament-card-title">{t.name}</h2>

              <div className="tournament-meta-list">
                <div className="tournament-meta-item">
                  <Gamepad2 size={15} aria-hidden="true" />
                  <span>{t.game}</span>
                </div>
                <div className="tournament-meta-item">
                  <MapPin size={15} aria-hidden="true" />
                  <span>{t.club_name}</span>
                </div>
                <div className="tournament-meta-item tabular-nums">
                  <Calendar size={15} aria-hidden="true" />
                  <span>{formatDate(t.date)}</span>
                </div>
              </div>

              <div className="tournament-card-footer">
                <span className="tournament-participants-count">
                  <Users size={15} aria-hidden="true" />
                  <span>
                    {t.participants_count > 0
                      ? `Учасників: ${t.participants_count}`
                      : "Немає учасників"}
                  </span>
                </span>
                <span className="table-link font-medium">Детальніше →</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Drawer
        open={drawerOpen}
        title="Новий турнір"
        onClose={() => setDrawerOpen(false)}
      >
        <form className="stack-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="trn-club" className="field-label">
              Клуб <span className="required-mark">*</span>
            </label>
            <select
              id="trn-club"
              required
              value={form.club_id}
              onChange={(e) => setForm({ ...form, club_id: e.target.value })}
            >
              <option value="">Оберіть клуб…</option>
              {clubs.map((c) => (
                <option key={c.club_id} value={c.club_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="trn-name" className="field-label">
              Назва турніру <span className="required-mark">*</span>
            </label>
            <input
              id="trn-name"
              type="text"
              maxLength={100}
              required
              placeholder="Напр., Cyberion Autumn Cup 2026"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="trn-game" className="field-label">
              Гра / дисципліна <span className="required-mark">*</span>
            </label>
            <input
              id="trn-game"
              type="text"
              list="known-games-list"
              maxLength={50}
              required
              placeholder="Напр., Counter-Strike 2"
              value={form.game}
              onChange={(e) => setForm({ ...form, game: e.target.value })}
            />
            <datalist id="known-games-list">
              {knownGames.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>

          <div className="two-col-fields">
            <div className="field">
              <label htmlFor="trn-date" className="field-label">
                Дата проведення <span className="required-mark">*</span>
              </label>
              <input
                id="trn-date"
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="trn-prize" className="field-label">
                Призовий фонд (₴) <span className="required-mark">*</span>
              </label>
              <input
                id="trn-prize"
                type="number"
                min="0"
                step="0.01"
                required
                value={form.prize_fund}
                onChange={(e) => setForm({ ...form, prize_fund: e.target.value })}
              />
            </div>
          </div>

          {formError && (
            <div className="alert" role="alert">
              {formError}
            </div>
          )}

          <div className="drawer-form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDrawerOpen(false)}
              disabled={saving}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Створюємо…" : "Створити турнір"}
            </button>
          </div>
        </form>
      </Drawer>
    </section>
  );
}

