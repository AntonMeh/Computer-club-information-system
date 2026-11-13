import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Edit2, Layers, Plus, Trash2, Wrench } from "lucide-react";
import { api } from "../api.js";
import { Badge, StatusBadge } from "../components/Badge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const WS_TYPES = ["Standard", "VIP", "PlayStation"];
const WS_STATUSES = ["вільне", "зайняте", "на ремонті"];

export default function WorkstationsPage() {
  const { can, clubs, selectedClubId, reloadClubs } = useAuth();
  const toast = useToast();
  const canEdit = can("workstations", "full");

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Одиночне створення / редагування
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingWs, setEditingWs] = useState(null);
  const [form, setForm] = useState({ club_id: "", number: "", type: "Standard" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Масове додавання діапазоном
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    club_id: "",
    number_from: "",
    number_to: "",
    type: "Standard",
  });
  const [bulkError, setBulkError] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const defaultClubId = selectedClubId || clubs[0]?.club_id || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedClubId) params.set("club_id", String(selectedClubId));
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      const qs = params.toString();
      const data = await api.get(`/workstations${qs ? `?${qs}` : ""}`);
      setItems(Array.isArray(data) ? data : data?.items || []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити робочі місця");
    } finally {
      setLoading(false);
    }
  }, [selectedClubId, typeFilter, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingWs(null);
    const maxNum = items.reduce((acc, w) => Math.max(acc, w.number), 0);
    setForm({
      club_id: String(defaultClubId),
      number: String(maxNum + 1),
      type: "Standard",
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (ws) => {
    setEditingWs(ws);
    setForm({
      club_id: String(ws.club_id),
      number: String(ws.number),
      type: ws.type,
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const openBulk = () => {
    const maxNum = items.reduce((acc, w) => Math.max(acc, w.number), 0);
    setBulkForm({
      club_id: String(defaultClubId),
      number_from: String(maxNum + 1),
      number_to: String(maxNum + 5),
      type: "Standard",
    });
    setBulkError("");
    setBulkOpen(true);
  };

  const handleSingleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const clubId = Number(form.club_id);
    const number = Number(form.number);
    if (!clubId || !number || number <= 0) {
      setFormError("Оберіть клуб і вкажіть коректний номер місця (більше 0)");
      return;
    }

    setSaving(true);
    try {
      if (editingWs) {
        await api.patch(`/workstations/${editingWs.workstation_id}`, {
          club_id: clubId,
          number,
          type: form.type,
        });
        toast.success(`Місце № ${number} оновлено`);
      } else {
        await api.post("/workstations", {
          club_id: clubId,
          number,
          type: form.type,
        });
        toast.success(`Місце № ${number} додано`);
      }
      setDrawerOpen(false);
      await load();
      await reloadClubs();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    setBulkError("");
    const clubId = Number(bulkForm.club_id);
    const numFrom = Number(bulkForm.number_from);
    const numTo = Number(bulkForm.number_to);
    if (!clubId || !numFrom || !numTo || numFrom <= 0 || numTo < numFrom) {
      setBulkError("Перевірте діапазон номерів (від ≤ до, більше 0)");
      return;
    }

    setBulkSaving(true);
    try {
      const created = await api.post("/workstations/bulk", {
        club_id: clubId,
        number_from: numFrom,
        number_to: numTo,
        type: bulkForm.type,
      });
      toast.success(`Додано місць: ${created.length} (№ ${numFrom}–${numTo})`);
      setBulkOpen(false);
      await load();
      await reloadClubs();
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkSaving(false);
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
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.remove("/workstations", deleteTarget.workstation_id);
      toast.success(`Місце № ${deleteTarget.number} видалено`);
      setDeleteTarget(null);
      await load();
      await reloadClubs();
    } catch (err) {
      toast.error(err.message);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Робочі місця</h1>
        {canEdit && (
          <div className="header-actions">
            <button type="button" className="btn btn-secondary" onClick={openBulk}>
              <Layers size={16} aria-hidden="true" />
              <span>Додати кілька</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={18} aria-hidden="true" />
              <span>Додати місце</span>
            </button>
          </div>
        )}
      </div>

      <div className="filters-bar">
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
              onClick={() => setTypeFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="chip-group" role="group" aria-label="Фільтр за статусом">
          <button
            type="button"
            className={`filter-chip ${statusFilter === "" ? "active" : ""}`}
            onClick={() => setStatusFilter("")}
          >
            Усі статуси
          </button>
          {WS_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`filter-chip ${statusFilter === s ? "active" : ""}`}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={6} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            text="За обраними фільтрами робочих місць не знайдено."
            actionLabel={canEdit ? "Додати місце" : undefined}
            onAction={canEdit ? openCreate : undefined}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>№</th>
                {!selectedClubId && <th>Клуб</th>}
                <th>Тип</th>
                <th>Статус</th>
                <th>Поточний сеанс</th>
                <th className="num">Сеансів усього</th>
                {canEdit && <th aria-label="Дії" className="actions-col" />}
              </tr>
            </thead>
            <tbody>
              {items.map((ws) => (
                <tr key={ws.workstation_id}>
                  <td className="tabular-nums font-medium">
                    № {String(ws.number).padStart(2, "0")}
                  </td>
                  {!selectedClubId && <td>{ws.club_name || `Клуб № ${ws.club_id}`}</td>}
                  <td>
                    <Badge variant={ws.type === "VIP" ? "warning" : ws.type === "PlayStation" ? "info" : "neutral"}>
                      {ws.type}
                    </Badge>
                  </td>
                  <td>
                    <StatusBadge status={ws.status} />
                  </td>
                  <td>
                    {ws.active_client_id ? (
                      <Link to={`/clients/${ws.active_client_id}`} className="table-link">
                        {ws.active_client_name || `Клієнт № ${ws.active_client_id}`}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num tabular-nums">{ws.sessions_count}</td>
                  {canEdit && (
                    <td className="actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={ws.status === "зайняте"}
                          title={
                            ws.status === "зайняте"
                              ? "Спочатку завершіть сеанс"
                              : ws.status === "на ремонті"
                                ? "Повернути в роботу"
                                : "Перевести на ремонт"
                          }
                          onClick={() => toggleRepair(ws)}
                        >
                          <Wrench size={14} aria-hidden="true" />
                          <span>
                            {ws.status === "на ремонті" ? "Повернути в роботу" : "На ремонт"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Редагувати"
                          aria-label={`Редагувати місце № ${ws.number}`}
                          onClick={() => openEdit(ws)}
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          type="button"
                          className="link-danger"
                          onClick={() => setDeleteTarget(ws)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          <span>Видалити</span>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Панель додавання / редагування одного місця */}
      <Drawer
        open={drawerOpen}
        title={editingWs ? `Редагувати місце № ${editingWs.number}` : "Додати робоче місце"}
        onClose={() => setDrawerOpen(false)}
      >
        <form className="stack-form" onSubmit={handleSingleSubmit}>
          <div className="field">
            <label htmlFor="ws-club" className="field-label">
              Клуб <span className="required-mark">*</span>
            </label>
            <select
              id="ws-club"
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
            <label htmlFor="ws-number" className="field-label">
              Номер місця <span className="required-mark">*</span>
            </label>
            <input
              id="ws-number"
              type="number"
              min="1"
              max="9999"
              required
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="ws-type" className="field-label">
              Тип місця <span className="required-mark">*</span>
            </label>
            <select
              id="ws-type"
              required
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {WS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
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
              {saving ? "Зберігаємо…" : editingWs ? "Зберегти" : "Додати місце"}
            </button>
          </div>
        </form>
      </Drawer>

      {/* Панель масового додавання місць */}
      <Drawer
        open={bulkOpen}
        title="Додати кілька робочих місць"
        onClose={() => setBulkOpen(false)}
      >
        <form className="stack-form" onSubmit={handleBulkSubmit}>
          <div className="field">
            <label htmlFor="bulk-club" className="field-label">
              Клуб <span className="required-mark">*</span>
            </label>
            <select
              id="bulk-club"
              required
              value={bulkForm.club_id}
              onChange={(e) => setBulkForm({ ...bulkForm, club_id: e.target.value })}
            >
              <option value="">Оберіть клуб…</option>
              {clubs.map((c) => (
                <option key={c.club_id} value={c.club_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="two-col-fields">
            <div className="field">
              <label htmlFor="bulk-from" className="field-label">
                Номер від <span className="required-mark">*</span>
              </label>
              <input
                id="bulk-from"
                type="number"
                min="1"
                max="9999"
                required
                value={bulkForm.number_from}
                onChange={(e) => setBulkForm({ ...bulkForm, number_from: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="bulk-to" className="field-label">
                Номер до <span className="required-mark">*</span>
              </label>
              <input
                id="bulk-to"
                type="number"
                min="1"
                max="9999"
                required
                value={bulkForm.number_to}
                onChange={(e) => setBulkForm({ ...bulkForm, number_to: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="bulk-type" className="field-label">
              Тип місць <span className="required-mark">*</span>
            </label>
            <select
              id="bulk-type"
              required
              value={bulkForm.type}
              onChange={(e) => setBulkForm({ ...bulkForm, type: e.target.value })}
            >
              {WS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {bulkError && (
            <div className="alert" role="alert">
              {bulkError}
            </div>
          )}

          <div className="drawer-form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setBulkOpen(false)}
              disabled={bulkSaving}
            >
              Скасувати
            </button>
            <button type="submit" className="btn btn-primary" disabled={bulkSaving}>
              {bulkSaving ? "Створюємо…" : "Створити місця"}
            </button>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget
            ? `Видалити місце № ${deleteTarget.number} (${deleteTarget.club_name || ""})?`
            : "Видалити місце?"
        }
        message="Місце з історією сеансів видалити не можна — для нього використовуйте статус «на ремонті»."
        confirmLabel="Видалити"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

