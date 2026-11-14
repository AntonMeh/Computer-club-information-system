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

  const [data, setData] = useState(null);
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
      setData(res);
      setReviewNote(res.shift?.review_note || "");
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
        review_note: reviewNote.trim() || null,
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
      <div className="page-container">
        <SkeletonTable rows={8} cols={4} />
      </div>
    );
  }

  if (error || !data?.shift) {
    return (
      <div className="page-container">
        <ErrorState
          message={error || "Z-звіт не знайдено"}
          onRetry={loadReport}
        />
      </div>
    );
  }

  const s = data.shift;
  const ops = data.cash_operations || [];
  const payments = data.payments || [];
  const isOpen = s.status === "відкрита";
  const zTitle = isOpen
    ? `X-ЗВІТ (ПРОМІЖНИЙ) · Зміна #${s.shift_id}`
    : `Z-ЗВІТ ЗМІНИ № Z-${String(s.z_number || 0).padStart(4, "0")}`;

  const cashDiff = s.cash_difference != null ? Number(s.cash_difference) : null;
  const cardDiff = s.card_difference != null ? Number(s.card_difference) : null;

  return (
    <div className="page-container">
      {/* Панель дій (не друкується) */}
      <div className="page-header no-print" style={{ marginBottom: 16 }}>
        <Link to="/cash" className="btn btn-secondary">
          <ArrowLeft size={16} />
          <span>До каси та Z-звітів</span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="segmented-control" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className={`segment-btn ${printMode === "a4" ? "active" : ""}`}
              onClick={() => setPrintMode("a4")}
            >
              Формат A4
            </button>
            <button
              type="button"
              className={`segment-btn ${printMode === "80mm" ? "active" : ""}`}
              onClick={() => setPrintMode("80mm")}
            >
              Стрічка 80 мм
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
          >
            <Printer size={16} />
            <span>Друкувати</span>
          </button>
        </div>
      </div>

      {/* Документ Z-звіту */}
      <article
        className={`card z-report-doc ${
          printMode === "80mm" ? "z-report-80mm" : "z-report-a4"
        }`}
      >
        {/* Шапка документа */}
        <header className="z-doc-header">
          <div className="z-doc-club">
            <strong>{s.club_name}</strong>
            {s.club_address && <span className="muted"> · {s.club_address}</span>}
          </div>
          <h1 className="z-doc-title">{zTitle}</h1>

          <div className="z-doc-meta-grid">
            <div>
              <span className="muted">Дата зміни:</span>{" "}
              <strong className="tabular-nums">{formatDate(s.business_date)}</strong>
            </div>
            <div>
              <span className="muted">Статус:</span>{" "}
              <span
                className={`badge ${
                  s.status === "відкрита"
                    ? "badge-info"
                    : s.status === "закрита"
                    ? "badge-success"
                    : "badge-danger"
                }`}
              >
                {s.status}
              </span>
            </div>
            <div>
              <span className="muted">Відкрито:</span>{" "}
              <span className="tabular-nums">{formatDateTime(s.opened_at)}</span> (
              {s.opened_by_name})
            </div>
            <div>
              <span className="muted">Закрито:</span>{" "}
              {s.closed_at ? (
                <>
                  <span className="tabular-nums">{formatDateTime(s.closed_at)}</span> (
                  {s.closed_by_name})
                </>
              ) : (
                <span>Зміна ще відкрита</span>
              )}
            </div>
            <div>
              <span className="muted">Тривалість:</span>{" "}
              <strong>{formatDuration(s.duration_min)}</strong>
            </div>
          </div>
        </header>

        {/* Розділ 1 — Підсумок реалізації за зміну */}
        <section className="z-doc-section">
          <h2 className="z-doc-section-title">1. Підсумок реалізації за зміну</h2>
          <div className="z-doc-lines">
            <div className="z-doc-line">
              <span>Завершено сеансів (скасовано / перенесено в наступну зміну):</span>
              <span className="tabular-nums">
                <strong>{s.sessions_completed}</strong> ({s.sessions_cancelled} /{" "}
                {s.carried_over_sessions_count})
              </span>
            </div>
            <div className="z-doc-line">
              <span>Оплати готівкою ({s.cash_payments_count} чеків):</span>
              <span className="tabular-nums">{formatMoney(s.revenue_cash)}</span>
            </div>
            <div className="z-doc-line">
              <span>Оплати карткою ({s.card_payments_count} чеків):</span>
              <span className="tabular-nums">{formatMoney(s.revenue_card)}</span>
            </div>
            <div className="z-doc-line total">
              <span>Разом грошова виручка (Готівка + Картка):</span>
              <strong className="tabular-nums">{formatMoney(s.revenue_total)}</strong>
            </div>
            <div className="z-doc-line muted">
              <span>Списано бонусів (довідково):</span>
              <span className="tabular-nums">{formatMoney(s.revenue_bonus)}</span>
            </div>
          </div>
        </section>

        {/* Розділ 2 — Рух готівки в касі */}
        <section className="z-doc-section">
          <h2 className="z-doc-section-title">2. Рух готівки в касі</h2>
          <div className="z-doc-lines">
            <div className="z-doc-line">
              <span>Залишок на початок зміни:</span>
              <span className="tabular-nums">{formatMoney(s.opening_cash)}</span>
            </div>
            <div className="z-doc-line">
              <span>+ Готівкові оплати:</span>
              <span className="tabular-nums text-success">
                +{formatMoney(s.revenue_cash)}
              </span>
            </div>
            <div className="z-doc-line">
              <span>+ Службові внесення:</span>
              <span className="tabular-nums text-success">
                +{formatMoney(s.cash_in_total)}
              </span>
            </div>
            <div className="z-doc-line">
              <span>− Службові вилучення:</span>
              <span className="tabular-nums text-warning">
                −{formatMoney(s.cash_out_total)}
              </span>
            </div>
            <div className="z-doc-line">
              <span>− Проміжна інкасація протягом зміни:</span>
              <span className="tabular-nums text-info">
                −{formatMoney(s.safe_drop_total)}
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
                        ? "text-success"
                        : cashDiff > 0
                        ? "text-warning"
                        : "text-danger"
                    }`}
                  >
                    {cashDiff === 0
                      ? "0,00 ₴ (Збігається)"
                      : cashDiff > 0
                      ? `+${formatMoney(cashDiff)} (Лишок)`
                      : `${formatMoney(cashDiff)} (Недостача)`}
                  </strong>
                </div>
                <div className="z-doc-line">
                  <span>− Інкасація при закритті зміни:</span>
                  <span className="tabular-nums">
                    −{formatMoney(s.safe_drop_on_close)}
                  </span>
                </div>
                <div className="z-doc-line total">
                  <span>= Залишок у касі на наступну зміну:</span>
                  <strong className="tabular-nums">
                    {formatMoney(s.closing_cash)}
                  </strong>
                </div>
              </>
            )}
          </div>
          {s.comment && (
            <div className="z-doc-comment">
              <strong>Пояснення / коментар зміни:</strong> {s.comment}
            </div>
          )}
        </section>

        {/* Розділ 3 — Звірка банківського терміналу */}
        {s.terminal_card_total != null && (
          <section className="z-doc-section">
            <h2 className="z-doc-section-title">3. Звірка банківського терміналу</h2>
            <div className="z-doc-lines">
              <div className="z-doc-line">
                <span>Проведено в системі (картка):</span>
                <span className="tabular-nums">{formatMoney(s.revenue_card)}</span>
              </div>
              <div className="z-doc-line">
                <span>За стрічкою терміналу:</span>
                <span className="tabular-nums">
                  {formatMoney(s.terminal_card_total)}
                </span>
              </div>
              <div className="z-doc-line total">
                <span>Різниця за терміналом:</span>
                <strong
                  className={`tabular-nums ${
                    cardDiff === 0 ? "text-success" : "text-danger"
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
        <section className="z-doc-section">
          <h2 className="z-doc-section-title">
            4. Службові касові операції зміни ({ops.length})
          </h2>
          {ops.length === 0 ? (
            <p className="muted" style={{ margin: "6px 0" }}>
              Службових операцій у цій зміні не проводилося.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
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
                      <td>{op.type}</td>
                      <td>{op.category || "—"}</td>
                      <td className="num tabular-nums">
                        {op.type === "внесення" ? "+" : "−"}
                        {formatMoney(op.amount)}
                      </td>
                      <td>{op.staff_name}</td>
                      <td>{op.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Розділ 5 — Перевірка бухгалтером */}
        <section className="z-doc-section">
          <h2 className="z-doc-section-title">5. Перевірка бухгалтером</h2>

          {isOpen ? (
            <p className="muted">
              Зміна ще відкрита. Підтвердження бухгалтером стане доступним після закриття зміни та формування Z-звіту.
            </p>
          ) : s.reviewed_at ? (
            <div className="z-review-confirmed">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="badge badge-success">
                  <CheckCircle2 size={14} style={{ marginRight: 4 }} />
                  Підтверджено бухгалтером
                </span>
                <span>
                  <strong>{s.reviewed_by_name}</strong> ·{" "}
                  <span className="tabular-nums">{formatDateTime(s.reviewed_at)}</span>
                </span>
              </div>
              {s.review_note && (
                <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                  <strong>Примітка бухгалтера:</strong> {s.review_note}
                </p>
              )}

              {isDirector && (
                <div className="no-print" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleUnreview}
                    disabled={reviewSubmitting}
                  >
                    <RotateCcw size={14} />
                    <span>Зняти підтвердження</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 12 }}>
                <span className="badge badge-warning">
                  <Clock size={13} style={{ marginRight: 4 }} />
                  Очікує перевірки бухгалтером
                </span>
              </div>

              {canReview && (
                <form onSubmit={handleConfirmReview} className="no-print z-review-form">
                  <div className="form-group">
                    <label className="form-label" htmlFor="review-note-input">
                      Примітка бухгалтера (необов'язково)
                    </label>
                    <textarea
                      id="review-note-input"
                      rows={2}
                      className="form-input"
                      placeholder="Зауваження або відмітка про приймання інкасації…"
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={reviewSubmitting}
                  >
                    <ShieldCheck size={16} />
                    <span>
                      {reviewSubmitting ? "Збереження…" : "Підтвердити Z-звіт"}
                    </span>
                  </button>
                </form>
              )}
            </div>
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
        </section>
      </article>
    </div>
  );
}
