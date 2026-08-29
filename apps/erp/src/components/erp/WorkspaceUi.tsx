import React from "react";
import { AlertCircle, Info, Loader2 } from "lucide-react";

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
