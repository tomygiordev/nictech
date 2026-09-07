import { describe, expect, it } from "vitest";
import {
  ERP_MODULES,
  ERP_WORKSPACES,
  getErpModuleById,
  getErpWorkspaceById,
  getErpWorkspaceByModuleId,
} from "./modules";

describe("ERP Modules & Workspaces Taxonomy", () => {
  it("has exactly 29 canonical modules", () => {
    expect(ERP_MODULES).toHaveLength(29);
  });

  it("has no duplicate module ids", () => {
    const ids = ERP_MODULES.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("has exactly 19 unified workspaces", () => {
    expect(ERP_WORKSPACES).toHaveLength(19);
  });

  it("has no duplicate workspace ids", () => {
    const ids = ERP_WORKSPACES.map((w) => w.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("every workspace has at least one module and no empty moduleIds", () => {
    for (const ws of ERP_WORKSPACES) {
      expect(ws.moduleIds.length).toBeGreaterThan(0);
    }
  });

  it("covers all 29 modules exactly once across all 19 workspaces", () => {
    const allAssignedModules = ERP_WORKSPACES.flatMap((w) => w.moduleIds);
    expect(allAssignedModules).toHaveLength(29);

    const uniqueAssigned = new Set(allAssignedModules);
    expect(uniqueAssigned.size).toBe(29);

    const canonicalIds = ERP_MODULES.map((m) => m.id).sort();
    const assignedIds = [...allAssignedModules].sort();
    expect(assignedIds).toEqual(canonicalIds);
  });

  it("correctly retrieves modules and workspaces via helpers", () => {
    expect(getErpModuleById("pricing")?.permission).toBe("pricing.view");
    expect(getErpModuleById("non-existent")).toBeUndefined();

    expect(getErpWorkspaceById("catalog")?.label).toBe("Catálogo y precios");
    expect(getErpWorkspaceById("non-existent")).toBeUndefined();

    expect(getErpWorkspaceByModuleId("pricing")?.id).toBe("catalog");
    expect(getErpWorkspaceByModuleId("stock-counts")?.id).toBe("stock");
    expect(getErpWorkspaceByModuleId("suppliers")?.id).toBe("purchases");
    expect(getErpWorkspaceByModuleId("warranties")?.id).toBe("repairs");
    expect(getErpWorkspaceByModuleId("profitability")?.id).toBe("accounting");
    expect(getErpWorkspaceByModuleId("settings")?.id).toBe("system");
    expect(getErpWorkspaceByModuleId("unknown")).toBeUndefined();
  });
});
