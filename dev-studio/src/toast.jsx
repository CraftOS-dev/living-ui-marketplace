/**
 * Toasts (AGENT-OWNED). One implementation for the whole app — screens call
 * `useToast()(kind, message)`; they never re-implement the region. Everything
 * renders in the app's own design system (tokens.css + ui.css), so no native
 * browser chrome ever stands in for the app's interface.
 */
import { createContext, useCallback, useContext, useState } from "react";
import Icon from "./Icon.jsx";

const ToastContext = createContext(() => {});

/** The push function: `toast(kind, message)`. Kinds: success · error · info. */
export function useToast() {
  return useContext(ToastContext);
}

let nextToastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((kind, message, { duration = 3500 } = {}) => {
    const id = ++nextToastId;
    setToasts((prev) => [...prev, { id, kind, message, leaving: false }]);
    // Errors linger longer: reading "what happened + what to do" takes time.
    const ms = kind === "error" ? Math.max(duration, 6000) : duration;
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      // Reduced-motion collapses the transition to ~0ms; remove regardless.
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 400);
    }, ms);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Polite live region: assistive tech announces each toast without
          interrupting what the user is doing. */}
      <div className="toast-region" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}${t.leaving ? " leaving" : ""}`}>
            <span className="toast-icon">
              <Icon name={t.kind === "success" ? "check" : t.kind === "error" ? "alert" : "info"} />
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
