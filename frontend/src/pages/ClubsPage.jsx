import { useCallback, useEffect, useState } from "react";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatMoney, formatPhone } from "../format.js";

const BLANK = { name: "", address: "", phone: "" };

export default function ClubsPage() {
  const { can, reloadClubs } = useAuth();
  const toast = useToast();
  const canEdit = can("clubs", "full");

  const [clubs, setClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingClub, setEditingClub] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/clubs");
      setClubs(Array.isArray(data) ? data : data?.items || []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити клуби");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingClub(null);
    setForm(BLANK);
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (club) => {
    setEditingClub(club);
    setForm({
      name: club.name || "",
      address: club.address || "",
      phone: club.phone || "",
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const isDirty = editingClub
    ? form.name !== editingClub.name ||
      form.address !== editingClub.address ||
      form.phone !== editingClub.phone
    : Boolean(form.name.trim() || form.address.trim() || form.phone.trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
    };
    if (!payload.name || !payload.address || !payload.phone) {
      setFormError("Заповніть усі обов'язкові поля");
      return;
    }

    setSaving(true);
    try {
      if (editingClub) {
        await api.patch(`/clubs/${editingClub.club_id}`, payload);
        toast.success(`Клуб «${payload.name}» оновлено`);
      } else {
        await api.post("/clubs", payload);
        toast.success(`Клуб «${payload.name}» додано`);
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

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.remove("/clubs", deleteTarget.club_id);
      toast.success(`Клуб «${deleteTarget.name}» видалено`);
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
        <h1>Клуби</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={18} aria-hidden="true" />
            <span>Додати клуб</span>
          </button>
        )}
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={7} rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : clubs.length === 0 ? (
          <EmptyState
            text="Клубів ще немає. Додайте перший клуб мережі."
            actionLabel={canEdit ? "Додати клуб" : undefined}
            onAction={canEdit ? openCreate : undefined}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Назва</th>
                <th>Адреса</th>
                <th>Телефон</th>
                <th className="num">Місць</th>
                <th className="num">Співробітників</th>
                <th className="num">Виручка за місяць</th>
                {canEdit && <th aria-label="Дії" className="actions-col" />}
              </tr>
            </thead>
            <tbody>
              {clubs.map((c) => (
                <tr key={c.club_id}>
                  <td className="font-medium">{c.name}</td>
                  <td>{c.address}</td>
                  <td className="tabular-nums">{formatPhone(c.phone)}</td>
                  <td className="num tabular-nums">{c.workstations_count ?? c.pc_count ?? 0}</td>
                  <td className="num tabular-nums">{c.staff_count ?? 0}</td>
                  <td className="num tabular-nums font-medium">
                    {formatMoney(c.revenue_month ?? 0)}
                  </td>
                  {canEdit && (
                    <td className="actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          title="Редагувати"
                          aria-label={`Редагувати ${c.name}`}
                          onClick={() => openEdit(c)}
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          type="button"
                          className="link-danger"
                          onClick={() => setDeleteTarget(c)}
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

      <Drawer
        open={drawerOpen}
        title={editingClub ? "Редагувати клуб" : "Додати клуб"}
        isDirty={isDirty}
        onClose={() => setDrawerOpen(false)}
      >
        <form className="stack-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="club-name" className="field-label">
              Назва <span className="required-mark">*</span>
            </label>
            <input
              id="club-name"
              type="text"
              maxLength={100}
              required
              placeholder="Напр., Cyberion Центр"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="club-address" className="field-label">
              Адреса <span className="required-mark">*</span>
            </label>
            <input
              id="club-address"
              type="text"
              maxLength={200}
              required
              placeholder="вул. Соборна, 12"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="club-phone" className="field-label">
              Телефон <span className="required-mark">*</span>
            </label>
            <input
              id="club-phone"
              type="text"
              maxLength={20}
              required
              placeholder="+380500000001"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>

          <p className="subtle-meta">
            Кількість ПК у клубі обчислюється автоматично за доданими робочими місцями.
          </p>

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
              {saving ? "Зберігаємо…" : editingClub ? "Зберегти" : "Додати клуб"}
            </button>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Видалити клуб «${deleteTarget.name}»?` : "Видалити клуб?"}
        message="Видалення можливе лише для клубу без робочих місць, співробітників, турнірів і витрат."
        confirmLabel="Видалити"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

