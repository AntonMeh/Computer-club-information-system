import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Monitor,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { api } from "../api.js";
import { Badge } from "../components/Badge.jsx";
import { ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDate, formatDateTime, formatMoney } from "../format.js";

function calcDeltaPercent(current, previous) {
  const cur = Number(current ?? 0);
  const prev = Number(previous ?? 0);
  if (prev <= 0) {
    if (cur > 0) return { label: "нова активність", positive: true, neutral: false };
    return { label: "0% до минулого періоду", positive: false, neutral: true };
  }
  const diff = ((cur - prev) / prev) * 100;
  const sign = diff > 0 ? "+" : "";
  return {
    label: `${sign}${diff.toFixed(1).replace(".", ",")}%`,
    positive: diff >= 0,
    neutral: Math.abs(diff) < 0.05,
  };
}

const METHOD_VARIANT = {
  готівка: "success",
  картка: "info",
  бонуси: "warning",
};

const WS_STATUS_LABEL = {
  вільне: "Вільне",
  зайняте: "Зайняте",
  "на ремонті": "На ремонті",
};

export default function DashboardPage() {
  const { user, can, selectedClubId } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError("");
      try {
        const qs = selectedClubId ? `?club_id=${selectedClubId}` : "";
        const res = await api.get(`/dashboard${qs}`);
        setData(res);
      } catch (err) {
        setError(err.message || "Не вдалося завантажити панель огляду");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedClubId]
  );

  useEffect(() => {
    loadDashboard(false);
    const timer = setInterval(() => {
      loadDashboard(true);
    }, 60000);
    return () => clearInterval(timer);
  }, [loadDashboard]);

  if (loading && !data) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Огляд</h1>
        </div>
        <div className="panel">
          <SkeletonTable rows={6} cols={4} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Огляд</h1>
        </div>
        <div className="panel">
          <ErrorState message={error} onRetry={() => loadDashboard(false)} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const role = user?.role || "director";
  const isFinanceRole = role === "director" || role === "accountant";
  const isMarketing = role === "marketing_manager";
  const isTech = role === "it_specialist";

  const revDelta = calcDeltaPercent(data.revenue_today, data.revenue_yesterday);
  const expDelta = calcDeltaPercent(data.expenses_month, data.expenses_prev_month);
  const profitNum = Number(data.profit_month ?? 0);

  const revenueSeries = data.revenue_14d || [];
  const maxRevenue14d = Math.max(
    1,
    ...revenueSeries.map((pt) => Number(pt.amount || 0))
  );
  const totalRevenue14d = revenueSeries.reduce(
    (acc, pt) => acc + Number(pt.amount || 0),
    0
  );

  const kpiCards = [];

  if (isMarketing) {
    kpiCards.push(
      {
        key: "new_7d",
        label: "Нові клієнти (7 днів)",
        value: `${data.new_clients_7d} ос.`,
        sub: `За 30 днів: ${data.new_clients_30d} ос.`,
      },
      {
        key: "new_30d",
        label: "Нові клієнти (30 днів)",
        value: `${data.new_clients_30d} ос.`,
        sub: "Зареєстровані у клубі",
      },
      {
        key: "active_sessions",
        label: "Активні сеанси",
        value: `${data.active_sessions} із ${data.workstations_available}`,
        sub: `Усього місць: ${data.workstations_total}`,
      },
      {
        key: "occupancy",
        label: "Завантаженість зараз",
        value: `${Number(data.occupancy_percent).toFixed(1).replace(".", ",")}%`,
        sub: `Вільно: ${data.workstations_free} · Ремонт: ${data.workstations_repair}`,
      }
    );
  } else if (isTech) {
    kpiCards.push(
      {
        key: "occupancy",
        label: "Завантаженість зараз",
        value: `${Number(data.occupancy_percent).toFixed(1).replace(".", ",")}%`,
        sub: `Доступно до гри: ${data.workstations_available} місць`,
      },
      {
        key: "active_sessions",
        label: "Активні сеанси",
        value: `${data.active_sessions} із ${data.workstations_available}`,
        sub: "Тривають просто зараз",
      },
      {
        key: "free_ws",
        label: "Вільні місця",
        value: `${data.workstations_free}`,
        sub: `Готові до посадки клієнтів`,
      },
      {
        key: "repair_ws",
        label: "Місця на ремонті",
        value: `${data.workstations_repair}`,
        valueClass: data.workstations_repair > 0 ? "kpi-value-warning" : "",
        sub:
          data.workstations_repair > 0
            ? "Потребують технічного огляду"
            : "Усі місця справні",
      }
    );
  } else if (isFinanceRole) {
    kpiCards.push(
      {
        key: "rev_today",
        label: "Виручка сьогодні",
        value: formatMoney(data.revenue_today),
        delta: revDelta,
        deltaSuffix: `проти вчора (${formatMoney(data.revenue_yesterday)})`,
      },
      {
        key: "active_sessions",
        label: "Активні сеанси",
        value: `${data.active_sessions} із ${data.workstations_available}`,
        sub: `Усього місць: ${data.workstations_total} (ремонт: ${data.workstations_repair})`,
      },
      {
        key: "occupancy",
        label: "Завантаженість зараз",
        value: `${Number(data.occupancy_percent).toFixed(1).replace(".", ",")}%`,
        sub: `Вільних місць: ${data.workstations_free}`,
      },
      {
        key: "exp_month",
        label: "Витрати за місяць",
        value: formatMoney(data.expenses_month),
        delta: {
          ...expDelta,
          positive: !expDelta.positive,
        },
        deltaSuffix: `минулий місяць: ${formatMoney(data.expenses_prev_month)}`,
      },
      {
        key: "profit_month",
        label: "Прибуток за місяць",
        value: formatMoney(data.profit_month),
        valueClass: profitNum >= 0 ? "kpi-value-positive" : "kpi-value-negative",
        sub: `Виручка за місяць: ${formatMoney(data.revenue_month)}`,
      }
    );
  } else {
    // Адміністратор залу / Старший адміністратор
    kpiCards.push(
      {
        key: "rev_today",
        label: "Виручка сьогодні",
        value: formatMoney(data.revenue_today),
        delta: revDelta,
        deltaSuffix: `проти вчора (${formatMoney(data.revenue_yesterday)})`,
      },
      {
        key: "active_sessions",
        label: "Активні сеанси",
        value: `${data.active_sessions} із ${data.workstations_available}`,
        sub: `Усього місць: ${data.workstations_total}`,
      },
      {
        key: "occupancy",
        label: "Завантаженість зараз",
        value: `${Number(data.occupancy_percent).toFixed(1).replace(".", ",")}%`,
        sub: `Вільно: ${data.workstations_free} · Ремонт: ${data.workstations_repair}`,
      },
      {
        key: "new_7d",
        label: "Нові клієнти (7 днів)",
        value: `${data.new_clients_7d} ос.`,
        sub: `За 30 днів: ${data.new_clients_30d} ос.`,
      }
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="hall-title-row">
          <h1 className="page-title">Огляд</h1>
          <span className="subtle-meta">
            Оновлено о{" "}
            {new Date(data.server_time).toLocaleTimeString("uk-UA", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="header-actions">
          {can("hall") && (
            <Link to="/hall" className="btn btn-primary">
              <Monitor size={16} />
              Відкрити зал
            </Link>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => loadDashboard(true)}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? "spin-icon" : ""} />
            Оновити
          </button>
        </div>
      </div>

      {/* Верхній ряд KPI */}
      <div
        className={`dashboard-kpi-grid ${
          kpiCards.length === 5 ? "dashboard-kpi-grid-5" : ""
        }`}
      >
        {kpiCards.map((card) => (
          <div key={card.key} className="panel kpi-card">
            <span className="kpi-label">{card.label}</span>
            <span className={`kpi-value num ${card.valueClass || ""}`}>
              {card.value}
            </span>
            {card.delta ? (
              <div className="kpi-delta-row">
                <span
                  className={`kpi-delta-badge ${
                    card.delta.neutral
                      ? "neutral"
                      : card.delta.positive
                      ? "positive"
                      : "negative"
                  }`}
                >
                  {!card.delta.neutral &&
                    (card.delta.positive ? (
                      <TrendingUp size={13} />
                    ) : (
                      <TrendingDown size={13} />
                    ))}
                  {card.delta.label}
                </span>
                <span className="kpi-subtext">{card.deltaSuffix}</span>
              </div>
            ) : (
              card.sub && <span className="kpi-subtext">{card.sub}</span>
            )}
          </div>
        ))}
      </div>

      {/* Картки «Поточна зміна» та «Каса за вчора / Z-звіти» */}
      {(can("shift") || can("cash")) && (
        <div className="dashboard-shift-cash-grid">
          {can("shift") && data.current_shift && (
            <div className="panel dashboard-shift-card">
              <div className="dashboard-panel-header" style={{ marginBottom: 8 }}>
                <div>
                  <span className="kpi-label">
                    Поточна зміна · {data.current_shift.club_name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <Badge variant={data.current_shift.is_open ? "success" : "neutral"}>
                      {data.current_shift.is_open ? "Відкрита" : "Зміну не відкрито"}
                    </Badge>
                    {data.current_shift.is_open && data.current_shift.opened_at && (
                      <span className="subtle-meta">
                        з{" "}
                        {new Date(data.current_shift.opened_at).toLocaleTimeString("uk-UA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {data.current_shift.opened_by_name}
                      </span>
                    )}
                  </div>
                </div>
                <Link to="/shift" className="btn btn-secondary btn-sm">
                  {data.current_shift.is_open ? "До зміни →" : "Відкрити зміну"}
                </Link>
              </div>
              {data.current_shift.is_open && (
                <div className="dashboard-shift-metrics">
                  <div>
                    <span className="subtle-meta">Виручка за зміну:</span>{" "}
                    <strong className="tabular-nums">
                      {formatMoney(data.current_shift.revenue_total)}
                    </strong>
                  </div>
                  <div>
                    <span className="subtle-meta">Очікується в касі:</span>{" "}
                    <strong className="tabular-nums accent-text">
                      {formatMoney(data.current_shift.expected_cash)}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {isFinanceRole && data.cash_yesterday && (
            <div className="panel dashboard-shift-card">
              <div className="dashboard-panel-header" style={{ marginBottom: 8 }}>
                <div>
                  <span className="kpi-label">Каса за вчора та Z-звіти</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    {data.unreviewed_z_reports_count > 0 ? (
                      <Badge variant="warning">
                        Z-звіти без перевірки: {data.unreviewed_z_reports_count}
                      </Badge>
                    ) : (
                      <Badge variant="success">Усі Z-звіти перевірено</Badge>
                    )}
                  </div>
                </div>
                <Link to="/cash" className="btn btn-secondary btn-sm">
                  До каси →
                </Link>
              </div>
              <div className="dashboard-shift-metrics">
                <div>
                  <span className="subtle-meta">Виручка вчора:</span>{" "}
                  <strong className="tabular-nums">
                    {formatMoney(data.cash_yesterday.revenue_total)}
                  </strong>
                </div>
                <div>
                  <span className="subtle-meta">Готівка вчора:</span>{" "}
                  <strong className="tabular-nums">
                    {formatMoney(data.cash_yesterday.cash_sales)}
                  </strong>
                </div>
                <div>
                  <span className="subtle-meta">Різниця по касі:</span>{" "}
                  <strong className="tabular-nums">
                    {formatMoney(data.cash_yesterday.cash_difference)}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Середній ряд (12 колонок: 8 зліва + 4 справа) */}
      <div className="dashboard-mid-grid">
        <div className="panel dashboard-chart-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="section-title" style={{ marginBottom: 2 }}>
                Виручка за 14 днів
              </h2>
              <p className="subtle-meta tabular-nums">
                Усього: <strong>{formatMoney(totalRevenue14d)}</strong> · Середня за день:{" "}
                <strong>
                  {formatMoney(
                    revenueSeries.length > 0
                      ? totalRevenue14d / revenueSeries.length
                      : 0
                  )}
                </strong>
              </p>
            </div>
            {can("reports") && (
              <Link to="/reports" className="table-link dashboard-more-link">
                Докладніше у звітах <ArrowRight size={14} />
              </Link>
            )}
          </div>

          <div
            className="chart-canvas-wrap"
            role="img"
            aria-label="Стовпчиковий графік виручки за 14 днів"
          >
            {/* Горизонтальні лінії сітки відліку */}
            <div className="chart-grid-lines" aria-hidden="true">
              {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                <div key={ratio} className="chart-grid-line">
                  <span className="chart-axis-label tabular-nums">
                    {Math.round(maxRevenue14d * ratio)} ₴
                  </span>
                </div>
              ))}
            </div>

            <div className="bar-chart-14d">
              {revenueSeries.map((pt, idx) => {
                const amt = Number(pt.amount || 0);
                const heightPct =
                  amt > 0 ? Math.max(6, Math.round((amt / maxRevenue14d) * 100)) : 2;
                const isPeak = amt > 0 && amt === maxRevenue14d;
                const isLatest = idx === revenueSeries.length - 1;
                return (
                  <div
                    key={pt.date}
                    className={`bar-col-14d ${isPeak || isLatest ? "highlight" : ""}`}
                    title={`${formatDate(pt.date)}: ${formatMoney(amt)}`}
                  >
                    <div className="bar-col-amount tabular-nums">
                      {amt > 0 ? `${Math.round(amt)}` : ""}
                    </div>
                    <div className="bar-col-track">
                      <div
                        className={`bar-col-fill ${
                          amt === 0
                            ? "empty"
                            : isPeak || isLatest
                            ? "accent"
                            : "muted-bar"
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <div className="bar-col-label tabular-nums">{pt.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="panel dashboard-ws-panel">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="section-title" style={{ marginBottom: 2 }}>
                Місця зараз
              </h2>
              <p className="subtle-meta">
                Вільно: <strong>{data.workstations_free}</strong> · Зайнято:{" "}
                <strong>{data.active_sessions}</strong> · Ремонт:{" "}
                <strong>{data.workstations_repair}</strong>
              </p>
            </div>
            {can("hall") && (
              <Link to="/hall" className="table-link dashboard-more-link">
                Перейти до залу <ArrowRight size={14} />
              </Link>
            )}
          </div>

          <div className="ws-mini-grid">
            {(data.workstations_now || []).map((w) => {
              const statusClass =
                w.status === "вільне"
                  ? "free"
                  : w.status === "зайняте"
                  ? "busy"
                  : "repair";
              const tooltipParts = [
                `№ ${String(w.number).padStart(2, "0")}`,
                w.type,
                WS_STATUS_LABEL[w.status] || w.status,
              ];
              if (w.client_name) tooltipParts.push(w.client_name);
              if (!selectedClubId && w.club_name) tooltipParts.unshift(w.club_name);

              return (
                <Link
                  to={can("hall") ? "/hall" : "/workstations"}
                  key={w.workstation_id}
                  className={`ws-mini-tile ${statusClass}`}
                  title={tooltipParts.join(" · ")}
                >
                  <span className="ws-mini-num num">
                    {String(w.number).padStart(2, "0")}
                  </span>
                  <span className="ws-mini-type">{w.type === "PlayStation" ? "PS5" : w.type}</span>
                </Link>
              );
            })}
          </div>

          <div className="ws-mini-legend">
            <span className="ws-legend-item">
              <span className="ws-legend-dot free" /> Вільне ({data.workstations_free})
            </span>
            <span className="ws-legend-item">
              <span className="ws-legend-dot busy" /> Зайняте ({data.active_sessions})
            </span>
            <span className="ws-legend-item">
              <span className="ws-legend-dot repair" /> На ремонті ({data.workstations_repair})
            </span>
          </div>
        </div>
      </div>

      {/* Нижній ряд (3 блоки) */}
      <div className="dashboard-bottom-grid">
        {/* 1. Найближчі турніри */}
        <div className="panel dashboard-list-panel">
          <div className="dashboard-panel-header">
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              Найближчі турніри
            </h2>
            {can("tournaments") && (
              <Link to="/tournaments" className="table-link dashboard-more-link">
                Усі турніри <ArrowRight size={14} />
              </Link>
            )}
          </div>

          {data.upcoming_tournaments?.length === 0 ? (
            <p className="muted" style={{ padding: "12px 0" }}>
              Запланованих турнірів наразі немає.
            </p>
          ) : (
            <div className="dashboard-compact-list">
              {data.upcoming_tournaments.map((t) => (
                <Link
                  key={t.tournament_id}
                  to={`/tournaments/${t.tournament_id}`}
                  className="dashboard-list-item"
                >
                  <div className="dashboard-list-item-main">
                    <div className="dashboard-list-title">
                      <Trophy size={15} className="accent-text" />
                      <span>{t.name}</span>
                    </div>
                    <span className="subtle-meta">
                      {t.game} · {formatDate(t.date)} · Учасників: {t.participants_count}
                    </span>
                  </div>
                  <div className="dashboard-list-right">
                    <span className="num font-medium accent-text">
                      {formatMoney(t.prize_fund)}
                    </span>
                    <Badge
                      variant={t.status === "триває сьогодні" ? "warning" : "info"}
                    >
                      {t.status}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* 2. Останні оплати */}
        <div className="panel dashboard-list-panel">
          <div className="dashboard-panel-header">
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              Останні оплати
            </h2>
            {can("payments") && (
              <Link to="/payments" className="table-link dashboard-more-link">
                Усі оплати <ArrowRight size={14} />
              </Link>
            )}
          </div>

          {data.recent_payments?.length === 0 ? (
            <p className="muted" style={{ padding: "12px 0" }}>
              Оплат ще не зареєстровано.
            </p>
          ) : (
            <div className="dashboard-compact-list">
              {data.recent_payments.slice(0, 6).map((p) => (
                <div key={p.payment_id} className="dashboard-list-item static">
                  <div className="dashboard-list-item-main">
                    <div className="dashboard-list-title">
                      <CreditCard size={14} className="muted-icon" />
                      <span>{p.client_name}</span>
                    </div>
                    <span className="subtle-meta num">
                      Місце № {String(p.workstation_number).padStart(2, "0")} ·{" "}
                      {formatDateTime(p.payment_date)}
                    </span>
                  </div>
                  <div className="dashboard-list-right">
                    <span className="num font-medium">{formatMoney(p.amount)}</span>
                    <Badge variant={METHOD_VARIANT[p.method] || "neutral"}>
                      {p.method}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. Блок «Увага» */}
        <div className="panel dashboard-list-panel">
          <div className="dashboard-panel-header">
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              Увага
            </h2>
            {data.alerts?.length > 0 && (
              <Badge variant="warning">{data.alerts.length}</Badge>
            )}
          </div>

          {!data.alerts || data.alerts.length === 0 ? (
            <div className="dashboard-ok-box">
              <CheckCircle2 size={22} className="ok-icon" />
              <div>
                <div className="font-medium">Усе гаразд</div>
                <div className="subtle-meta">Попереджень немає — усі системи працюють у штатному режимі.</div>
              </div>
            </div>
          ) : (
            <div className="dashboard-alerts-list">
              {data.alerts.map((al) => (
                <Link key={al.key} to={al.link} className="dashboard-alert-item">
                  <AlertTriangle size={16} className="alert-item-icon" />
                  <span className="dashboard-alert-text">{al.text}</span>
                  <ArrowRight size={14} className="alert-item-arrow" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

