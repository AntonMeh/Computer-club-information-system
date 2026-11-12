import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const blankForm = (fields) => Object.fromEntries(fields.map((f) => [f.name, ""]));

function buildPayload(fields, form) {
  const payload = {};
  for (const f of fields) {
    const raw = String(form[f.name] ?? "").trim();
    if (raw === "") {
      if (f.required) payload[f.name] = f.type === "number" ? undefined : "";
      continue;
    }
    payload[f.name] = f.type === "number" ? Number(raw) : raw;
  }
  return payload;
}

function formatRemainingPages(remaining) {
  if (remaining <= 0) return "остання сторінка";
  const mod10 = remaining % 10;
  const mod100 = remaining % 100;
  if (mod10 === 1 && mod100 !== 11) return `ще ${remaining} сторінка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `ще ${remaining} сторінки`;
  return `ще ${remaining} сторінок`;
}

export default function ResourcePage({
  title,
  section,
  endpoint,
  idKey,
  nameKey = "name",
  columns,
  fields,
  emptyText,
  addLabel,
  pageSize = 17,
  onChanged,
}) {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = section ? can(section, "full") : true;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(() => blankForm(fields));
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const isDirty = Object.values(form).some((v) => String(v).trim() !== "");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.list(endpoint);
      setRows(Array.isArray(data) ? data : data?.items || []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити дані");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    setPage(1);
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const visibleRows = rows.slice(startIdx, startIdx + pageSize);
  const remainingPages = Math.max(0, totalPages - currentPage);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const openCreateDrawer = () => {
    setForm(blankForm(fields));
    setFormError("");
    setDrawerOpen(true);
  };

  async function onSubmit(e) {
    e.preventDefault();
    setFormError("");

    for (const f of fields) {
      if (f.required && String(form[f.name] ?? "").trim() === "") {
        setFormError(`Заповніть обов'язкове поле «${f.label}»`);
        return;
      }
    }

    setSaving(true);
    try {
      await api.create(endpoint, buildPayload(fields, form));
      setForm(blankForm(fields));
      setDrawerOpen(false);
      toast.success("Запис успішно додано");
      await load();
      setPage(Math.max(1, Math.ceil((rows.length + 1) / pageSize)));
      onChanged?.();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.remove(endpoint, deleteTarget[idKey]);
      toast.success("Запис видалено");
      setDeleteTarget(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>{title}</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreateDrawer}>
            <Plus size={18} aria-hidden="true" />
            <span>{addLabel}</span>
          </button>
        )}
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={columns.length + (canEdit ? 1 : 0)} rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            text={emptyText}
            actionLabel={canEdit ? addLabel : undefined}
            onAction={canEdit ? openCreateDrawer : undefined}
          />
        ) : (
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.numeric ? "num" : undefined}>
                    {c.label}
                  </th>
                ))}
                {canEdit && <th aria-label="Дії" className="actions-col" />}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row[idKey]}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? "num tabular-nums" : undefined}>
                      {c.render ? c.render(row[c.key], row) : row[c.key] ?? "—"}
                    </td>
                  ))}
                  {canEdit && (
                    <td className="actions">
                      <button
                        type="button"
                        className="link-danger"
                        onClick={() => setDeleteTarget(row)}
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

      {!loading && !error && rows.length > 0 && (
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

      <Drawer
        open={drawerOpen}
        title={addLabel}
        isDirty={isDirty}
        onClose={() => setDrawerOpen(false)}
      >
        <form id="resource-create-form" className="stack-form" onSubmit={onSubmit}>
          {fields.map((f) => (
            <div key={f.name} className="field">
              <label htmlFor={`field-${f.name}`} className="field-label">
                {f.label} {f.required && <span className="required-mark">*</span>}
              </label>
              <input
                id={`field-${f.name}`}
                type={f.type === "number" ? "number" : "text"}
                min={f.type === "number" ? 0 : undefined}
                step={f.step}
                required={f.required}
                placeholder={f.placeholder}
                value={form[f.name]}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              />
            </div>
          ))}

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
              {saving ? "Зберігаємо…" : addLabel}
            </button>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget
            ? `Видалити «${deleteTarget[nameKey] || deleteTarget[idKey]}»?`
            : "Видалити запис?"
        }
        message="Цю дію неможливо скасувати."
        confirmLabel="Видалити"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
