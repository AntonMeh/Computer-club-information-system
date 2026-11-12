import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { getToken } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

const DEMO_ACCOUNTS = [
  { username: "director", label: "Директор" },
  { username: "hall_admin", label: "Адмін залу" },
  { username: "accountant", label: "Бухгалтер" },
  { username: "tournaments", label: "Турніри" },
  { username: "marketing", label: "Реклама" },
  { username: "sysadmin", label: "Сисадмін" },
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const usernameRef = useRef(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const redirectTo = location.state?.from || "/";

  if (user && getToken()) {
    return <Navigate to={user.must_change_password ? "/profile" : redirectTo} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Введіть логін і пароль");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const loggedUser = await login(username.trim(), password);
      if (loggedUser.must_change_password) {
        navigate("/profile", { replace: true });
      } else {
        navigate(redirectTo, { replace: true });
      }
    } catch (err) {
      setError(err.message || "Невірний логін або пароль");
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (demoUsername) => {
    setUsername(demoUsername);
    setPassword("demo1234");
    setError("");
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-title">Клубна система</h1>
          <p className="login-subtitle">Вхід для співробітників</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="field">
            <label htmlFor="login-username" className="field-label">
              Логін <span className="required-mark">*</span>
            </label>
            <input
              ref={usernameRef}
              id="login-username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>

          <div className="field">
            <label htmlFor="login-password" className="field-label">
              Пароль <span className="required-mark">*</span>
            </label>
            <div className="password-input-wrap">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(error)}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Сховати пароль" : "Показати пароль"}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? "Входимо…" : "Увійти"}
          </button>
        </form>

        <div className="demo-accounts">
          <span className="demo-accounts-title">Демо-облікові записи (пароль demo1234):</span>
          <div className="demo-chips">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.username}
                type="button"
                className="demo-chip"
                onClick={() => fillDemo(acc.username)}
              >
                {acc.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

