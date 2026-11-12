import { useCallback, useEffect } from "react";
import { X } from "lucide-react";

/**
 * Висувна панель праворуч (480 px; на екрані до 720 px — на весь екран).
 * Закриття з незбереженими змінами (isDirty) питає підтвердження.
 */
export default function Drawer({ open, title, isDirty = false, onClose, children, footer }) {
  const attemptClose = useCallback(() => {
    if (isDirty) {
      const ok = window.confirm("Є незбережені зміни. Закрити панель без збереження?");
      if (!ok) return;
    }
    onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        attemptClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, attemptClose]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={attemptClose}>
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="drawer-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Закрити панель"
            onClick={attemptClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-footer">{footer}</footer>}
      </aside>
    </div>
  );
}
