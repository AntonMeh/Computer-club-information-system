import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Універсальне модальне вікно (480px для size="sm", 640px для size="md").
 */
export default function Modal({ open, onClose, title, size = "sm", children }) {
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
        className={`modal-card ${size === "md" ? "modal-card-lg" : ""}`}
        style={{ maxWidth: size === "md" ? 640 : 480, width: "100%" }}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 className="modal-title" style={{ margin: 0 }}>
            {title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Закрити"
            onClick={() => onClose?.()}
          >
            <X size={18} />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
