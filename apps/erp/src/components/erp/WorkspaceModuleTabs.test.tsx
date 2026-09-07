import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceModuleTabs } from "./WorkspaceModuleTabs";
import { ErpAuthContext } from "../../auth/ErpAuthContext";

const renderWithPermissions = (
  ui: React.ReactElement,
  permissions: string[] = ["catalog.view", "pricing.view"],
) => {
  return render(
    <ErpAuthContext.Provider
      value={{
        session: null,
        organizationId: "test-org",
        loading: false,
        error: null,
        hasPermission: (perm: string) => permissions.includes(perm),
      }}
    >
      {ui}
    </ErpAuthContext.Provider>,
  );
};

describe("WorkspaceModuleTabs", () => {
  it("renders tabs for authorized modules and hides unauthorized ones", () => {
    const onSelect = vi.fn();
    renderWithPermissions(
      <WorkspaceModuleTabs
        moduleIds={["catalog", "pricing"]}
        activeModuleId="catalog"
        onSelectModule={onSelect}
      />,
      ["catalog.view", "pricing.view"],
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("Productos y servicios");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveTextContent("Precios y monedas");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });

  it("does not render when only one module is authorized", () => {
    const onSelect = vi.fn();
    const { container } = renderWithPermissions(
      <WorkspaceModuleTabs
        moduleIds={["catalog", "pricing"]}
        activeModuleId="catalog"
        onSelectModule={onSelect}
      />,
      ["catalog.view"], // lacks pricing.view
    );

    expect(container.firstChild).toBeNull();
  });

  it("calls onSelectModule when clicking a tab", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderWithPermissions(
      <WorkspaceModuleTabs
        moduleIds={["stock", "stock-counts", "labels"]}
        activeModuleId="stock"
        onSelectModule={onSelect}
      />,
      ["stock.view", "stock_counts.view", "labels.print"],
    );

    const countsTab = screen.getByRole("tab", { name: "Inventarios fisicos" });
    await user.click(countsTab);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("stock-counts");
  });
});
