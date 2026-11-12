import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { formatDate, formatMoney, formatPhone } from "./format.js";
import LoginPage from "./pages/LoginPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import ResourcePage from "./pages/ResourcePage.jsx";
import { ForbiddenPage, NotFoundPage, SectionPlaceholderPage } from "./pages/StatusPages.jsx";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="login-screen">
        <p className="muted">Завантаження…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Якщо користувач зобов'язаний змінити тимчасовий пароль, пускаємо лише на /profile
  if (user.must_change_password && location.pathname !== "/profile") {
    return <Navigate to="/profile" replace />;
  }

  return children;
}

function RequireSection({ section, level = "view", children }) {
  const { can } = useAuth();
  if (!can(section, level)) {
    return <ForbiddenPage />;
  }
  return children;
}

function ClubsPage() {
  const { reloadClubs } = useAuth();
  return (
    <ResourcePage
      section="clubs"
      title="Клуби мережі"
      endpoint="/clubs"
      idKey="club_id"
      nameKey="name"
      addLabel="Додати клуб"
      emptyText="Клубів ще немає. Додайте перший клуб."
      onChanged={reloadClubs}
      columns={[
        { key: "club_id", label: "№", numeric: true },
        { key: "name", label: "Назва" },
        { key: "address", label: "Адреса" },
        { key: "phone", label: "Телефон", render: (v) => formatPhone(v) },
        { key: "pc_count", label: "Кількість ПК", numeric: true },
      ]}
      fields={[
        { name: "name", label: "Назва", type: "text", required: true },
        { name: "address", label: "Адреса", type: "text", required: true },
        { name: "phone", label: "Телефон", type: "text", required: true, placeholder: "+380…" },
      ]}
    />
  );
}

function ClientsPage() {
  return (
    <ResourcePage
      section="clients"
      title="Клієнти"
      endpoint="/clients"
      idKey="client_id"
      nameKey="full_name"
      addLabel="Додати клієнта"
      emptyText="Клієнтів ще немає. Додайте першого клієнта."
      columns={[
        { key: "client_id", label: "№", numeric: true },
        { key: "full_name", label: "ПІБ" },
        { key: "phone", label: "Телефон", render: (v) => formatPhone(v) },
        { key: "email", label: "Email" },
        { key: "reg_date", label: "Реєстрація", render: (v) => formatDate(v) },
        {
          key: "bonus_balance",
          label: "Бонуси",
          numeric: true,
          render: (v) => formatMoney(v),
        },
      ]}
      fields={[
        { name: "full_name", label: "ПІБ", type: "text", required: true },
        { name: "phone", label: "Телефон", type: "text", required: true, placeholder: "+380…" },
        { name: "email", label: "Email", type: "text" },
      ]}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route
                path="/"
                element={
                  <RequireSection section="dashboard">
                    <SectionPlaceholderPage
                      title="Огляд"
                      section="dashboard"
                      description="Зведена панель стану клубу: KPI за сьогодні, виручка за 14 днів, стан місць, найближчі турніри та попередження."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/hall"
                element={
                  <RequireSection section="hall">
                    <SectionPlaceholderPage
                      title="Зал"
                      section="hall"
                      description="Керування робочими місцями в реальному часі: швидкий старт і завершення ігрових сеансів."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/sessions"
                element={
                  <RequireSection section="sessions">
                    <SectionPlaceholderPage
                      title="Сеанси"
                      section="sessions"
                      description="Журнал ігрових сеансів із фільтрами за періодом, статусом, місцем і тарифом."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/clients"
                element={
                  <RequireSection section="clients">
                    <ClientsPage />
                  </RequireSection>
                }
              />

              <Route
                path="/clients/:id"
                element={
                  <RequireSection section="clients">
                    <SectionPlaceholderPage
                      title="Картка клієнта"
                      section="clients"
                      description="Детальна картка клієнта: бонуси, історія сеансів, оплат та участі в турнірах."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/tariffs"
                element={
                  <RequireSection section="tariffs">
                    <SectionPlaceholderPage
                      title="Тарифи"
                      section="tariffs"
                      description="Тарифи за типами робочих місць: Standard, VIP, PlayStation."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/workstations"
                element={
                  <RequireSection section="workstations">
                    <SectionPlaceholderPage
                      title="Робочі місця"
                      section="workstations"
                      description="Облік ігрових ПК і консолей клубу, статуси та переведення на ремонт."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/payments"
                element={
                  <RequireSection section="payments">
                    <SectionPlaceholderPage
                      title="Оплати"
                      section="payments"
                      description="Реєстр прийнятих оплат (готівка, картка, бонуси), підсумки та квитанції."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/expenses"
                element={
                  <RequireSection section="expenses">
                    <SectionPlaceholderPage
                      title="Витрати"
                      section="expenses"
                      description="Облік витрат клубу за категоріями: оренда, зарплата, закупівлі, комунальні, інше."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/reports"
                element={
                  <RequireSection section="reports">
                    <SectionPlaceholderPage
                      title="Звіти"
                      section="reports"
                      description="Аналітичні звіти: фінанси, завантаженість залу, тарифи і місця, клієнти, турніри."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/tournaments"
                element={
                  <RequireSection section="tournaments">
                    <SectionPlaceholderPage
                      title="Турніри"
                      section="tournaments"
                      description="Календар майбутніх і завершених турнірів, реєстрація учасників та підсумки."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/tournaments/:id"
                element={
                  <RequireSection section="tournaments">
                    <SectionPlaceholderPage
                      title="Картка турніру"
                      section="tournaments"
                      description="Учасники турніру, результати та призери."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/staff"
                element={
                  <RequireSection section="staff">
                    <SectionPlaceholderPage
                      title="Співробітники"
                      section="staff"
                      description="Список співробітників клубу та організаційна структура."
                    />
                  </RequireSection>
                }
              />

              <Route
                path="/clubs"
                element={
                  <RequireSection section="clubs">
                    <ClubsPage />
                  </RequireSection>
                }
              />

              <Route
                path="/users"
                element={
                  <RequireSection section="users">
                    <SectionPlaceholderPage
                      title="Користувачі"
                      section="users"
                      description="Облікові записи співробітників, ролі, прив'язка до клубу та скидання паролів."
                    />
                  </RequireSection>
                }
              />

              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
