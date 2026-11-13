import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Edit2, KeyRound, Plus, Power, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import { Badge, StatusBadge } from "../components/Badge.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDateTime } from "../format.js";

const ROLES = [
  { key: "director", label: "Директор (адміністратор клубу)" },
  { key: "hall_admin", label: "Оператор-адміністратор залу" },
  { key: "accountant", label: "Бухгалтер" },
  { key: "tournaments", label: "Менеджер з турнірів та заходів" },
  { key: "marketing", label: "Менеджер з реклами та маркетингу" },
  { key: "sysadmin", label: "Системний адміністратор" },
];

function generateRandomPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "A1";
  for (let i = 0; i < 8; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export default function UsersPage() {
  const { user: currentUser, clubs } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({
    username: "",
    password: "",
    full_name: "",
    role: "hall_admin",
    club_id: "",
    staff_id: "",
    is_active: true,
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Модальне вікно одноразового показу тимчасового пароля
  const [resetResult, setResetResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uData, sData] = await Promise.all([
        api.get("/users"),
        api.get("/staff").catch(() => []),
      ]);
      setUsers(Array.isArray(uData) ? uData : []);
      setStaffList(Array.isArray(sData) ? sData : []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити користувачів");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingUser(null);
    setForm({
      username: "",
      password: generateRandomPassword(),
      full_name: "",
      role: "hall_admin",
      club_id: String(clubs[0]?.club_id || ""),
      staff_id: "",
      is_active: true,
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (u) => {
    setEditingUser(u);
    setForm({
      username: u.username,
      password: "",
      full_name: u.full_name || "",
      role: u.role,
      club_id: u.club_id != null ? String(u.club_id) : "",
      staff_id: u.staff_id != null ? String(u.staff_id) : "",
      is_active: Boolean(u.is_active),
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const handleStaffSelect = (staffIdStr) => {
    const selectedStaff = staffList.find((s) => String(s.staff_id) === staffIdStr);
    if (selectedStaff) {
      setForm((prev) => ({
        ...prev,
        staff_id: staffIdStr,
        full_name: prev.full_name.trim() ? prev.full_name : selectedStaff.full_name,
        club_id:
          prev.role === "director" && !prev.club_id
            ? ""
            : String(selectedStaff.club_id || prev.club_id),
      }));
    } else {
      setForm((prev) => ({ ...prev, staff_id: "" }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");

    const fullName = form.full_name.trim();
    const role = form.role;
    const clubId = form.club_id ? Number(form.club_id) : null;
    const staffId = form.staff_id ? Number(form.staff_id) : null;

    if (!fullName) {
      setFormError("Вкажіть ПІБ користувача");
      return;
    }
    if (role !== "director" && !clubId) {
      setFormError("Для цієї ролі обов'язково потрібно обрати клуб");
      return;
    }

    setSaving(true);
    try {
      if (editingUser) {
        await api.patch(`/users/${editingUser.user_id}`, {
          full_name: fullName,
          role,
          club_id: clubId,
          staff_id: staffId,
          is_active: form.is_active,
        });
        toast.success(`Обліковий запис «${editingUser.username}» оновлено`);
      } else {
        const username = form.username.trim().toLowerCase();
        const password = form.password;
        if (!username || !password) {
          setFormError("Вкажіть логін і початковий пароль");
          setSaving(false);
          return;
        }
        await api.post("/users", {
          username,
          password,
          full_name: fullName,
          role,
          club_id: clubId,
          staff_id: staffId,
        });
        toast.success(`Користувача «${username}» створено`);
      }
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      const nextActive = !u.is_active;
      await api.patch(`/users/${u.user_id}`, { is_active: nextActive });
      toast.success(
        nextActive
          ? `Обліковий запис «${u.username}» увімкнено`
          : `Обліковий запис «${u.username}» вимкнено`
      );
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleResetPassword = async (u) => {
    try {
      const res = await api.post(`/users/${u.user_id}/reset-password`, {});
      setCopied(false);
      setResetResult(res);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const copyTempPassword = async () => {
    if (!resetResult?.temporary_password) return;
    try {
      await navigator.clipboard.writeText(resetResult.temporary_password);
      setCopied(true);
      toast.info("Тимчасовий пароль скопійовано в буфер обміну");
    } catch {
      toast.error("Не вдалося скопіювати автоматично — виділіть пароль вручну");
    }
  };

  const isEditingSelf = editingUser && currentUser && editingUser.user_id === currentUser.user_id;

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Користувачі</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          <Plus size={18} aria-hidden="true" />
          <span>Додати користувача</span>
        </button>
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <SkeletonTable columns={8} rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : users.length === 0 ? (
          <EmptyState
            text="Користувачів не знайдено."
            actionLabel="Додати користувача"
            onAction={openCreate}
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Логін</th>
                <th>ПІБ</th>
                <th>Роль</th>
                <th>Клуб</th>
                <th>Співробітник</th>
                <th>Статус</th>
                <th>Останній вхід</th>
                <th aria-label="Дії" className="actions-col" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = currentUser?.user_id === u.user_id;
                return (
                  <tr key={u.user_id}>
                    <td className="font-medium">
                      <code>{u.username}</code>
                    </td>
                    <td>{u.full_name}</td>
                    <td>
                      <Badge variant={u.role === "director" ? "info" : "neutral"}>
                        {u.role_label}
                      </Badge>
                    </td>
                    <td>{u.club_name || "Уся мережа"}</td>
                    <td>{u.staff_name || "—"}</td>
                    <td>
                      <div className="badge-stack">
                        <StatusBadge status={u.is_active ? "Активний" : "Вимкнений"} />
                        {u.must_change_password && (
                          <Badge variant="warning">Тимчасовий пароль</Badge>
                        )}
                      </div>
                    </td>
                    <td className="tabular-nums">
                      {u.last_login_at ? formatDateTime(u.last_login_at) : "Ніколи"}
                    </td>
                    <td className="actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title="Згенерувати тимчасовий пароль"
                          onClick={() => handleResetPassword(u)}
                        >
                          <KeyRound size={14} aria-hidden="true" />
                          <span>Скинути пароль</span>
                        </button>

                        <button
                          type="button"
                          className="btn-icon"
                          title="Редагувати"
                          aria-label={`Редагувати ${u.username}`}
                          onClick={() => openEdit(u)}
                        >
                          <Edit2 size={15} />
                        </button>

                        <button
                          type="button"
                          className={`btn-icon ${u.is_active ? "danger-icon" : ""}`}
                          disabled={isSelf}
                          title={
                            isSelf
                              ? "Не можна вимкнути власний обліковий запис"
                              : u.is_active
                                ? "Вимкнути обліковий запис"
                                : "Увімкнути обліковий запис"
                          }
                          aria-label={
                            u.is_active
                              ? `Вимкнути ${u.username}`
                              : `Увімкнути ${u.username}`
                          }
                          onClick={() => toggleActive(u)}
                        >
                          <Power size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Drawer
        open={drawerOpen}
        title={editingUser ? `Редагувати «${editingUser.username}»` : "Новий користувач"}
        onClose={() => setDrawerOpen(false)}
      >
        <form className="stack-form" onSubmit={handleSubmit}>
          {!editingUser && (
            <>
              <div className="field">
                <label htmlFor="user-login" className="field-label">
                  Логін <span className="required-mark">*</span>
                </label>
                <input
                  id="user-login"
                  type="text"
                  maxLength={50}
                  required
                  placeholder="Напр., operator_2"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="user-password" className="field-label">
                  Початковий пароль <span className="required-mark">*</span>
                </label>
                <div className="input-with-btn">
                  <input
                    id="user-password"
                    type="text"
                    required
                    minLength={8}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setForm({ ...form, password: generateRandomPassword() })}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>Згенерувати</span>
                  </button>
                </div>
                <span className="subtle-meta">
                  Щонайменше 8 символів, обов’язково літера та цифра.
                </span>
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="user-staff" className="field-label">
              Прив’язка до співробітника
            </label>
            <select
              id="user-staff"
              value={form.staff_id}
              onChange={(e) => handleStaffSelect(e.target.value)}
            >
              <option value="">— Без прив’язки —</option>
              {staffList.map((s) => (
                <option key={s.staff_id} value={s.staff_id}>
                  {s.full_name} ({s.position})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="user-fullname" className="field-label">
              ПІБ <span className="required-mark">*</span>
            </label>
            <input
              id="user-fullname"
              type="text"
              maxLength={100}
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="user-role" className="field-label">
              Роль <span className="required-mark">*</span>
            </label>
            <select
              id="user-role"
              required
              disabled={Boolean(isEditingSelf)}
              value={form.role}
              onChange={(e) => {
                const nextRole = e.target.value;
                setForm({
                  ...form,
                  role: nextRole,
                  club_id:
                    nextRole === "director"
                      ? ""
                      : form.club_id || String(clubs[0]?.club_id || ""),
                });
              }}
            >
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            {isEditingSelf && (
              <span className="subtle-meta">
                Не можна змінити роль власного облікового запису.
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="user-club" className="field-label">
              Клуб {form.role !== "director" && <span className="required-mark">*</span>}
            </label>
            <select
              id="user-club"
              required={form.role !== "director"}
              value={form.club_id}
              onChange={(e) => setForm({ ...form, club_id: e.target.value })}
            >
              {form.role === "director" ? (
                <option value="">Уся мережа (усі клуби)</option>
              ) : (
                <option value="">Оберіть клуб…</option>
              )}
              {clubs.map((c) => (
                <option key={c.club_id} value={c.club_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {editingUser && (
            <label className="switch-row">
              <input
                type="checkbox"
                disabled={Boolean(isEditingSelf)}
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              <span>Обліковий запис активний</span>
            </label>
          )}

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
              {saving ? "Зберігаємо…" : editingUser ? "Зберегти" : "Створити користувача"}
            </button>
          </div>
        </form>
      </Drawer>

      {/* Модальне вікно з одноразовим тимчасовим паролем */}
      {resetResult && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-pw-title"
          >
            <div>
              <h2 id="reset-pw-title" className="modal-title">
                Тимчасовий пароль згенеровано
              </h2>
              <p className="modal-message">
                Передайте цей пароль користувачу <strong>{resetResult.username}</strong>. Пароль
                показується лише один раз; під час першого входу система попросить його змінити.
              </p>
            </div>

            <div className="temp-password-box">
              <code className="temp-password-code">{resetResult.temporary_password}</code>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={copyTempPassword}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? "Скопійовано" : "Скопіювати"}</span>
              </button>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setResetResult(null)}
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

