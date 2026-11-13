import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Award,
  Edit2,
  Plus,
  Search,
  Trash2,
  Trophy,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "../api.js";
import { Badge, StatusBadge } from "../components/Badge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatMoney, formatPhone } from "../format.js";

export default function TournamentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, clubs } = useAuth();
  const toast = useToast();
  const canEdit = can("tournaments", "full");

  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Редагування турніру
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    club_id: "",
    name: "",
    game: "",
    date: "",
    prize_fund: "",
  });
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Додавання учасника
  const [addOpen, setAddOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  // Видалення турніру або учасника
  const [deleteTournamentOpen, setDeleteTournamentOpen] = useState(false);
  const [deletingTournament, setDeletingTournament] = useState(false);
  const [deletePartTarget, setDeletePartTarget] = useState(null);
  const [deletingPart, setDeletingPart] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/tournaments/${id}`);
      setTournament(data);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити турнір");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!addOpen) return;
    const t = setTimeout(async () => {
      try {
        const qs = clientSearch.trim()
          ? `?q=${encodeURIComponent(clientSearch.trim())}`
          : "";
        const data = await api.get(`/clients${qs}`);
        const list = Array.isArray(data) ? data : data?.items || [];
        setClients(list.slice(0, 30));
        if (!selectedClientId && list.length > 0) {
          setSelectedClientId(String(list[0].client_id));
        }
      } catch {
        // ігноруємо тимчасову помилку пошуку
      }
    }, 250);
    return () => clearTimeout(t);
  }, [addOpen, clientSearch, selectedClientId]);

  const openEdit = () => {
    if (!tournament) return;
    setEditForm({
      club_id: String(tournament.club_id),
      name: tournament.name,
      game: tournament.game,
      date: tournament.date,
      prize_fund: String(tournament.prize_fund),
    });
    setEditError("");
    setEditOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError("");
    setEditSaving(true);
    try {
      const updated = await api.patch(`/tournaments/${id}`, {
        club_id: Number(editForm.club_id),
        name: editForm.name.trim(),
        game: editForm.game.trim(),
        date: editForm.date,
        prize_fund: Number(editForm.prize_fund || 0),
      });
      setTournament(updated);
      setEditOpen(false);
      toast.success("Дані турніру оновлено");
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleAddParticipant = async (e) => {
    e.preventDefault();
    setAddError("");
    if (!selectedClientId) {
      setAddError("Оберіть клієнта зі списку");
      return;
    }
    setAdding(true);
    try {
      await api.post(`/tournaments/${id}/participants`, {
        client_id: Number(selectedClientId),
      });
      toast.success("Учасника зареєстровано в турнірі");
      setAddOpen(false);
      await load();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handlePlaceChange = async (part, newPlaceStr) => {
    const placeVal = newPlaceStr === "" ? null : Number(newPlaceStr);
    try {
      await api.patch(`/tournaments/${id}/participants/${part.participation_id}`, {
        place: placeVal,
      });
      toast.success(
        placeVal
          ? `Учаснику «${part.client_name}» присуджено ${placeVal} місце`
          : `Місце учасника «${part.client_name}» очищено`
      );
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const confirmDeleteParticipant = async () => {
    if (!deletePartTarget) return;
    setDeletingPart(true);
    try {
      await api.remove(
        `/tournaments/${id}/participants`,
        deletePartTarget.participation_id
      );
      toast.success(`Учасника «${deletePartTarget.client_name}» знято з турніру`);
      setDeletePartTarget(null);
      await load();
    } catch (err) {
      toast.error(err.message);
      setDeletePartTarget(null);
    } finally {
      setDeletingPart(false);
    }
  };

  const confirmDeleteTournament = async () => {
    setDeletingTournament(true);
    try {
      await api.remove("/tournaments", id);
      toast.success(`Турнір «${tournament.name}» видалено`);
      navigate("/tournaments");
    } catch (err) {
      toast.error(err.message);
      setDeleteTournamentOpen(false);
    } finally {
      setDeletingTournament(false);
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

  if (error || !tournament) {
    return (
      <section className="page-section">
        <div className="panel">
          <ErrorState message={error || "Турнір не знайдено"} onRetry={load} />
        </div>
      </section>
    );
  }

  const participants = tournament.participants || [];
  const winners = [1, 2, 3]
    .map((place) => ({
      place,
      member: participants.find((p) => p.place === place) || null,
    }))
    .filter((w) => w.member !== null);

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="detail-header-left">
          <Link to="/tournaments" className="back-link">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>До списку турнірів</span>
          </Link>
          <div className="hall-title-row">
            <h1>{tournament.name}</h1>
            <StatusBadge status={tournament.status} />
          </div>
          <div className="detail-meta-row">
            <span>{tournament.game}</span>
            <span className="meta-dot">·</span>
            <span>{tournament.club_name}</span>
            <span className="meta-dot">·</span>
            <span className="tabular-nums">{formatDate(tournament.date)}</span>
            <span className="meta-dot">·</span>
            <span className="tabular-nums font-medium accent-text">
              Призовий фонд: {formatMoney(tournament.prize_fund)}
            </span>
          </div>
        </div>

        {canEdit && (
          <div className="header-actions">
            <button type="button" className="btn btn-secondary" onClick={openEdit}>
              <Edit2 size={15} aria-hidden="true" />
              <span>Редагувати</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={participants.length > 0}
              title={
                participants.length > 0
                  ? "Видалення можливе лише для турніру без учасників"
                  : "Видалити турнір"
              }
              onClick={() => setDeleteTournamentOpen(true)}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>Видалити</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setClientSearch("");
                setSelectedClientId("");
                setAddError("");
                setAddOpen(true);
              }}
            >
              <UserPlus size={16} aria-hidden="true" />
              <span>Додати учасника</span>
            </button>
          </div>
        )}
      </div>

      {/* Блок «Призери» */}
      {winners.length > 0 && (
        <div className="winners-grid">
          {[1, 2, 3].map((place) => {
            const m = participants.find((p) => p.place === place);
            return (
              <div
                key={place}
                className={`panel winner-card winner-place-${place}`}
              >
                <div className="winner-card-top">
                  <Badge
                    variant={place === 1 ? "warning" : place === 2 ? "info" : "success"}
                  >
                    <Award size={13} aria-hidden="true" />
                    <span>{place} місце</span>
                  </Badge>
                  <Trophy size={18} className="winner-icon" aria-hidden="true" />
                </div>
                {m ? (
                  <>
                    <Link
                      to={`/clients/${m.client_id}`}
                      className="table-link winner-name"
                    >
                      {m.client_name}
                    </Link>
                    <span className="subtle-meta tabular-nums">
                      {formatPhone(m.client_phone)}
                    </span>
                  </>
                ) : (
                  <span className="subtle-meta">Ще не визначено</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Таблиця учасників */}
      <div className="panel table-wrap">
        <div className="panel-inner-header">
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            Учасники турніру ({participants.length})
          </h2>
        </div>

        {participants.length === 0 ? (
          <EmptyState
            text="У цьому турнірі ще не зареєстровано жодного учасника."
            actionLabel={canEdit ? "Додати учасника" : undefined}
            onAction={canEdit ? () => setAddOpen(true) : undefined}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>ПІБ учасника</th>
                <th>Телефон</th>
                <th>Зайняте місце</th>
                {canEdit && <th aria-label="Дії" className="actions-col" />}
              </tr>
            </thead>
            <tbody>
              {participants.map((p, idx) => (
                <tr key={p.participation_id}>
                  <td className="tabular-nums">{idx + 1}</td>
                  <td>
                    <Link to={`/clients/${p.client_id}`} className="table-link font-medium">
                      {p.client_name}
                    </Link>
                  </td>
                  <td className="tabular-nums">{formatPhone(p.client_phone)}</td>
                  <td>
                    {canEdit ? (
                      <select
                        className="select-compact"
                        aria-label={`Місце для ${p.client_name}`}
                        value={p.place ?? ""}
                        onChange={(e) => handlePlaceChange(p, e.target.value)}
                      >
                        <option value="">— Без місця —</option>
                        {Array.from({ length: participants.length }, (_, i) => i + 1).map(
                          (num) => (
                            <option key={num} value={num}>
                              {num} місце
                            </option>
                          )
                        )}
                      </select>
                    ) : p.place ? (
                      <Badge
                        variant={
                          p.place === 1
                            ? "warning"
                            : p.place === 2
                              ? "info"
                              : p.place === 3
                                ? "success"
                                : "neutral"
                        }
                      >
                        {p.place} місце
                      </Badge>
                    ) : (
                      <span className="subtle-meta">Учасник</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="actions">
                      <button
                        type="button"
                        className="link-danger"
                        onClick={() => setDeletePartTarget(p)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        <span>Видалити</span>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Панель додавання учасника */}
      <Drawer
        open={addOpen}
        title="Додати учасника в турнір"
        onClose={() => setAddOpen(false)}
      >
        <form className="stack-form" onSubmit={handleAddParticipant}>
          <div className="field">
            <label htmlFor="part-search" className="field-label">
              Пошук клієнта <span className="required-mark">*</span>
            </label>
            <div className="search-input-wrap full-width">
              <Search size={15} className="search-icon" aria-hidden="true" />
              <input
                id="part-search"
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
              size={Math.min(7, Math.max(3, clients.length))}
              className="client-select-list"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
            >
              {clients.map((c) => (
                <option key={c.client_id} value={c.client_id}>
                  {c.full_name} — {formatPhone(c.phone)}
                </option>
              ))}
            </select>
          </div>

          {addError && (
            <div className="alert" role="alert">
              {addError}
            </div>
          )}

          <div className="drawer-form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAddOpen(false)}
              disabled={adding}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={adding}>
              {adding ? "Додаємо…" : "Зареєструвати учасника"}
            </button>
          </div>
        </form>
      </Drawer>

      {/* Панель редагування турніру */}
      <Drawer
        open={editOpen}
        title="Редагувати турнір"
        onClose={() => setEditOpen(false)}
      >
        <form className="stack-form" onSubmit={handleEditSubmit}>
          <div className="field">
            <label htmlFor="edit-trn-club" className="field-label">
              Клуб <span className="required-mark">*</span>
            </label>
            <select
              id="edit-trn-club"
              required
              value={editForm.club_id}
              onChange={(e) => setEditForm({ ...editForm, club_id: e.target.value })}
            >
              {clubs.map((c) => (
                <option key={c.club_id} value={c.club_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="edit-trn-name" className="field-label">
              Назва <span className="required-mark">*</span>
            </label>
            <input
              id="edit-trn-name"
              type="text"
              maxLength={100}
              required
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="edit-trn-game" className="field-label">
              Гра <span className="required-mark">*</span>
            </label>
            <input
              id="edit-trn-game"
              type="text"
              maxLength={50}
              required
              value={editForm.game}
              onChange={(e) => setEditForm({ ...editForm, game: e.target.value })}
            />
          </div>

          <div className="two-col-fields">
            <div className="field">
              <label htmlFor="edit-trn-date" className="field-label">
                Дата <span className="required-mark">*</span>
              </label>
              <input
                id="edit-trn-date"
                type="date"
                required
                value={editForm.date}
                onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="edit-trn-prize" className="field-label">
                Призовий фонд (₴) <span className="required-mark">*</span>
              </label>
              <input
                id="edit-trn-prize"
                type="number"
                min="0"
                step="0.01"
                required
                value={editForm.prize_fund}
                onChange={(e) => setEditForm({ ...editForm, prize_fund: e.target.value })}
              />
            </div>
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

      <ConfirmDialog
        open={Boolean(deletePartTarget)}
        title={
          deletePartTarget
            ? `Зняти учасника «${deletePartTarget.client_name}» з турніру?`
            : "Видалити учасника?"
        }
        message="Учасника буде видалено зі списку цього турніру."
        confirmLabel="Видалити"
        loading={deletingPart}
        onConfirm={confirmDeleteParticipant}
        onCancel={() => setDeletePartTarget(null)}
      />

      <ConfirmDialog
        open={deleteTournamentOpen}
        title={`Видалити турнір «${tournament.name}»?`}
        message="Цю дію неможливо скасувати."
        confirmLabel="Видалити турнір"
        loading={deletingTournament}
        onConfirm={confirmDeleteTournament}
        onCancel={() => setDeleteTournamentOpen(false)}
      />
    </section>
  );
}

