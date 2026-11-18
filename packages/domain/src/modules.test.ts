import { describe, expect, it } from "vitest";
import {
  ERP_MODULES,
  ERP_SALIDA_MODULES,
  getVisibleErpModules,
  ERP_WORKSPACES,
  getErpModuleById,
  getErpWorkspaceById,
  getErpWorkspaceByModuleId,
} from "./modules";

describe("ERP Modules & Workspaces Taxonomy", () => {
  it("has exactly 28 canonical modules", () => {
    expect(ERP_MODULES).toHaveLength(28);
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

  it("covers all 28 modules exactly once across all 19 workspaces", () => {
    const allAssignedModules = ERP_WORKSPACES.flatMap((w) => w.moduleIds);
    expect(allAssignedModules).toHaveLength(28);

    const uniqueAssigned = new Set(allAssignedModules);
    expect(uniqueAssigned.size).toBe(28);

    const canonicalIds = ERP_MODULES.map((m) => m.id).sort();
    const assignedIds = [...allAssignedModules].sort();
    expect(assignedIds).toEqual(canonicalIds);
  });

  it("correctly retrieves modules and workspaces via helpers", () => {
    expect(getErpModuleById("pricing")?.permission).toBe("pricing.view");
    expect(getErpModuleById("stock-counts")).toBeUndefined();
    expect(getErpModuleById("non-existent")).toBeUndefined();

    expect(getErpWorkspaceById("catalog")?.label).toBe("Catálogo y precios");
    expect(getErpWorkspaceById("non-existent")).toBeUndefined();

    expect(getErpWorkspaceByModuleId("pricing")?.id).toBe("catalog");
    expect(getErpWorkspaceByModuleId("labels")?.id).toBe("stock");
    expect(getErpWorkspaceByModuleId("stock-counts")).toBeUndefined();
    expect(getErpWorkspaceByModuleId("suppliers")?.id).toBe("purchases");
    expect(getErpWorkspaceByModuleId("warranties")?.id).toBe("repairs");
    expect(getErpWorkspaceByModuleId("profitability")?.id).toBe("accounting");
    expect(getErpWorkspaceByModuleId("settings")?.id).toBe("system");
    expect(getErpWorkspaceByModuleId("unknown")).toBeUndefined();
  });

  it("uses proper Spanish accents in module labels", () => {
    const labels = ERP_MODULES.map((m) => m.label);
    expect(labels).toContain("Códigos y etiquetas");
    expect(labels).toContain("Pruebas técnicas");
    expect(labels).toContain("Garantías");
    expect(labels).toContain("Configuración");
    expect(labels).toContain("Auditoría");
    for (const untilded of ["Codigos", "tecnicas", "Garantias", "Configuracion", "Auditoria"]) {
      expect(labels.some((label) => label.includes(untilded))).toBe(false);
    }
  });
});

describe("ERP module visibility", () => {
  it("defaults to the launch profile including pricing, users and settings", () => {
    expect(getVisibleErpModules()).toEqual(ERP_SALIDA_MODULES);
    expect(getVisibleErpModules()).toContain("pricing");
    expect(getVisibleErpModules()).toContain("users");
    expect(getVisibleErpModules()).toContain("settings");
    expect(getVisibleErpModules()).not.toContain("purchases");
  });

  it("shows all modules for completo without stock-counts", () => {
    const visible = getVisibleErpModules({ profile: "completo" });
    expect(visible).toEqual(ERP_MODULES.map((m) => m.id));
    expect(visible).not.toContain("stock-counts");
  });

  it("uses the optional custom selection in canonical order and excludes stock-counts", () => {
    expect(getVisibleErpModules({ profile: "salida", visible: ["settings", "pos", "pos", "stock-counts"] })).toEqual(["pos", "settings"]);
    expect(getVisibleErpModules({ profile: "completo", visible: [] })).toEqual([]);
  });
});
