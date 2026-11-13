import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Edit2, Plus, Search, Trash2, X } from "lucide-react";
import { api } from "../api.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatDateTime, formatMoney, formatPhone } from "../format.js";

const PAGE_SIZE = 17;

const CLIENT_FILTERS = [
  { key: "", label: "Усі" },
  { key: "with_bonus", label: "З бонусами" },
  { key: "new_30d", label: "Нові за 30 днів" },
  { key: "inactive_30d", label: "Без візитів понад 30 днів" },
];

const BLANK = { full_name: "", phone: "", email: "" };

function formatRemainingPages(remaining) {
  if (remaining <= 0) return "остання сторінка";
  const mod10 = remaining % 10;
  const mod100 = remaining % 100;
  if (mod10 === 1 && mod100 !== 11) return `ще ${remaining} сторінка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `ще ${remaining} сторінки`;
  return `ще ${remaining} сторінок`;
}

export default function ClientsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can("clients", "full");

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [page, setPage] = useState(1);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (activeFilter) params.set("filter", activeFilter);
      const qs = params.toString();
      const data = await api.get(`/clients${qs ? `?${qs}` : ""}`);
      setClients(Array.isArray(data) ? data : data?.items || []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити клієнтів");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, activeFilter]);

  useEffect(() => {
    setPage(1);
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(clients.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const visibleClients = clients.slice(startIdx, startIdx + PAGE_SIZE);
  const remainingPages = Math.max(0, totalPages - currentPage);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const openCreate = () => {
    setEditingClient(null);
    setForm(BLANK);
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (client) => {
    setEditingClient(client);
    setForm({
      full_name: client.full_name || "",
      phone: client.phone || "",
      email: client.email || "",
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const isDirty = editingClient
    ? form.full_name !== editingClient.full_name ||
      form.phone !== editingClient.phone ||
      (form.email || "") !== (editingClient.email || "")
    : Boolean(form.full_name.trim() || form.phone.trim() || form.email.trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const fullName = form.full_name.trim();
    const phone = form.phone.trim();
    const email = form.email.trim() || null;

    if (!fullName || !phone) {
      setFormError("Заповніть ПІБ і номер телефону клієнта");
      return;
    }

    setSaving(true);
    try {
      if (editingClient) {
        await api.patch(`/clients/${editingClient.client_id}`, {
          full_name: fullName,
          phone,
          email,
        });
        toast.success(`Дані клієнта «${fullName}» оновлено`);
      } else {
        await api.post("/clients", {
          full_name: fullName,
          phone,
          email,
        });
        toast.success(`Клієнта «${fullName}» зареєстровано`);
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
      await api.remove("/clients", deleteTarget.client_id);
      toast.success(`Клієнта «${deleteTarget.full_name}» видалено`);
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
        <h1>Клієнти</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <Plus size={18} aria-hidden="true" />
            <span>Новий клієнт</span>
          </button>
        )}
      </div>

      <div className="filters-bar">
        <div className="search-input-wrap">
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            placeholder="Пошук за ПІБ, телефоном або email…"
            aria-label="Пошук клієнтів"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className="search-clear"
              aria-label="Очистити пошук"
              onClick={() => setSearchInput("")}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="chip-group" role="group" aria-label="Фільтр клієнтів">
          {CLIENT_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`filter-chip ${activeFilter === f.key ? "active" : ""}`}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={9} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : clients.length === 0 ? (
          <EmptyState
            text={
              debouncedQuery || activeFilter
                ? "За вашим запитом клієнтів не знайдено."
                : "Клієнтів ще немає. Додайте першого клієнта."
            }
            actionLabel={canEdit && !debouncedQuery && !activeFilter ? "Новий клієнт" : undefined}
            onAction={canEdit && !debouncedQuery && !activeFilter ? openCreate : undefined}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>ПІБ</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Реєстрація</th>
                <th className="num">Бонуси</th>
                <th className="num">Сеансів</th>
                <th className="num">Витрачено</th>
                <th>Останній візит</th>
                {canEdit && <th aria-label="Дії" className="actions-col" />}
              </tr>
            </thead>
            <tbody>
              {visibleClients.map((c) => (
                <tr key={c.client_id}>
                  <td>
                    <Link to={`/clients/${c.client_id}`} className="table-link font-medium">
                      {c.full_name}
                    </Link>
                  </td>
                  <td className="tabular-nums">{formatPhone(c.phone)}</td>
                  <td>{c.email || "—"}</td>
                  <td className="tabular-nums">{formatDate(c.reg_date)}</td>
                  <td className="num tabular-nums">{formatMoney(c.bonus_balance)}</td>
                  <td className="num tabular-nums">{c.sessions_count ?? 0}</td>
                  <td className="num tabular-nums font-medium">
                    {formatMoney(c.total_spent ?? 0)}
                  </td>
                  <td className="tabular-nums">
                    {c.last_visit ? formatDateTime(c.last_visit) : "—"}
                  </td>
                  {canEdit && (
                    <td className="actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          title="Редагувати"
                          aria-label={`Редагувати ${c.full_name}`}
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

      {!loading && !error && clients.length > 0 && (
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
        title={editingClient ? "Редагувати клієнта" : "Новий клієнт"}
        isDirty={isDirty}
        onClose={() => setDrawerOpen(false)}
      >
        <form className="stack-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="client-name" className="field-label">
              ПІБ <span className="required-mark">*</span>
            </label>
            <input
              id="client-name"
              type="text"
              maxLength={100}
              required
              placeholder="Напр., Мельник Андрій Сергійович"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="client-phone" className="field-label">
              Телефон <span className="required-mark">*</span>
            </label>
            <input
              id="client-phone"
              type="text"
              maxLength={20}
              required
              placeholder="+380670000001"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="client-email" className="field-label">
              Email
            </label>
            <input
              id="client-email"
              type="email"
              maxLength={100}
              placeholder="client@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
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
              {saving ? "Зберігаємо…" : editingClient ? "Зберегти" : "Додати клієнта"}
            </button>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget
            ? `Видалити клієнта «${deleteTarget.full_name}»?`
            : "Видалити клієнта?"
        }
        message="Клієнта з історією сеансів або участю в турнірах видалити не можна."
        confirmLabel="Видалити"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

