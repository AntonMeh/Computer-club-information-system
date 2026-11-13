import { useCallback, useEffect, useState } from "react";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { Badge } from "../components/Badge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatMoney } from "../format.js";

const WS_TYPES = ["Standard", "VIP", "PlayStation"];

export default function TariffsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can("tariffs", "full");

  const [tariffs, setTariffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTariff, setEditingTariff] = useState(null);
  const [form, setForm] = useState({
    name: "",
    workstation_type: "Standard",
    price_per_hour: "",
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/tariffs");
      setTariffs(Array.isArray(data) ? data : data?.items || []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити тарифи");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = (defaultType = "Standard") => {
    setEditingTariff(null);
    setForm({ name: "", workstation_type: defaultType, price_per_hour: "" });
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (t) => {
    setEditingTariff(t);
    setForm({
      name: t.name,
      workstation_type: t.workstation_type,
      price_per_hour: String(t.price_per_hour),
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const name = form.name.trim();
    const price = Number(form.price_per_hour);
    if (!name || !price || price <= 0) {
      setFormError("Вкажіть назву тарифу та ціну за годину (більше 0)");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name,
        workstation_type: form.workstation_type,
        price_per_hour: price,
      };
      if (editingTariff) {
        await api.patch(`/tariffs/${editingTariff.tariff_id}`, payload);
        toast.success(`Тариф «${name}» оновлено`);
      } else {
        await api.post("/tariffs", payload);
        toast.success(`Тариф «${name}» створено`);
      }
      setDrawerOpen(false);
      await load();
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
      await api.remove("/tariffs", deleteTarget.tariff_id);
      toast.success(`Тариф «${deleteTarget.name}» видалено`);
      setDeleteTarget(null);
      await load();
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
        <h1>Тарифи</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => openCreate("Standard")}>
            <Plus size={18} aria-hidden="true" />
            <span>Додати тариф</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="panel">
          <SkeletonTable columns={3} rows={4} />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : tariffs.length === 0 ? (
        <div className="panel">
          <EmptyState
            text="Тарифів ще немає. Додайте перший тариф."
            actionLabel={canEdit ? "Додати тариф" : undefined}
            onAction={canEdit ? () => openCreate("Standard") : undefined}
          />
        </div>
      ) : (
        <div className="tariff-columns">
          {WS_TYPES.map((wsType) => {
            const group = tariffs.filter((t) => t.workstation_type === wsType);
            return (
              <div key={wsType} className="tariff-column">
                <div className="tariff-column-header">
                  <Badge
                    variant={
                      wsType === "VIP" ? "warning" : wsType === "PlayStation" ? "info" : "neutral"
                    }
                  >
                    {wsType}
                  </Badge>
                  <span className="subtle-meta">{group.length} шт.</span>
                </div>

                {group.length === 0 ? (
                  <div className="panel tariff-empty">
                    <p className="subtle-meta">Немає тарифів для {wsType}</p>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openCreate(wsType)}
                      >
                        <Plus size={14} />
                        <span>Додати</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="tariff-cards">
                    {group.map((t) => (
                      <article key={t.tariff_id} className="panel tariff-card">
                        <div className="tariff-card-top">
                          <h2 className="tariff-card-name">{t.name}</h2>
                          {canEdit && (
                            <div className="row-actions">
                              <button
                                type="button"
                                className="btn-icon"
                                title="Редагувати тариф"
                                aria-label={`Редагувати ${t.name}`}
                                onClick={() => openEdit(t)}
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                type="button"
                                className="btn-icon danger-icon"
                                title="Видалити тариф"
                                aria-label={`Видалити ${t.name}`}
                                onClick={() => setDeleteTarget(t)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="tariff-price tabular-nums">
                          {formatMoney(t.price_per_hour)} <span className="tariff-per-hour">/ год</span>
                        </div>

                        <p className="subtle-meta">
                          Використано в {t.sessions_count ?? 0} сеансах
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Drawer
        open={drawerOpen}
        title={editingTariff ? "Редагувати тариф" : "Додати тариф"}
        onClose={() => setDrawerOpen(false)}
      >
        <form className="stack-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="tariff-name" className="field-label">
              Назва <span className="required-mark">*</span>
            </label>
            <input
              id="tariff-name"
              type="text"
              maxLength={50}
              required
              placeholder="Напр., Стандарт або Нічний Стандарт"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="tariff-type" className="field-label">
              Тип місця <span className="required-mark">*</span>
            </label>
            <select
              id="tariff-type"
              required
              value={form.workstation_type}
              onChange={(e) => setForm({ ...form, workstation_type: e.target.value })}
            >
              {WS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="tariff-price" className="field-label">
              Ціна за годину (₴) <span className="required-mark">*</span>
            </label>
            <input
              id="tariff-price"
              type="number"
              min="0.01"
              max="99999.99"
              step="0.01"
              required
              placeholder="60.00"
              value={form.price_per_hour}
              onChange={(e) => setForm({ ...form, price_per_hour: e.target.value })}
            />
          </div>

          <p className="subtle-meta">
            Зміна ціни діє лише на нові сеанси; ціна активних сеансів фіксується на момент початку.
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
              {saving ? "Зберігаємо…" : editingTariff ? "Зберегти" : "Додати тариф"}
            </button>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Видалити тариф «${deleteTarget.name}»?` : "Видалити тариф?"}
        message="Тариф, що вже використовувався в сеансах, видалити не можна."
        confirmLabel="Видалити"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

