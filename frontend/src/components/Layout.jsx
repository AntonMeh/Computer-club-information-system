import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  ChevronDown,
  Clock,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  PcCase,
  Receipt,
  ShieldCheck,
  Tags,
  Trophy,
  User,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDateTime } from "../format.js";

export const NAV_GROUPS = [
  {
    title: "робота",
    items: [
      { to: "/", section: "dashboard", label: "Огляд", icon: LayoutDashboard, end: true },
      { to: "/hall", section: "hall", label: "Зал", icon: Monitor },
      { to: "/sessions", section: "sessions", label: "Сеанси", icon: Clock },
    ],
  },
  {
    title: "довідники",
    items: [
      { to: "/clients", section: "clients", label: "Клієнти", icon: Users },
      { to: "/tariffs", section: "tariffs", label: "Тарифи", icon: Tags },
      { to: "/workstations", section: "workstations", label: "Робочі місця", icon: PcCase },
    ],
  },
  {
    title: "фінанси",
    items: [
      { to: "/payments", section: "payments", label: "Оплати", icon: CreditCard },
      { to: "/expenses", section: "expenses", label: "Витрати", icon: Receipt },
      { to: "/reports", section: "reports", label: "Звіти", icon: BarChart3 },
    ],
  },
  {
    title: "події",
    items: [{ to: "/tournaments", section: "tournaments", label: "Турніри", icon: Trophy }],
  },
  {
    title: "адміністрування",
    items: [
      { to: "/clubs", section: "clubs", label: "Клуби", icon: Building2 },
      { to: "/staff", section: "staff", label: "Співробітники", icon: UserCog },
      { to: "/users", section: "users", label: "Користувачі", icon: ShieldCheck },
    ],
  },
];

const PAGE_TITLES = {
  "/": "Огляд",
  "/hall": "Зал",
  "/sessions": "Сеанси",
  "/clients": "Клієнти",
  "/tariffs": "Тарифи",
  "/workstations": "Робочі місця",
  "/payments": "Оплати",
  "/expenses": "Витрати",
  "/reports": "Звіти",
  "/tournaments": "Турніри",
  "/clubs": "Клуби",
  "/staff": "Співробітники",
  "/users": "Користувачі",
  "/profile": "Профіль",
};

function resolveTitle(pathname) {
  if (PAGE_TITLES[pathname]) return { title: PAGE_TITLES[pathname], parent: null };
  if (pathname.startsWith("/clients/")) {
    return { title: "Картка клієнта", parent: { to: "/clients", label: "Клієнти" } };
  }
  if (pathname.startsWith("/tournaments/")) {
    return { title: "Картка турніру", parent: { to: "/tournaments", label: "Турніри" } };
  }
  return { title: "Клубна система", parent: null };
}

export default function Layout() {
  const { user, can, logout, clubs, selectedClubId, setSelectedClubId } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [apiOk, setApiOk] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    let active = true;
    const check = () => {
      api
        .health()
        .then(() => active && setApiOk(true))
        .catch(() => active && setApiOk(false));
    };
    check();
    const timer = setInterval(check, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // Поточна дата й час у шапці оновлюється щохвилини
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, [userMenuOpen]);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(item.section, "view")),
  })).filter((group) => group.items.length > 0);

  const { title, parent } = resolveTitle(location.pathname);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="shell">
      {mobileNavOpen && (
        <div
          className="mobile-backdrop"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <Link to="/" className="brand">
            Клубна система
          </Link>
          <button
            type="button"
            className="mobile-close-btn"
            aria-label="Закрити меню"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Розділи системи">
          {visibleGroups.map((group) => (
            <div key={group.title} className="nav-group">
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <p className={`api-status ${apiOk === false ? "down" : apiOk ? "up" : ""}`}>
          <span className="nav-label">
            {apiOk === null ? "Перевірка API…" : apiOk ? "API підключено" : "API недоступне"}
          </span>
        </p>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="hamburger-btn"
              aria-label="Відкрити меню"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumbs">
              {parent ? (
                <>
                  <Link to={parent.to} className="breadcrumb-parent">
                    {parent.label}
                  </Link>
                  <span className="breadcrumb-sep" aria-hidden="true">
                    ›
                  </span>
                  <span className="breadcrumb-current">{title}</span>
                </>
              ) : (
                <span className="breadcrumb-current">{title}</span>
              )}
            </div>
          </div>

          <div className="topbar-right">
            {/* Перемикач клубу: список для користувачів мережі, фіксована назва для одного клубу */}
            <div className="club-switcher">
              <Building2 size={16} aria-hidden="true" className="club-switcher-icon" />
              {user?.club_id != null ? (
                <span className="club-fixed-label" title="Ваш клуб">
                  {user.club_name || `Клуб № ${user.club_id}`}
                </span>
              ) : (
                <select
                  aria-label="Фільтр за клубом"
                  value={selectedClubId ?? ""}
                  onChange={(e) => setSelectedClubId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Усі клуби</option>
                  {clubs.map((c) => (
                    <option key={c.club_id} value={c.club_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <time className="topbar-clock tabular-nums" dateTime={now.toISOString()}>
              {formatDateTime(now)}
            </time>

            <div className="user-menu" ref={menuRef}>
              <button
                type="button"
                className="user-menu-trigger"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                onClick={() => setUserMenuOpen((v) => !v)}
              >
                <div className="user-menu-meta">
                  <span className="user-menu-name">{user?.full_name}</span>
                  <span className="user-menu-role">{user?.role_label}</span>
                </div>
                <ChevronDown size={16} aria-hidden="true" />
              </button>

              {userMenuOpen && (
                <div className="user-dropdown" role="menu">
                  <Link to="/profile" className="user-dropdown-item" role="menuitem">
                    <User size={16} aria-hidden="true" />
                    <span>Профіль</span>
                  </Link>
                  <button
                    type="button"
                    className="user-dropdown-item danger"
                    role="menuitem"
                    onClick={handleLogout}
                  >
                    <LogOut size={16} aria-hidden="true" />
                    <span>Вийти</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          {user?.must_change_password && location.pathname !== "/profile" && (
            <div className="alert alert-warning" role="alert">
              <span>Ви увійшли з тимчасовим паролем. Змініть його у профілі, щоб працювати з системою.</span>
              <Link to="/profile" className="btn btn-primary btn-sm">
                Змінити пароль
              </Link>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
