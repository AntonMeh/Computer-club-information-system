import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import CashPage from "./pages/CashPage.jsx";
import ClientDetailPage from "./pages/ClientDetailPage.jsx";
import ClientsPage from "./pages/ClientsPage.jsx";
import ClubsPage from "./pages/ClubsPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import ExpensesPage from "./pages/ExpensesPage.jsx";
import HallPage from "./pages/HallPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import PaymentsPage from "./pages/PaymentsPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import SessionsPage from "./pages/SessionsPage.jsx";
import ShiftPage from "./pages/ShiftPage.jsx";
import StaffPage from "./pages/StaffPage.jsx";
import { ForbiddenPage, NotFoundPage } from "./pages/StatusPages.jsx";
import TariffsPage from "./pages/TariffsPage.jsx";
import TournamentDetailPage from "./pages/TournamentDetailPage.jsx";
import TournamentsPage from "./pages/TournamentsPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import WorkstationsPage from "./pages/WorkstationsPage.jsx";
import ZReportPage from "./pages/ZReportPage.jsx";

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
                    <DashboardPage />
                  </RequireSection>
                }
              />

              <Route
                path="/hall"
                element={
                  <RequireSection section="hall">
                    <HallPage />
                  </RequireSection>
                }
              />

              <Route
                path="/shift"
                element={
                  <RequireSection section="shift">
                    <ShiftPage />
                  </RequireSection>
                }
              />

              <Route
                path="/sessions"
                element={
                  <RequireSection section="sessions">
                    <SessionsPage />
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
                    <ClientDetailPage />
                  </RequireSection>
                }
              />

              <Route
                path="/tariffs"
                element={
                  <RequireSection section="tariffs">
                    <TariffsPage />
                  </RequireSection>
                }
              />

              <Route
                path="/workstations"
                element={
                  <RequireSection section="workstations">
                    <WorkstationsPage />
                  </RequireSection>
                }
              />

              <Route
                path="/payments"
                element={
                  <RequireSection section="payments">
                    <PaymentsPage />
                  </RequireSection>
                }
              />

              <Route
                path="/expenses"
                element={
                  <RequireSection section="expenses">
                    <ExpensesPage />
                  </RequireSection>
                }
              />

              <Route
                path="/cash"
                element={
                  <RequireSection section="cash">
                    <CashPage />
                  </RequireSection>
                }
              />

              <Route
                path="/cash/z/:id"
                element={
                  <RequireSection section="cash">
                    <ZReportPage />
                  </RequireSection>
                }
              />

              <Route
                path="/reports"
                element={
                  <RequireSection section="reports">
                    <ReportsPage />
                  </RequireSection>
                }
              />

              <Route
                path="/tournaments"
                element={
                  <RequireSection section="tournaments">
                    <TournamentsPage />
                  </RequireSection>
                }
              />

              <Route
                path="/tournaments/:id"
                element={
                  <RequireSection section="tournaments">
                    <TournamentDetailPage />
                  </RequireSection>
                }
              />

              <Route
                path="/staff"
                element={
                  <RequireSection section="staff">
                    <StaffPage />
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
                    <UsersPage />
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
