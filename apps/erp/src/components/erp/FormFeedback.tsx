import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertCircle, X } from "lucide-react";

export function FormError({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [message]);

  if (!message) return null;

  return (
    <div
      ref={ref}
      className="state-panel state-panel--alert"
      role="alert"
      aria-live="assertive"
      style={{
        alignItems: "center",
        gap: "8px",
        marginTop: 0,
        padding: "10px 14px",
        borderRadius: "10px",
        borderColor: "var(--rose-border)",
        background: "var(--rose-soft)",
        color: "var(--rose-text)",
        boxShadow: "none",
      }}
    >
      <AlertCircle aria-hidden="true" size={18} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: "13px", fontWeight: 600 }}>
        {message}
      </span>
      {onDismiss && (
        <button
          type="button"
          className="erp-modal-close-btn"
          aria-label="Cerrar aviso de error"
          onClick={onDismiss}
          style={{ minWidth: "44px", minHeight: "44px" }}
        >
          <X aria-hidden="true" size={16} />
        </button>
      )}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <span id={id} role="alert" style={{ color: "var(--rose-text)", fontSize: "12px" }}>
      {message}
    </span>
  );
}

type FieldA11y = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string | null;
  children: (a11y: FieldA11y) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ");

  return (
    <div className="erp-form-group">
      <label className="erp-form-label" htmlFor={id}>
        {required ? `${label} (obligatorio)` : label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && <span id={hintId} style={{ color: "var(--text-muted)", fontSize: "12px" }}>{hint}</span>}
      {error && <FieldError id={errorId} message={error} />}
    </div>
  );
}
