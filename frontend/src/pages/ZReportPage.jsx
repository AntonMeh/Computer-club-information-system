import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Printer,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { api } from "../api.js";
import { Badge, StatusBadge } from "../components/Badge.jsx";
import { ErrorState, SkeletonTable } from "../components/Feedback.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
} from "../format.js";

export default function ZReportPage() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const toast = useToast();

  const canReview = can("cash", "full");
  const isDirector = user?.role === "director";

  const [shift, setShift] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printMode, setPrintMode] = useState("a4"); // "a4" | "80mm"

  const [reviewNote, setReviewNote] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/shifts/${id}`);
      setShift(res);
      setReviewNote(res?.review_note || "");
    } catch (err) {
      setError(err.message || "Не вдалося завантажити Z-звіт");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleConfirmReview = async (e) => {
    e.preventDefault();
    setReviewSubmitting(true);
    try {
      await api.post(`/shifts/${id}/review`, {
        note: reviewNote.trim() || null,
      });
      toast.success("Z-звіт підтверджено бухгалтером");
      await loadReport();
    } catch (err) {
      toast.error(err.message || "Не вдалося підтвердити Z-звіт");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleUnreview = async () => {
    setReviewSubmitting(true);
    try {
      await api.remove(`/shifts/${id}/review`);
      toast.info("Підтвердження Z-звіту знято");
      await loadReport();
    } catch (err) {
      toast.error(err.message || "Не вдалося зняти підтвердження");
    } finally {
      setReviewSubmitting(false);
    }
  };

  if (loading) {
    return (
      <section className="page-section">
        <div className="panel">
          <SkeletonTable rows={8} columns={4} />
        </div>
      </section>
    );
  }

  if (error || !shift?.shift_id) {
    return (
      <section className="page-section">
        <div className="panel">
          <ErrorState
            message={error || "Z-звіт не знайдено"}
            onRetry={loadReport}
          />
        </div>
      </section>
    );
  }

  const s = shift;
  const ops = s.operations || [];
  const payments = s.payments || [];
  const isOpen = s.status === "відкрита";
  const cashPaymentsCount = payments.filter((p) => p.method === "готівка").length;
  const cardPaymentsCount = payments.filter((p) => p.method === "картка").length;

  const zTitle = isOpen
    ? `X-ЗВІТ (ПРОМІЖНИЙ) · ${s.z_label}`
    : `Z-ЗВІТ ЗМІНИ № ${s.z_label}`;

  const cashDiff = Number(s.cash_difference ?? 0);
  const cardDiff =
    s.card_difference != null ? Number(s.card_difference) : null;

  return (
    <section className="page-section">
      {/* Панель дій (не друкується) */}
      <div className="page-header no-print">
        <div className="detail-header-left">
          <Link to="/cash" className="back-link">
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Назад до каси та Z-звітів</span>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1>{isOpen ? `X-звіт зміни ${s.z_label}` : `Z-звіт ${s.z_label}`}</h1>
            {isOpen ? (
              <Badge variant="info">Зміна відкрита</Badge>
            ) : s.force_closed ? (
              <Badge variant="danger">Закрито примусово</Badge>
            ) : (
              <Badge variant="neutral">Зміна закрита</Badge>
            )}
            {!isOpen && (
              <Badge variant={s.review_status === "підтверджена" ? "success" : "warning"}>
                {s.review_status === "підтверджена"
                  ? "✓ Перевірено бухгалтером"
                  : "Очікує перевірки"}
              </Badge>
            )}
          </div>
        </div>

        <div className="header-actions">
          <div className="tabs-bar" role="group" aria-label="Формат документа">
            <button
              type="button"
              className={`tab-btn ${printMode === "a4" ? "active" : ""}`}
              onClick={() => setPrintMode("a4")}
            >
              <FileText size={14} aria-hidden="true" />
              <span>Формат A4</span>
            </button>
            <button
              type="button"
              className={`tab-btn ${printMode === "80mm" ? "active" : ""}`}
              onClick={() => setPrintMode("80mm")}
            >
              <Printer size={14} aria-hidden="true" />
              <span>Стрічка 80 мм</span>
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
          >
            <Printer size={16} aria-hidden="true" />
            <span>Друкувати</span>
          </button>
        </div>
      </div>

      {/* Верхні KPI-картки (не друкуються, для швидкої оцінки на екрані) */}
      <div className="kpi-grid no-print">
        <div className="panel kpi-card">
          <span className="kpi-label">Загальна виручка ({s.payments_count} чеків)</span>
          <span className="kpi-value tabular-nums accent-text">
            {formatMoney(s.revenue_total)}
          </span>
          <span className="kpi-subtext tabular-nums">
            Середній чек: {formatMoney(s.avg_check)}
          </span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Очікувалось готівки в касі</span>
          <span className="kpi-value tabular-nums">
            {formatMoney(s.expected_cash)}
          </span>
          <span className="kpi-subtext tabular-nums">
            Початок зміни: {formatMoney(s.opening_cash)}
          </span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">
            {isOpen ? "Поточна готівка в касі" : "Фактично перераховано"}
          </span>
          <span className="kpi-value tabular-nums">
            {formatMoney(s.actual_cash)}
          </span>
          <span
            className={`kpi-subtext tabular-nums ${
              cashDiff === 0
                ? "kpi-value-positive"
                : cashDiff > 0
                ? "kpi-value-warning"
                : "kpi-value-negative"
            }`}
          >
            Різниця: {cashDiff > 0 ? "+" : ""}
            {formatMoney(cashDiff)}
          </span>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Залишок на наступну зміну</span>
          <span className="kpi-value tabular-nums">
            {formatMoney(s.cash_left)}
          </span>
          <span className="kpi-subtext tabular-nums">
            Інкасовано: {formatMoney(s.collection)}
          </span>
        </div>
      </div>

      {/* Основна сітка: Документ Z-звіту ліворуч + Панель перевірки бухгалтером праворуч */}
      <div className={`z-report-layout ${printMode === "80mm" ? "mode-80mm" : "mode-a4"}`}>
        <article
          className={`panel z-report-doc ${
            printMode === "80mm" ? "z-report-80mm" : "z-report-a4"
          }`}
        >
          {/* Шапка документа */}
          <header className="z-doc-header">
            <div className="z-doc-club">
              <strong style={{ fontSize: 16 }}>{s.club_name}</strong>
              {s.club_address && (
                <span className="subtle-meta"> · {s.club_address}</span>
              )}
            </div>
            <h2 className="z-doc-title">{zTitle}</h2>

            <div className="z-doc-meta-grid">
              <div>
                <span className="subtle-meta">Бізнес-дата зміни:</span>{" "}
                <strong className="tabular-nums">{formatDate(s.business_date)}</strong>
              </div>
              <div>
                <span className="subtle-meta">Тривалість зміни:</span>{" "}
                <strong>{formatDuration(s.duration_minutes)}</strong>
              </div>
              <div>
                <span className="subtle-meta">Відкрито:</span>{" "}
                <span className="tabular-nums">{formatDateTime(s.opened_at)}</span> ·{" "}
                <strong>{s.opened_by_name}</strong>
              </div>
              <div>
                <span className="subtle-meta">Закрито:</span>{" "}
                {s.closed_at ? (
                  <>
                    <span className="tabular-nums">{formatDateTime(s.closed_at)}</span> ·{" "}
                    <strong>{s.closed_by_name}</strong>
                  </>
                ) : (
                  <span>Зміна ще відкрита</span>
                )}
              </div>
            </div>
          </header>

          {/* Розділ 1 — Підсумок реалізації за зміну */}
          <section className="z-doc-section">
            <h3 className="z-doc-section-title">1. Підсумок реалізації за зміну</h3>
            <div className="z-doc-lines">
              <div className="z-doc-line">
                <span>Завершено сеансів (скасовано / перенесено в наступну зміну):</span>
                <span className="tabular-nums">
                  <strong>{s.sessions_completed}</strong> ({s.sessions_cancelled} /{" "}
                  {s.sessions_carried_over})
                </span>
              </div>
              <div className="z-doc-line">
                <span>Оплати готівкою ({cashPaymentsCount} чеків):</span>
                <span className="tabular-nums">{formatMoney(s.cash_sales)}</span>
              </div>
              <div className="z-doc-line">
                <span>Оплати карткою ({cardPaymentsCount} чеків):</span>
                <span className="tabular-nums">{formatMoney(s.card_sales)}</span>
              </div>
              <div className="z-doc-line">
                <span>Оплати бонусами (списано бонусів):</span>
                <span className="tabular-nums">{formatMoney(s.bonus_sales)}</span>
              </div>
              <div className="z-doc-line total">
                <span>Разом виручка за зміну:</span>
                <strong className="tabular-nums">{formatMoney(s.revenue_total)}</strong>
              </div>
            </div>
          </section>

          {/* Розділ 2 — Рух готівки в касі */}
          <section className="z-doc-section">
            <h3 className="z-doc-section-title">2. Рух готівки в касі (грошова шухляда)</h3>
            <div className="z-doc-lines">
              <div className="z-doc-line">
                <span>Залишок на початок зміни:</span>
                <span className="tabular-nums">{formatMoney(s.opening_cash)}</span>
              </div>
              {Number(s.opening_difference) !== 0 && (
                <div className="z-doc-line">
                  <span className="subtle-meta">
                    Розбіжність на початок зміни:
                  </span>
                  <span className="tabular-nums kpi-value-warning">
                    {Number(s.opening_difference) > 0 ? "+" : ""}
                    {formatMoney(s.opening_difference)}
                  </span>
                </div>
              )}
              <div className="z-doc-line">
                <span>+ Готівкові оплати сеансів:</span>
                <span className="tabular-nums kpi-value-positive">
                  +{formatMoney(s.cash_sales)}
                </span>
              </div>
              <div className="z-doc-line">
                <span>+ Службові внесення:</span>
                <span className="tabular-nums kpi-value-positive">
                  +{formatMoney(s.cash_in)}
                </span>
              </div>
              <div className="z-doc-line">
                <span>− Службові вилучення (витрати з каси):</span>
                <span className="tabular-nums kpi-value-warning">
                  −{formatMoney(s.cash_out)}
                </span>
              </div>
              <div className="z-doc-line">
                <span>− Інкасація (здача виручки в сейф):</span>
                <span className="tabular-nums text-info">
                  −{formatMoney(s.collection)}
                </span>
              </div>
              <div className="z-doc-line total">
                <span>= Очікувалось у касі:</span>
                <strong className="tabular-nums">{formatMoney(s.expected_cash)}</strong>
              </div>

              {!isOpen && (
                <>
                  <div className="z-doc-line">
                    <span>Фактично перераховано в касі:</span>
                    <strong className="tabular-nums">
                      {formatMoney(s.actual_cash)}
                    </strong>
                  </div>
                  <div className="z-doc-line">
                    <span>Різниця по касі:</span>
                    <strong
                      className={`tabular-nums ${
                        cashDiff === 0
                          ? "kpi-value-positive"
                          : cashDiff > 0
                          ? "kpi-value-warning"
                          : "kpi-value-negative"
                      }`}
                    >
                      {cashDiff === 0
                        ? "0,00 ₴ (Збігається)"
                        : cashDiff > 0
                        ? `+${formatMoney(cashDiff)} (Лишок)`
                        : `${formatMoney(cashDiff)} (Недостача)`}
                    </strong>
                  </div>
                  <div className="z-doc-line total">
                    <span>= Залишок у касі на наступну зміну:</span>
                    <strong className="tabular-nums accent-text">
                      {formatMoney(s.cash_left)}
                    </strong>
                  </div>
                </>
              )}
            </div>

            {(s.open_note || s.close_note) && (
              <div className="z-doc-comment">
                {s.open_note && (
                  <div>
                    <strong>Коментар при відкритті:</strong> {s.open_note}
                  </div>
                )}
                {s.close_note && (
                  <div>
                    <strong>Коментар при закритті:</strong> {s.close_note}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Розділ 3 — Звірка банківського терміналу */}
          {s.card_terminal_total != null && (
            <section className="z-doc-section">
              <h3 className="z-doc-section-title">3. Звірка банківського терміналу</h3>
              <div className="z-doc-lines">
                <div className="z-doc-line">
                  <span>Проведено в системі (картка):</span>
                  <span className="tabular-nums">{formatMoney(s.card_sales)}</span>
                </div>
                <div className="z-doc-line">
                  <span>За стрічкою терміналу:</span>
                  <span className="tabular-nums">
                    {formatMoney(s.card_terminal_total)}
                  </span>
                </div>
                <div className="z-doc-line total">
                  <span>Різниця за терміналом:</span>
                  <strong
                    className={`tabular-nums ${
                      cardDiff === 0 ? "kpi-value-positive" : "kpi-value-negative"
                    }`}
                  >
                    {cardDiff > 0 ? "+" : ""}
                    {formatMoney(cardDiff)}
                  </strong>
                </div>
              </div>
            </section>
          )}

          {/* Розділ 4 — Деталізація службових операцій зміни */}
          {printMode === "a4" && (
            <section className="z-doc-section">
              <h3 className="z-doc-section-title">
                4. Службові касові операції зміни ({ops.length})
              </h3>
              {ops.length === 0 ? (
                <p className="subtle-meta">
                  Службових операцій у цій зміні не проводилося.
                </p>
              ) : (
                <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Час</th>
                        <th>Тип</th>
                        <th>Категорія</th>
                        <th className="num">Сума</th>
                        <th>Провів</th>
                        <th>Коментар</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ops.map((op) => (
                        <tr key={op.operation_id}>
                          <td className="tabular-nums">
                            {formatDateTime(op.created_at)}
                          </td>
                          <td>
                            <Badge
                              variant={
                                op.type === "внесення"
                                  ? "success"
                                  : op.type === "вилучення"
                                  ? "warning"
                                  : "info"
                              }
                            >
                              {op.type}
                            </Badge>
                          </td>
                          <td>{op.category || "—"}</td>
                          <td
                            className={`num tabular-nums font-medium ${
                              op.type === "внесення"
                                ? "kpi-value-positive"
                                : "kpi-value-negative"
                            }`}
                          >
                            {op.type === "внесення" ? "+" : "−"}
                            {formatMoney(op.amount)}
                          </td>
                          <td>{op.created_by_name}</td>
                          <td>{op.comment || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Розділ 5 — Оплати за зміну (для A4) */}
          {printMode === "a4" && payments.length > 0 && (
            <section className="z-doc-section">
              <h3 className="z-doc-section-title">
                5. Оплати за зміну ({payments.length})
              </h3>
              <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
                <table>
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Час</th>
                      <th>Клієнт</th>
                      <th>Сеанс і місце</th>
                      <th>Спосіб</th>
                      <th className="num">Сума</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.payment_id}>
                        <td className="tabular-nums font-medium">№ {p.payment_id}</td>
                        <td className="tabular-nums">{formatDateTime(p.payment_date)}</td>
                        <td>{p.client_name}</td>
                        <td>
                          Сеанс № {p.session_id} · місце №{" "}
                          {String(p.workstation_number).padStart(2, "0")}
                        </td>
                        <td>
                          <StatusBadge status={p.method} />
                        </td>
                        <td className="num tabular-nums font-medium">
                          {formatMoney(p.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Рядки підписів для друкованої форми */}
          <div className="z-signatures">
            <div className="z-sig-line">
              <span>Адміністратор зміни ({s.closed_by_name || s.opened_by_name}):</span>
              <span className="z-sig-underscore">______________________</span>
            </div>
            <div className="z-sig-line">
              <span>Бухгалтер ({s.reviewed_by_name || "ПІБ"}):</span>
              <span className="z-sig-underscore">______________________</span>
            </div>
          </div>
        </article>

        {/* Бічна панель перевірки бухгалтером */}
        <aside className="panel z-review-sidebar no-print">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ShieldCheck size={18} className="accent-text" />
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              Перевірка бухгалтером
            </h2>
          </div>

          {isOpen ? (
            <div className="stack-form">
              <Badge variant="info">Зміна ще триває</Badge>
              <p className="subtle-meta">
                Це проміжний X-звіт. Підтвердження бухгалтером стане доступним після закриття зміни та формування підсумкового Z-звіту.
              </p>
              <Link to="/shift" className="btn btn-primary btn-block">
                Перейти до поточної зміни →
              </Link>
            </div>
          ) : s.review_status === "підтверджена" ? (
            <div className="stack-form">
              <div className="z-review-confirmed">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <CheckCircle2 size={18} className="ok-icon" />
                  <strong>Підтверджено бухгалтером</strong>
                </div>
                <div className="subtle-meta" style={{ marginTop: 6 }}>
                  Перевірив: <strong style={{ color: "var(--ink)" }}>{s.reviewed_by_name}</strong>
                </div>
                {s.reviewed_at && (
                  <div className="subtle-meta tabular-nums">
                    Дата й час: {formatDateTime(s.reviewed_at)}
                  </div>
                )}
                {s.review_note && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <strong>Примітка:</strong> {s.review_note}
                  </div>
                )}
              </div>

              {isDirector && (
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={handleUnreview}
                  disabled={reviewSubmitting}
                >
                  <RotateCcw size={15} />
                  <span>Зняти підтвердження</span>
                </button>
              )}
            </div>
          ) : (
            <div className="stack-form">
              <div className="alert alert-warning" role="status">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Clock size={16} />
                  <span>Z-звіт очікує перевірки бухгалтером</span>
                </div>
              </div>

              {canReview ? (
                <form onSubmit={handleConfirmReview} className="stack-form">
                  <div className="field">
                    <label className="field-label" htmlFor="review-note-input">
                      Примітка бухгалтера <span className="subtle-meta">(необов'язково)</span>
                    </label>
                    <textarea
                      id="review-note-input"
                      rows={3}
                      placeholder="Зауваження або відмітка про приймання інкасації…"
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary btn-block"
                    disabled={reviewSubmitting}
                  >
                    <ShieldCheck size={16} />
                    <span>
                      {reviewSubmitting ? "Збереження…" : "Підтвердити Z-звіт"}
                    </span>
                  </button>
                </form>
              ) : (
                <p className="subtle-meta">
                  Підтвердити Z-звіт може користувач із роллю Бухгалтер або Директор.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
