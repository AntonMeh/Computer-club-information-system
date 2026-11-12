import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Діалог підтвердження небезпечної дії з назвою об'єкта й червоною кнопкою.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Видалити",
  cancelLabel = "Скасувати",
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={() => !loading && onCancel()}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header-row">
          <span className={`modal-icon ${danger ? "danger" : "warning"}`} aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
          <div>
            <h2 id="confirm-dialog-title" className="modal-title">
              {title}
            </h2>
            {message && <p className="modal-message">{message}</p>}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Виконуємо…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

