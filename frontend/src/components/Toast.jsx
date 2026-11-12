import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message, type = "success", action = null) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type, action }]);
      // Успіх — автоматично закривається через 4 с; помилка лишається, поки не закриють
      if (type !== "error") {
        setTimeout(() => dismiss(id), 4000);
      }
      return id;
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      success: (msg, action) => show(msg, "success", action),
      error: (msg, action) => show(msg, "error", action),
      info: (msg, action) => show(msg, "info", action),
      dismiss,
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => {
          const Icon =
            t.type === "error" ? AlertCircle : t.type === "info" ? Info : CheckCircle2;
          return (
            <div
              key={t.id}
              className={`toast toast-${t.type}`}
              role={t.type === "error" ? "alert" : "status"}
            >
              <Icon size={18} className="toast-icon" aria-hidden="true" />
              <span className="toast-text">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    t.action.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                className="toast-close"
                aria-label="Закрити сповіщення"
                onClick={() => dismiss(t.id)}
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast має використовуватися всередині ToastProvider");
  return ctx;
}
