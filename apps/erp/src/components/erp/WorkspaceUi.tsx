import React, { useEffect, useId, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
  type LucideIcon,
} from "lucide-react";

export interface WorkspaceHeaderProps {
  title: string;
  description: string;
  badge?: string;
  badgeTone?: "info" | "warning" | "neutral";
  actions?: React.ReactNode;
}

const HEADER_BADGE_CLASS: Record<NonNullable<WorkspaceHeaderProps["badgeTone"]>, string> = {
  info: "status-pill status-pill--mint",
  warning: "status-pill status-pill--amber",
  neutral: "status-pill status-pill--navy",
};

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  title,
  description,
  badge,
  badgeTone = "info",
  actions,
}) => (
  <div className="workspace-header">
    <div>
      <div className="workspace-header__title-row">
        <h2>{title}</h2>
        {badge && <span className={HEADER_BADGE_CLASS[badgeTone]}>{badge}</span>}
      </div>
      <p className="workspace-header__desc">{description}</p>
    </div>
    {actions && <div className="workspace-header__actions">{actions}</div>}
  </div>
);

export interface SurfaceCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  badge?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const SurfaceCard: React.FC<SurfaceCardProps> = ({
  title,
  subtitle,
  badge,
  headerAction,
  children,
  className = "",
  ...rest
}) => (
  <div className={`surface-card ${className}`} {...rest}>
    {(title || badge || headerAction) && (
      <div className="surface-card__header">
        <div>
          {title && <h3 className="surface-card__title">{title}</h3>}
          {subtitle && <p className="surface-card__subtitle">{subtitle}</p>}
        </div>
        <div className="surface-card__header-right">
          {badge && <span className="status-pill status-pill--mint">{badge}</span>}
          {headerAction}
        </div>
      </div>
    )}
    <div className="surface-card__body">{children}</div>
  </div>
);

export interface StatePanelProps {
  type: "loading" | "error" | "empty" | "info";
  title?: string;
  message: string;
  action?: React.ReactNode;
}

export const StatePanel: React.FC<StatePanelProps> = ({
  type,
  title,
  message,
  action,
}) => {
  return (
    <div className={`state-panel state-panel--${type}`} role={type === "error" ? "alert" : "status"}>
      <div className="state-panel__icon">
        {type === "loading" && <Loader2 className="animate-spin" size={24} />}
        {type === "error" && <AlertCircle size={24} />}
        {type === "empty" && <Info size={24} />}
        {type === "info" && <Info size={24} />}
      </div>
      <div className="state-panel__content">
        {title && <strong>{title}</strong>}
        <p>{message}</p>
        {action && <div className="state-panel__action">{action}</div>}
      </div>
    </div>
  );
};

export interface StatusPillProps {
  variant?: "mint" | "navy" | "steel" | "amber" | "rose" | "sky" | "slate";
  children: React.ReactNode;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  variant = "mint",
  children,
  className = "",
}) => <span className={`status-pill status-pill--${variant} ${className}`}>{children}</span>;

export interface KpiCardProps {
  icon: LucideIcon;
  iconVariant?: "green" | "navy" | "steel" | "dark" | "amber" | "rose" | "purple";
  label: string;
  value: React.ReactNode;
  trend?: {
    text: string;
    positive?: boolean;
    icon?: LucideIcon;
  };
  sublabel?: string;
  className?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  icon: Icon,
  iconVariant = "green",
  label,
  value,
  trend,
  sublabel,
  className = "",
}) => {
  const TrendIcon = trend?.icon;
  return (
    <div className={`flow-kpi-card ${className}`}>
      <div className={`flow-kpi-card__icon-box ${iconVariant}`}>
        <Icon size={20} />
      </div>
      <div className="flow-kpi-card__content">
        <span className="flow-kpi-card__label">{label}</span>
        <div className="flow-kpi-card__val-row">
          <strong
            className={`flow-kpi-card__val${typeof value === "string" && !/\d/.test(value) ? " flow-kpi-card__val--text" : ""}`}
          >
            {value}
          </strong>
          {trend && (
            <span className={`flow-trend-tag ${trend.positive !== false ? "positive" : "negative"}`}>
              {TrendIcon && <TrendIcon size={12} />}
              {trend.text}
            </span>
          )}
        </div>
        {sublabel && <span className="flow-kpi-card__sub">{sublabel}</span>}
      </div>
    </div>
  );
};

export interface FeedbackAlertProps {
  type?: "success" | "error" | "info" | "warning";
  message: string;
  submessage?: string;
  onClose?: () => void;
  action?: React.ReactNode;
}

export const FeedbackAlert: React.FC<FeedbackAlertProps> = ({
  type = "success",
  message,
  submessage,
  onClose,
  action,
}) => {
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alertRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [message, type]);

  const Icon =
    type === "success"
      ? CheckCircle2
      : type === "error"
      ? AlertCircle
      : type === "warning"
      ? AlertTriangle
      : Info;

  const tone = {
    success: { text: "var(--emerald-text)", bg: "var(--emerald-soft)", border: "var(--emerald-border)" },
    error: { text: "var(--rose-text)", bg: "var(--rose-soft)", border: "var(--rose-border)" },
    warning: { text: "var(--amber-text)", bg: "var(--amber-soft)", border: "var(--amber-border)" },
    info: { text: "var(--brand-primary)", bg: "var(--brand-soft)", border: "var(--brand-border)" },
  }[type];

  return (
    <div
      ref={alertRef}
      className="state-panel state-panel--alert"
      style={{
        alignItems: "center",
        gap: "12px",
        marginTop: 0,
        marginBottom: "12px",
        padding: "12px 16px",
        borderColor: tone.border,
        background: tone.bg,
        boxShadow: "none",
      }}
      role={type === "error" ? "alert" : "status"}
    >
      <div className="state-panel__icon" style={{ color: tone.text, display: "grid" }}>
        <Icon size={20} />
      </div>
      <div className="state-panel__content" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", width: "100%", minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ color: tone.text, fontSize: "13.5px", display: "block" }}>{message}</strong>
          {submessage && <p style={{ margin: "2px 0 0", fontSize: "12.5px", color: "var(--text-muted)" }}>{submessage}</p>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {action}
          {onClose && (
            <button
              type="button"
              className="erp-modal-close-btn"
              onClick={onClose}
              aria-label="Cerrar notificación"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
  footer?: React.ReactNode;
  icon?: LucideIcon;
  /** @deprecated El cuerpo del modal siempre scrollea; se mantiene por compatibilidad. */
  scrollBody?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = "520px",
  footer,
  icon: Icon,
}) => {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([type='hidden']):not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const isTopmostDialog = () => {
      const dialogs = document.querySelectorAll<HTMLElement>("[data-erp-modal='true']");
      return dialogs.item(dialogs.length - 1) === dialog;
    };

    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      const preferredTarget = dialog.querySelector<HTMLElement>(
        "[data-autofocus], input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      const firstFocusable = dialog.querySelector<HTMLElement>(focusableSelector);
      (preferredTarget ?? firstFocusable ?? dialog).focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopmostDialog()) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab") return;

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusableElements.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? lastElement : firstElement).focus();
      } else if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="erp-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="erp-modal-content flow-card"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        data-erp-modal="true"
        tabIndex={-1}
      >
        <div className="erp-modal-header">
          <div className="erp-modal-header__title-group">
            {Icon && (
              <div className="erp-modal-icon">
                <Icon size={18} />
              </div>
            )}
            <div>
              <h3 id={titleId} className="erp-modal-title">
                {title}
              </h3>
              {subtitle && (
                <p id={subtitleId} className="erp-modal-subtitle">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="erp-modal-close-btn"
            onClick={onClose}
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className="erp-modal-body">{children}</div>

        {footer && <div className="erp-modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "danger",
  onConfirm,
  onCancel,
  isPending = false,
}) => {
  if (!isOpen) return null;

  const Icon = variant === "danger" ? AlertTriangle : Info;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      maxWidth="440px"
      icon={Icon}
    >
      <p style={{ margin: "0 0 4px", fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.5 }}>
        {message}
      </p>
      <div className="erp-modal-footer">
        <button
          type="button"
          className="btn-secondary"
          data-autofocus
          onClick={onCancel}
          disabled={isPending}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={variant === "danger" ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? "Procesando…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
};

export { WorkspaceModuleTabs } from "./WorkspaceModuleTabs";
export type { WorkspaceModuleTabsProps } from "./WorkspaceModuleTabs";
