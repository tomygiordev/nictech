import React, { useEffect, useId } from "react";
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
  actions?: React.ReactNode;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  title,
  description,
  badge,
  actions,
}) => (
  <div className="workspace-header">
    <div>
      <div className="workspace-header__title-row">
        <h2>{title}</h2>
        {badge && <span className="status-pill status-pill--mint">{badge}</span>}
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
          <strong className="flow-kpi-card__val">{value}</strong>
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
  const Icon =
    type === "success"
      ? CheckCircle2
      : type === "error"
      ? AlertCircle
      : type === "warning"
      ? AlertTriangle
      : Info;

  const colorVar =
    type === "success"
      ? "var(--emerald-success)"
      : type === "error"
      ? "var(--rose-accent)"
      : type === "warning"
      ? "var(--amber-accent)"
      : "var(--brand-primary)";

  const bgVar =
    type === "success"
      ? "var(--emerald-soft)"
      : type === "error"
      ? "var(--rose-soft)"
      : type === "warning"
      ? "var(--amber-soft)"
      : "var(--brand-soft)";

  return (
    <div
      className="state-panel"
      style={{
        borderColor: colorVar,
        background: bgVar,
        marginBottom: "16px",
      }}
      role={type === "error" ? "alert" : "status"}
    >
      <div className="state-panel__icon" style={{ color: colorVar }}>
        <Icon size={22} />
      </div>
      <div className="state-panel__content" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
        <div>
          <strong style={{ color: colorVar, fontSize: "14px", display: "block" }}>{message}</strong>
          {submessage && <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>{submessage}</p>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {action}
          {onClose && (
            <button
              type="button"
              className="pag-btn"
              onClick={onClose}
              aria-label="Cerrar notificación"
              style={{ background: "#ffffff", padding: "4px 8px", fontSize: "12px" }}
            >
              ✕ Cerrar
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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="erp-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="erp-modal-content flow-card" style={{ maxWidth }} tabIndex={-1}>
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
              {subtitle && <p className="erp-modal-subtitle">{subtitle}</p>}
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
      <p style={{ margin: "0 0 20px", fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.5 }}>
        {message}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button
          type="button"
          className="pag-btn"
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
