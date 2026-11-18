import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Moon, Shield, Sun } from "lucide-react";
import { api } from "../api.js";
import { Badge } from "../components/Badge.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProfilePage() {
  const {
    user,
    logout,
    refreshUser,
    compactTables,
    setCompactTables,
    theme,
    setTheme,
  } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Заповніть усі поля зміни пароля");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Новий пароль і повтор не збігаються");
      return;
    }
    if (newPassword.length < 8 || !/\p{L}/u.test(newPassword) || !/\d/.test(newPassword)) {
      setError("Пароль має містити щонайменше 8 символів, літеру й цифру");
      return;
    }

    setSaving(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refreshUser();
      toast.success("Пароль успішно змінено");
    } catch (err) {
      setError(err.message || "Не вдалося змінити пароль");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <section className="page-section">
      <div className="page-header">
        <h1>Профіль</h1>
        <button type="button" className="btn btn-secondary" onClick={handleLogout}>
          <LogOut size={16} aria-hidden="true" />
          <span>Вийти</span>
        </button>
      </div>

      {user?.must_change_password && (
        <div className="alert alert-warning" role="alert">
          Для продовження роботи необхідно змінити тимчасовий пароль.
        </div>
      )}

      <div className="profile-grid">
        <div className="panel">
          <h2 className="section-title">Обліковий запис</h2>
          <dl className="desc-list">
            <div className="desc-row">
              <dt>ПІБ</dt>
              <dd>{user?.full_name}</dd>
            </div>
            <div className="desc-row">
              <dt>Логін</dt>
              <dd>{user?.username}</dd>
            </div>
            <div className="desc-row">
              <dt>Роль</dt>
              <dd>
                <Badge variant="info" icon={Shield}>
                  {user?.role_label}
                </Badge>
              </dd>
            </div>
            <div className="desc-row">
              <dt>Клуб</dt>
              <dd>{user?.club_id ? user.club_name || `Клуб № ${user.club_id}` : "Уся мережа"}</dd>
            </div>
          </dl>

          <hr className="divider" />

          <h3 className="subsection-title">Налаштування відображення</h3>
          <div className="stack-form">
            <div className="field">
              <span className="field-label">Тема інтерфейсу</span>
              <div className="tabs-bar" role="group" aria-label="Вибір теми інтерфейсу">
                <button
                  type="button"
                  className={`tab-btn ${theme === "light" ? "active" : ""}`}
                  onClick={() => setTheme("light")}
                >
                  <Sun size={14} aria-hidden="true" />
                  <span>Світла тема</span>
                </button>
                <button
                  type="button"
                  className={`tab-btn ${theme === "dark" ? "active" : ""}`}
                  onClick={() => setTheme("dark")}
                >
                  <Moon size={14} aria-hidden="true" />
                  <span>Темна тема</span>
                </button>
              </div>
            </div>

            <label className="switch-row">
              <input
                type="checkbox"
                checked={compactTables}
                onChange={(e) => setCompactTables(e.target.checked)}
              />
              <span>Компактні таблиці (висота рядка 36 px)</span>
            </label>
          </div>
        </div>

        <div className="panel">
          <h2 className="section-title">Змінити пароль</h2>
          <form onSubmit={handlePasswordChange} className="stack-form" noValidate>
            <div className="field">
              <label htmlFor="prof-current-pw" className="field-label">
                Поточний пароль <span className="required-mark">*</span>
              </label>
              <input
                id="prof-current-pw"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="prof-new-pw" className="field-label">
                Новий пароль <span className="required-mark">*</span>
              </label>
              <input
                id="prof-new-pw"
                type="password"
                autoComplete="new-password"
                required
                placeholder="Мінімум 8 символів, літера й цифра"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="prof-confirm-pw" className="field-label">
                Повтор нового пароля <span className="required-mark">*</span>
              </label>
              <input
                id="prof-confirm-pw"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}

            <div>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Зберігаємо…" : "Змінити пароль"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

