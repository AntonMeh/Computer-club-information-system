import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Універсальне модальне вікно (480px для size="sm", 640px для size="md").
 */
export default function Modal({ open, onClose, title, subtitle, size = "sm", children }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={() => onClose?.()}>
      <div
        className={`modal-card ${size === "md" ? "modal-card-wide" : "modal-card-std"}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-top-bar">
          <div>
            <h2 className="modal-title" style={{ marginBottom: subtitle ? 2 : 0 }}>
              {title}
            </h2>
            {subtitle && <p className="subtle-meta">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="btn-icon"
            aria-label="Закрити"
            onClick={() => onClose?.()}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
