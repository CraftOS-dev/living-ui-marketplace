/**
 * An in-app confirmation dialog (AGENT-OWNED). Names the specific target and
 * consequence — callers pass real copy, never "Are you sure?". Never
 * `window.confirm`: everything renders in the app's own design system.
 *
 * Keyboard: Tab cycles the two actions, Escape cancels, focus starts on the
 * least destructive action and returns to the opener when the dialog closes.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `const [confirm, confirmElement] = useConfirm()` — render `confirmElement`
 * once near the root of the screen; `await confirm({ title, body,
 * confirmLabel, danger })` resolves true on confirm.
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setRequest({ ...opts, resolve, opener: document.activeElement });
      }),
    [],
  );

  const done = useCallback((answer) => {
    setRequest((current) => {
      if (current) {
        current.resolve(answer);
        if (current.opener instanceof HTMLElement) current.opener.focus();
      }
      return null;
    });
  }, []);

  const element =
    request === null ? null : <ConfirmDialog {...request} onDone={done} />;
  return [confirm, element];
}

function ConfirmDialog({ title, body, confirmLabel, danger = false, onDone }) {
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDone(false);
      }
      if (e.key === "Tab") {
        // Two focus stops; wrap between them.
        e.preventDefault();
        (document.activeElement === cancelRef.current
          ? confirmRef.current
          : cancelRef.current
        )?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDone(false);
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-body"
      >
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-body">{body}</p>
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            className="btn btn-ghost"
            type="button"
            onClick={() => onDone(false)}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`}
            type="button"
            onClick={() => onDone(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
