import React from "react";
import {
  type ErpModuleDefinition,
  type ErpModuleId,
  getErpModuleById,
} from "@nictech/domain";
import { useErpAuth } from "../../auth/ErpAuthContext";

export interface WorkspaceModuleTabsProps {
  moduleIds: readonly ErpModuleId[];
  activeModuleId: ErpModuleId;
  onSelectModule: (id: ErpModuleId) => void;
  className?: string;
}

export const WorkspaceModuleTabs: React.FC<WorkspaceModuleTabsProps> = ({
  moduleIds,
  activeModuleId,
  onSelectModule,
  className = "",
}) => {
  const { hasPermission } = useErpAuth();

  const authorizedModules = React.useMemo(() => {
    return moduleIds
      .map((id) => getErpModuleById(id))
      .filter((m): m is ErpModuleDefinition => Boolean(m && hasPermission(m.permission)));
  }, [moduleIds, hasPermission]);

  if (authorizedModules.length <= 1) {
    return null;
  }

  return (
    <div
      className={`workspace-module-tabs ${className}`}
      role="tablist"
      aria-label="Submódulos del área"
    >
      {authorizedModules.map((module) => {
        const isActive = module.id === activeModuleId;
        return (
          <button
            key={module.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`flow-select-pill ${isActive ? "active" : ""}`}
            onClick={() => onSelectModule(module.id as ErpModuleId)}
          >
            <span>{module.label}</span>
          </button>
        );
      })}
    </div>
  );
};
