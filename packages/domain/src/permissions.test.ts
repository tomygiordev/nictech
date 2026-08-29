import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";

describe("hasPermission", () => {
  it("uses role permissions when there is no override", () => {
    expect(
      hasPermission(
        { rolePermissions: new Set(["sales.create"]), overrides: [] },
        "sales.create",
      ),
    ).toBe(true);
  });

  it("lets an explicit deny win over role and allow grants", () => {
    expect(
      hasPermission(
        {
          rolePermissions: new Set(["sales.create"]),
          overrides: [
            { code: "sales.create", effect: "allow" },
            { code: "sales.create", effect: "deny" },
          ],
        },
        "sales.create",
      ),
    ).toBe(false);
  });

  it("applies branch overrides only in their branch", () => {
    const context = {
      rolePermissions: new Set<string>(),
      overrides: [
        {
          code: "stock.adjust",
          effect: "allow" as const,
          branchId: "branch-a",
        },
      ],
      branchId: "branch-b",
    };

    expect(hasPermission(context, "stock.adjust")).toBe(false);
    expect(
      hasPermission({ ...context, branchId: "branch-a" }, "stock.adjust"),
    ).toBe(true);
  });
});
