import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Cpu,
  Crosshair,
  Eye,
  EyeOff,
  Gamepad2,
  HardDrive,
  Headphones,
  Keyboard,
  Monitor,
  Moon,
  Mouse,
  ShieldCheck,
  Sun,
  Trophy,
  Tv,
  Wifi,
  Zap,
} from "lucide-react";
import { getToken } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

const DEMO_ACCOUNTS = [
  { username: "director", label: "Директор", hint: "Уся мережа" },
  { username: "hall_admin", label: "Адмін залу", hint: "Зал і зміна" },
  { username: "accountant", label: "Бухгалтер", hint: "Каса і Z-звіти" },
  { username: "tournaments", label: "Турніри", hint: "Події та сітки" },
  { username: "marketing", label: "Реклама", hint: "Аналітика" },
  { username: "sysadmin", label: "Сисадмін", hint: "Робочі місця" },
];

/**
 * Елементи обладнання та ігрової периферії, що плавно дрейфують на фоні сторінки входу.
 */
const FLOATING_ITEMS = [
  {
    id: "gpu",
    icon: Cpu,
    tag: "RTX 4080 Super · 16 GB",
    sub: "GPU Core 2550 MHz",
    x: "6%",
    y: "12%",
    duration: "22s",
    delay: "0s",
    scale: 1.05,
    path: "float-orbit-a",
  },
  {
    id: "monitor",
    icon: Monitor,
    tag: "ASUS ROG 360 Hz",
    sub: "27\" IPS · 0.5 ms",
    x: "76%",
    y: "10%",
    duration: "26s",
    delay: "-4s",
    scale: 1.1,
    path: "float-orbit-b",
  },
  {
    id: "gamepad",
    icon: Gamepad2,
    tag: "DualSense Edge",
    sub: "PlayStation 5 Lounge",
    x: "82%",
    y: "68%",
    duration: "24s",
    delay: "-9s",
    scale: 1.08,
    path: "float-orbit-c",
  },
  {
    id: "headset",
    icon: Headphones,
    tag: "HyperX Cloud III",
    sub: "DTS Spatial Audio",
    x: "8%",
    y: "72%",
    duration: "25s",
    delay: "-6s",
    scale: 1.0,
    path: "float-orbit-b",
  },
  {
    id: "keyboard",
    icon: Keyboard,
    tag: "Wooting 60HE+",
    sub: "Rapid Trigger 0.1 mm",
    x: "16%",
    y: "42%",
    duration: "28s",
    delay: "-12s",
    scale: 0.96,
    path: "float-orbit-c",
  },
  {
    id: "mouse",
    icon: Mouse,
    tag: "G Pro X Superlight 2",
    sub: "4000 Hz Polling",
    x: "72%",
    y: "38%",
    duration: "21s",
    delay: "-3s",
    scale: 0.95,
    path: "float-orbit-a",
  },
  {
    id: "trophy",
    icon: Trophy,
    tag: "CS2 Cyberion Cup",
    sub: "5v5 LAN Arena",
    x: "42%",
    y: "8%",
    duration: "27s",
    delay: "-14s",
    scale: 0.92,
    path: "float-orbit-b",
  },
  {
    id: "crosshair",
    icon: Crosshair,
    tag: "Tickrate 128 · 4 ms",
    sub: "Dedicated Fiber Line",
    x: "48%",
    y: "84%",
    duration: "23s",
    delay: "-8s",
    scale: 0.92,
    path: "float-orbit-a",
  },
  {
    id: "nvme",
    icon: HardDrive,
    tag: "NVMe PCIe 4.0 · 4 TB",
    sub: "7400 MB/s Read",
    x: "28%",
    y: "80%",
    duration: "29s",
    delay: "-16s",
    scale: 0.9,
    path: "float-orbit-c",
  },
  {
    id: "tv",
    icon: Tv,
    tag: "OLED 65\" 4K 120 Hz",
    sub: "Console Zone № 08",
    x: "64%",
    y: "82%",
    duration: "24s",
    delay: "-11s",
    scale: 0.92,
    path: "float-orbit-b",
  },
];

const KEYCAPS = ["W", "A", "S", "D", "ESC", "F12"];

export default function LoginPage() {
  const { user, login, theme, toggleTheme } = useAuth();
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
      {/* Живий інженерно-ігровий фон із літаючими елементами периферії та комплектуючих */}
      <div className="login-bg-stage" aria-hidden="true">
        <div className="login-bg-grid" />

        {/* Декоративні векторні схеми (кулер GPU, приціл та клавіші WASD) */}
        <svg className="login-bg-blueprint blueprint-left" viewBox="0 0 260 260" fill="none">
          <circle cx="130" cy="130" r="108" stroke="currentColor" strokeWidth="1" strokeDasharray="6 6" />
          <circle cx="130" cy="130" r="76" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="130" cy="130" r="24" stroke="currentColor" strokeWidth="1.5" />
          <path d="M130 22 V62 M130 198 V238 M22 130 H62 M198 130 H238" stroke="currentColor" strokeWidth="1.2" />
          <path d="M54 54 L84 84 M176 176 L206 206 M206 54 L176 84 M84 176 L54 206" stroke="currentColor" strokeWidth="1" />
        </svg>

        <svg className="login-bg-blueprint blueprint-right" viewBox="0 0 280 280" fill="none">
          <rect x="28" y="52" width="224" height="140" rx="14" stroke="currentColor" strokeWidth="1.2" />
          <rect x="44" y="68" width="192" height="108" rx="6" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
          <path d="M110 192 L96 226 H184 L170 192" stroke="currentColor" strokeWidth="1.2" />
          <line x1="76" y1="226" x2="204" y2="226" stroke="currentColor" strokeWidth="1.5" />
        </svg>

        {/* Літаючі картки комп'ютерних комплектуючих та ігрових девайсів */}
        {FLOATING_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className={`login-floating-node ${item.path}`}
              style={{
                left: item.x,
                top: item.y,
                animationDuration: item.duration,
                animationDelay: item.delay,
                "--node-scale": item.scale,
              }}
            >
              <div className="login-floating-icon">
                <Icon size={18} strokeWidth={1.6} />
              </div>
              <div className="login-floating-meta">
                <span className="login-floating-tag tabular-nums">{item.tag}</span>
                <span className="login-floating-sub tabular-nums">{item.sub}</span>
              </div>
            </div>
          );
        })}

        {/* Плаваючі механічні клавіші (Keycaps) */}
        <div className="login-floating-keycaps">
          {KEYCAPS.map((key, idx) => (
            <span
              key={key}
              className="login-keycap tabular-nums"
              style={{ animationDelay: `${idx * -2.2}s` }}
            >
              {key}
            </span>
          ))}
        </div>
      </div>

      {/* Верхня панель перемикання теми на сторінці логіну */}
      <div className="login-topbar">
        <div className="login-status-pill tabular-nums">
          <span className="live-dot" />
          <span>Cyberion Control · Телеметрія залу активна</span>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm login-theme-btn"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Увімкнути світлу тему" : "Увімкнути темну тему"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === "dark" ? "Світла тема" : "Темна тема"}</span>
        </button>
      </div>

      {/* Основний контейнер входу */}
      <div className="login-shell">
        <div className="login-showcase-panel">
          <div className="login-brand-row">
            <span className="brand-mark lg">
              <Monitor size={18} />
            </span>
            <div>
              <div className="login-brand-name">Клубна система</div>
              <div className="login-brand-sub">Управління кіберспортивними клубами</div>
            </div>
          </div>

          <h2 className="login-hero-heading">
            Контроль залу, касових змін та аналітики в одному вікні
          </h2>
          <p className="login-hero-copy">
            Посадка гравців за 3 кліки, жива тарифікація ПК і консолей PlayStation 5, фіскальні Z-звіти змін та наскрізний фінансовий облік мережі.
          </p>

          {/* Жива вітрина телеметрії обладнання */}
          <div className="login-telemetry-grid">
            <div className="login-telemetry-card">
              <div className="login-telemetry-top">
                <Cpu size={15} />
                <span className="tabular-nums">VIP Zone · RTX 4080</span>
              </div>
              <div className="login-telemetry-val tabular-nums">240–360 Hz</div>
              <div className="login-telemetry-sub">Моніторинг сеансів у реальному часі</div>
            </div>

            <div className="login-telemetry-card">
              <div className="login-telemetry-top">
                <ShieldCheck size={15} />
                <span className="tabular-nums">Каса та Z-звіти</span>
              </div>
              <div className="login-telemetry-val tabular-nums">100% контроль</div>
              <div className="login-telemetry-sub">Формула шухляди, інкасація та звірка</div>
            </div>

            <div className="login-telemetry-card">
              <div className="login-telemetry-top">
                <Wifi size={15} />
                <span className="tabular-nums">Мережа філій</span>
              </div>
              <div className="login-telemetry-val tabular-nums">6 ролей доступу</div>
              <div className="login-telemetry-sub">Від адміністратора залу до бухгалтера</div>
            </div>
          </div>
        </div>

        <div className="login-card">
          <div className="login-header">
            <div className="login-card-badge">
              <Zap size={13} />
              <span>Авторизація персоналу</span>
            </div>
            <h1 className="login-title">Вхід у систему</h1>
            <p className="login-subtitle">
              Введіть облікові дані співробітника або оберіть демо-профіль нижче
            </p>
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
                placeholder="Наприклад: director або hall_admin"
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
                  placeholder="••••••••"
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

            <button
              type="submit"
              className="btn btn-primary btn-block login-submit-btn"
              disabled={submitting}
            >
              {submitting ? "Входимо…" : "Увійти в робочий простір"}
            </button>
          </form>

          <div className="demo-accounts">
            <div className="demo-accounts-header">
              <span className="demo-accounts-title">Швидкий вхід (пароль: demo1234)</span>
            </div>
            <div className="demo-chips-grid">
              {DEMO_ACCOUNTS.map((acc) => {
                const isSelected = username === acc.username;
                return (
                  <button
                    key={acc.username}
                    type="button"
                    className={`demo-chip-card ${isSelected ? "active" : ""}`}
                    onClick={() => fillDemo(acc.username)}
                  >
                    <span className="demo-chip-role">{acc.label}</span>
                    <span className="demo-chip-hint">{acc.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
