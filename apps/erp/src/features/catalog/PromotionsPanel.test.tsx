import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErpAuthContext, type ErpAuthContextValue } from "../../auth/ErpAuthContext";
import { PromotionsPanel } from "./PromotionsPanel";
import { localDateTimeToIso } from "./promotionsSchema";

const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const VARIANT_ID = "20000000-0000-4000-8000-000000000002";
const PROMO_ID = "30000000-0000-4000-8000-000000000003";

const sampleProducts = [
  {
    id: PRODUCT_ID,
    internal_code: "ACC-001",
    internal_name: "Funda MagSafe",
    base_sale_price: 25000,
    is_active: true,
    product_variants: [
      { id: VARIANT_ID, code: "ACC-001-NEG", name: "Negro", is_active: true },
    ],
  },
];

const samplePromotions = [
  {
    id: PROMO_ID,
    name: "Semana Tech",
    kind: "porcentaje",
    value: 20,
    starts_at: "2026-11-16T12:00:00.000Z",
    ends_at: "2026-11-23T12:00:00.000Z",
    is_active: true,
    channels: ["web", "pos"],
    created_at: "2026-11-15T10:00:00.000Z",
    updated_at: "2026-11-15T10:00:00.000Z",
  },
];

const sampleTargets = [
  {
    promotion_id: PROMO_ID,
    product_id: PRODUCT_ID,
    variant_id: VARIANT_ID,
    is_active: true,
  },
];

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  promotions: [] as typeof samplePromotions,
  targets: [] as typeof sampleTargets,
  products: [] as typeof sampleProducts,
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    rpc: mock.rpc,
    from: (table: string) => {
      const getRows = () => {
        if (table === "promotions") return mock.promotions;
        if (table === "promotion_targets") return mock.targets;
        if (table === "products") return mock.products;
        return [];
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (
          resolve: (value: { data: unknown[]; error: null }) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve({ data: getRows(), error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));

const renderPanel = (permissions: string[] = ["pricing.view", "pricing.manage"]) => {
  const authValue: ErpAuthContextValue = {
    session: null,
    organizationId: "org-1",
    branchIds: ["branch-1"],
    permissions,
    loading: false,
    error: null,
    hasPermission: (permission: string) => permissions.includes(permission),
  };
  return render(
    <ErpAuthContext.Provider value={authValue}>
      <PromotionsPanel />
    </ErpAuthContext.Provider>,
  );
};

beforeEach(() => {
  mock.rpc.mockReset();
  mock.rpc.mockResolvedValue({ data: PROMO_ID, error: null });
  mock.promotions = [...samplePromotions];
  mock.targets = [...sampleTargets];
  mock.products = [...sampleProducts];
});

afterEach(cleanup);

describe("PromotionsPanel", () => {
  it("lista promociones con tipo, valor, canales, estado y cantidad de productos", async () => {
    renderPanel();

    expect(await screen.findByText("Semana Tech")).toBeInTheDocument();
    expect(screen.getByText("Porcentaje")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(screen.getByText("1 producto")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
  });

  it("valida porcentaje 100, fin anterior al inicio y ausencia de destinos", async () => {
    renderPanel();
    await screen.findByText("Semana Tech");

    fireEvent.click(screen.getByRole("button", { name: "Nueva promoción" }));

    fireEvent.change(screen.getByLabelText("Nombre de la promoción"), {
      target: { value: "Promo inválida" },
    });
    fireEvent.change(screen.getByLabelText("Porcentaje de descuento (%)"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("Inicio de vigencia"), {
      target: { value: "2026-11-20T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Fin de vigencia (opcional)"), {
      target: { value: "2026-11-19T10:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Guardar promoción" }));

    expect(await screen.findByText("El porcentaje debe ser menor a 100.")).toBeInTheDocument();
    expect(screen.getByText("La fecha de fin debe ser posterior al inicio.")).toBeInTheDocument();
    expect(screen.getByText("Agregá al menos un producto o variante.")).toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("crea una promoción llamando a upsert_promotion con los argumentos exactos", async () => {
    renderPanel();
    await screen.findByText("Semana Tech");

    fireEvent.click(screen.getByRole("button", { name: "Nueva promoción" }));

    fireEvent.change(screen.getByLabelText("Nombre de la promoción"), {
      target: { value: "Cyber Fundas" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de promoción"), {
      target: { value: "precio_fijo" },
    });
    fireEvent.change(screen.getByLabelText("Precio promocional (ARS)"), {
      target: { value: "18500.5" },
    });
    fireEvent.change(screen.getByLabelText("Inicio de vigencia"), {
      target: { value: "2026-11-16T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Fin de vigencia (opcional)"), {
      target: { value: "2026-11-22T21:00" },
    });

    fireEvent.click(screen.getByLabelText("POS"));

    const addVariantBtn = await screen.findByRole("button", { name: /\+ Negro \(ACC-001-NEG\)/ });
    fireEvent.click(addVariantBtn);

    fireEvent.click(screen.getByRole("button", { name: "Guardar promoción" }));

    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith("upsert_promotion", {
        p_id: null,
        p_name: "Cyber Fundas",
        p_kind: "precio_fijo",
        p_value: 18500.5,
        p_starts_at: localDateTimeToIso("2026-11-16T09:00"),
        p_ends_at: localDateTimeToIso("2026-11-22T21:00"),
        p_is_active: true,
        p_channels: ["web"],
        p_targets: [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID }],
      }),
    );
  });

  it("edita una promoción existente enviando su p_id", async () => {
    renderPanel();
    await screen.findByText("Semana Tech");

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    const nameInput = await screen.findByLabelText("Nombre de la promoción");
    expect(nameInput).toHaveValue("Semana Tech");
    fireEvent.change(nameInput, { target: { value: "Semana Tech Extendida" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith(
        "upsert_promotion",
        expect.objectContaining({
          p_id: PROMO_ID,
          p_name: "Semana Tech Extendida",
        }),
      ),
    );
  });

  it("desactiva una promoción llamando a set_promotion_active", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: null });
    renderPanel();
    await screen.findByText("Semana Tech");

    fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));

    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith("set_promotion_active", {
        p_id: PROMO_ID,
        p_active: false,
      }),
    );
  });

  it("oculta las acciones de gestión cuando falta el permiso pricing.manage", async () => {
    renderPanel(["pricing.view"]);
    await screen.findByText("Semana Tech");

    expect(screen.queryByRole("button", { name: "Nueva promoción" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar" })).not.toBeInTheDocument();
  });
});
