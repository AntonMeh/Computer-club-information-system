import { AlertCircle, Inbox, RefreshCw } from "lucide-react";

/**
 * Скелетон-рядки таблиці під час завантаження.
 */
export function SkeletonTable({ columns = 5, rows = 5 }) {
  return (
    <div className="skeleton-table" aria-busy="true" aria-label="Завантаження даних">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="skeleton-row">
          {Array.from({ length: columns }).map((__, cIdx) => (
            <span key={cIdx} className="skeleton-cell" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Порожній стан: іконка, одне речення, головна дія.
 */
export function EmptyState({ icon: Icon = Inbox, text, actionLabel, onAction }) {
  return (
    <div className="state-box">
      <Icon size={28} className="state-icon" aria-hidden="true" />
      <p className="state-text">{text}</p>
      {actionLabel && onAction && (
        <button type="button" className="btn btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Помилковий стан: пояснення й кнопка «Спробувати знову».
 */
export function ErrorState({ message, onRetry }) {
  return (
    <div className="state-box state-error" role="alert">
      <AlertCircle size={28} className="state-icon" aria-hidden="true" />
      <p className="state-text">{message || "Не вдалося завантажити дані."}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Спробувати знову</span>
        </button>
      )}
    </div>
  );
}

