import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Edit2, GitBranch, List, Plus, Trash2, UserPlus, Wallet } from "lucide-react";
import { api } from "../api.js";
import { Badge } from "../components/Badge.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import { EmptyState, ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatMoney } from "../format.js";

const STAFF_POSITIONS = [
  "Директор клубу",
  "Заступник директора (адміністратор клубу)",
  "Оператор-адміністратор залу",
  "Технічний персонал",
  "Бухгалтер",
  "Системний адміністратор",
  "Менеджер з реклами та маркетингу",
  "Менеджер з організації турнірів та заходів",
];

const DEFAULT_RATES = {
  "Директор клубу": "280.00",
  "Заступник директора (адміністратор клубу)": "220.00",
  "Оператор-адміністратор залу": "165.00",
  "Технічний персонал": "135.00",
  "Бухгалтер": "210.00",
  "Системний адміністратор": "200.00",
  "Менеджер з реклами та маркетингу": "175.00",
  "Менеджер з організації турнірів та заходів": "180.00",
};

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatTenure(hireDateStr) {
  if (!hireDateStr) return "—";
  const hire = new Date(hireDateStr);
  if (Number.isNaN(hire.getTime())) return "—";
  const now = new Date();
  let months =
    (now.getFullYear() - hire.getFullYear()) * 12 + (now.getMonth() - hire.getMonth());
  if (now.getDate() < hire.getDate()) {
    months -= 1;
  }
  if (months <= 0) return "< 1 міс.";
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years === 0) return `${remMonths} міс.`;
  if (remMonths === 0) return `${years} р.`;
  return `${years} р. ${remMonths} міс.`;
}

export default function StaffPage() {
  const { can, clubs, selectedClubId } = useAuth();
  const toast = useToast();
  const canEdit = can("staff", "full");

  const [activeTab, setActiveTab] = useState("list"); // "list" | "org"
  const [positionFilter, setPositionFilter] = useState("");

  const [staff, setStaff] = useState([]);
  const [orgNodes, setOrgNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [form, setForm] = useState({
    full_name: "",
    position: STAFF_POSITIONS[2],
    club_id: "",
    hire_date: todayIso(),
    hourly_rate: DEFAULT_RATES[STAFF_POSITIONS[2]],
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const defaultClubId = selectedClubId || clubs[0]?.club_id || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedClubId) params.set("club_id", String(selectedClubId));
      if (positionFilter && activeTab === "list") params.set("position", positionFilter);
      const qs = params.toString();

      const orgParams = new URLSearchParams();
      if (selectedClubId) orgParams.set("club_id", String(selectedClubId));
      const orgQs = orgParams.toString();

      const [staffData, orgData] = await Promise.all([
        api.get(`/staff${qs ? `?${qs}` : ""}`),
        api.get(`/staff/org-chart${orgQs ? `?${orgQs}` : ""}`),
      ]);
      setStaff(Array.isArray(staffData) ? staffData : []);
      setOrgNodes(Array.isArray(orgData) ? orgData : []);
      setError("");
    } catch (e) {
      setError(e.message || "Не вдалося завантажити співробітників");
    } finally {
      setLoading(false);
    }
  }, [selectedClubId, positionFilter, activeTab]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = (presetPosition = STAFF_POSITIONS[2]) => {
    setEditingMember(null);
    setForm({
      full_name: "",
      position: presetPosition,
      club_id: String(defaultClubId),
      hire_date: todayIso(),
      hourly_rate: DEFAULT_RATES[presetPosition] || "160.00",
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const openEdit = (member) => {
    setEditingMember(member);
    setForm({
      full_name: member.full_name || "",
      position: member.position || STAFF_POSITIONS[2],
      club_id: String(member.club_id || defaultClubId),
      hire_date: member.hire_date || todayIso(),
      hourly_rate: String(
        Number(
          member.hourly_rate ?? DEFAULT_RATES[member.position] ?? 160
        ).toFixed(2)
      ),
    });
    setFormError("");
    setDrawerOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const fullName = form.full_name.trim();
    const clubId = Number(form.club_id);
    const rateNum = Number(form.hourly_rate || 160);
    if (!fullName || !clubId || !form.position || !rateNum || rateNum <= 0) {
      setFormError("Заповніть ПІБ, посаду, клуб та коректну погодинну ставку");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        full_name: fullName,
        position: form.position,
        club_id: clubId,
        hire_date: form.hire_date || null,
        hourly_rate: Number(rateNum.toFixed(2)),
      };
      if (editingMember) {
        await api.patch(`/staff/${editingMember.staff_id}`, payload);
        toast.success(`Дані «${fullName}» оновлено`);
      } else {
        await api.post("/staff", payload);
        toast.success(`Співробітника «${fullName}» додано`);
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
      await api.remove("/staff", deleteTarget.staff_id);
      toast.success(`Співробітника «${deleteTarget.full_name}» видалено`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err.message);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const nodeByKey = Object.fromEntries(orgNodes.map((n) => [n.key, n]));
  const directorNode = nodeByKey.director;
  const directBranches = orgNodes.filter((n) => n.parent_key === "director");
  const deputyChildren = orgNodes.filter((n) => n.parent_key === "deputy");

  const renderOrgCard = (node) => {
    if (!node) return null;
    return (
      <div
        key={node.key}
        className={`org-node-card ${node.is_vacant ? "vacant" : ""}`}
      >
        <div className="org-node-header">
          <span className="org-node-position">{node.position}</span>
          {node.is_vacant ? (
            <Badge variant="warning">Вакансія</Badge>
          ) : (
            <Badge variant="neutral">{node.members.length}</Badge>
          )}
        </div>

        {node.is_vacant ? (
          <div className="org-vacant-body">
            <span className="subtle-meta">Посада наразі вільна</span>
            {canEdit && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => openCreate(node.position)}
              >
                <UserPlus size={14} aria-hidden="true" />
                <span>Призначити</span>
              </button>
            )}
          </div>
        ) : (
          <ul className="org-member-list">
            {node.members.map((m) => (
              <li key={m.staff_id} className="org-member-item">
                <div className="org-member-name">{m.full_name}</div>
                <div className="org-member-meta tabular-nums">
                  {!selectedClubId && m.club_name && <span>{m.club_name} · </span>}
                  <span>{formatMoney(m.hourly_rate)}/год · з {formatDate(m.hire_date)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Співробітники</h1>
        <div className="header-actions">
          <div className="tabs-bar" role="tablist" aria-label="Режим перегляду">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "list"}
              className={`tab-btn ${activeTab === "list" ? "active" : ""}`}
              onClick={() => setActiveTab("list")}
            >
              <List size={16} aria-hidden="true" />
              <span>Список</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "org"}
              className={`tab-btn ${activeTab === "org" ? "active" : ""}`}
              onClick={() => setActiveTab("org")}
            >
              <GitBranch size={16} aria-hidden="true" />
              <span>Оргструктура</span>
            </button>
          </div>

          {can("cash", "view") && (
            <Link to="/payroll" className="btn btn-secondary">
              <Wallet size={16} aria-hidden="true" />
              <span>Зарплата і табель</span>
            </Link>
          )}

          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => openCreate()}>
              <Plus size={18} aria-hidden="true" />
              <span>Додати співробітника</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === "list" && (
        <>
          <div className="filters-bar">
            <div className="field-inline">
              <label htmlFor="staff-pos-filter" className="subtle-meta">
                Посада:
              </label>
              <select
                id="staff-pos-filter"
                className="select-compact"
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
              >
                <option value="">Усі посади</option>
                {STAFF_POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="panel table-wrap">
            {loading ? (
              <SkeletonTable columns={6} rows={6} />
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : staff.length === 0 ? (
              <EmptyState
                text="Співробітників за обраними критеріями не знайдено."
                actionLabel={canEdit ? "Додати співробітника" : undefined}
                onAction={canEdit ? () => openCreate() : undefined}
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ПІБ</th>
                    <th>Посада</th>
                    <th>Клуб</th>
                    <th className="num">Ставка / год</th>
                    <th>Прийнятий</th>
                    <th>Стаж</th>
                    {canEdit && <th aria-label="Дії" className="actions-col" />}
                  </tr>
                </thead>
                <tbody>
                  {staff.map((m) => (
                    <tr key={m.staff_id}>
                      <td className="font-medium">{m.full_name}</td>
                      <td>{m.position}</td>
                      <td>{m.club_name || `Клуб № ${m.club_id}`}</td>
                      <td className="num tabular-nums font-medium accent-text">
                        {formatMoney(m.hourly_rate)}
                      </td>
                      <td className="tabular-nums">{formatDate(m.hire_date)}</td>
                      <td className="tabular-nums">{formatTenure(m.hire_date)}</td>
                      {canEdit && (
                        <td className="actions">
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn-icon"
                              title="Редагувати"
                              aria-label={`Редагувати ${m.full_name}`}
                              onClick={() => openEdit(m)}
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              type="button"
                              className="link-danger"
                              onClick={() => setDeleteTarget(m)}
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
        </>
      )}

      {activeTab === "org" && (
        <div className="panel org-panel">
          {loading ? (
            <SkeletonTable columns={3} rows={4} />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : (
            <div className="org-tree">
              <div className="org-level org-level-top">
                {renderOrgCard(directorNode)}
              </div>

              <div className="org-connector-vertical" aria-hidden="true" />

              <div className="org-branches-grid">
                {directBranches.map((branch) => (
                  <div key={branch.key} className="org-branch-col">
                    {renderOrgCard(branch)}

                    {branch.key === "deputy" && deputyChildren.length > 0 && (
                      <>
                        <div className="org-connector-vertical sm" aria-hidden="true" />
                        <div className="org-subbranches">
                          {deputyChildren.map((sub) => renderOrgCard(sub))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Drawer
        open={drawerOpen}
        title={editingMember ? "Редагувати співробітника" : "Додати співробітника"}
        onClose={() => setDrawerOpen(false)}
      >
        <form className="stack-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="staff-name" className="field-label">
              ПІБ <span className="required-mark">*</span>
            </label>
            <input
              id="staff-name"
              type="text"
              maxLength={100}
              required
              placeholder="Напр., Коваленко Олександр Ігорович"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="staff-position" className="field-label">
              Посада <span className="required-mark">*</span>
            </label>
            <select
              id="staff-position"
              required
              value={form.position}
              onChange={(e) => {
                const nextPos = e.target.value;
                setForm({
                  ...form,
                  position: nextPos,
                  hourly_rate: editingMember
                    ? form.hourly_rate
                    : DEFAULT_RATES[nextPos] || form.hourly_rate,
                });
              }}
            >
              {STAFF_POSITIONS.map((pos) => (
                <option key={pos} value={pos}>
                  {pos}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="staff-rate" className="field-label">
              Погодинна ставка (₴ / год) <span className="required-mark">*</span>
            </label>
            <input
              id="staff-rate"
              type="number"
              step="5"
              min="10"
              required
              className="tabular-nums"
              value={form.hourly_rate}
              onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="staff-club" className="field-label">
              Клуб <span className="required-mark">*</span>
            </label>
            <select
              id="staff-club"
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
            <label htmlFor="staff-hire-date" className="field-label">
              Дата прийняття <span className="required-mark">*</span>
            </label>
            <input
              id="staff-hire-date"
              type="date"
              required
              value={form.hire_date}
              onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
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
              {saving ? "Зберігаємо…" : editingMember ? "Зберегти" : "Додати співробітника"}
            </button>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget
            ? `Видалити співробітника «${deleteTarget.full_name}»?`
            : "Видалити співробітника?"
        }
        message="Запис співробітника буде видалено. Якщо до нього був прив'язаний обліковий запис, прив'язку буде знято."
        confirmLabel="Видалити"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

