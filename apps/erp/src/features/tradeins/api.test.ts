import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listRecentBranchRepairOrders,
  listRecentBranchSales,
  listTradeInLocations,
} from "./api";

const BRANCH_1 = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_1 = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_2 = "22222222-2222-4222-8222-222222222223";
const SALE_1 = "77777777-7777-4777-8777-777777777771";
const SALE_2 = "77777777-7777-4777-8777-777777777772";
const SALE_CANCELLED = "77777777-7777-4777-8777-777777777773";
const SALE_OTHER_CUSTOMER = "77777777-7777-4777-8777-777777777774";
const REPAIR_DELIVERED = "99999999-9999-4999-8999-999999999991";
const REPAIR_OPEN = "99999999-9999-4999-8999-999999999992";
const REPAIR_OTHER_CUSTOMER = "99999999-9999-4999-8999-999999999993";

interface RecordedQuery {
  table: string;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  nots: Array<[string, string, unknown]>;
}

const mock = vi.hoisted(() => ({
  locations: [] as Array<{
    id: string;
    branch_id: string;
    name: string;
    is_active: boolean;
    allows_sale: boolean;
  }>,
  sales: [] as Array<{
    id: string;
    branch_id: string;
    customer_id: string | null;
    confirmed_at: string;
    total_amount: number;
    exchange_rate: number;
    currency_code: string;
    customers: { display_name: string | null } | null;
  }>,
  saleStateEvents: [] as Array<{
    sale_id: string;
    sale_state: string | null;
  }>,
  documents: [] as Array<{
    owner_type: string;
    owner_id: string;
    document_number: string;
    issued_at: string;
  }>,
  repairOrders: [] as Array<{
    id: string;
    branch_id: string;
    customer_id: string | null;
    order_code: string;
    opened_at: string | null;
    customer_name: string | null;
    brand_snapshot: string | null;
    model_snapshot: string | null;
    status_name: string | null;
    delivery_id: string | null;
  }>,
  queries: [] as RecordedQuery[],
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const recorded: RecordedQuery = { table, eqs: [], ins: [], nots: [] };
      mock.queries.push(recorded);

      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          recorded.eqs.push([column, value]);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          recorded.ins.push([column, values]);
          return chain;
        },
        not: (column: string, operator: string, value: unknown) => {
          recorded.nots.push([column, operator, value]);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const matchesEq = (row: Record<string, unknown>) =>
            recorded.eqs.every(([col, val]) => row[col] === val);
          const matchesIn = (row: Record<string, unknown>) =>
            recorded.ins.every(([col, vals]) => vals.includes(row[col]));
          const matchesNot = (row: Record<string, unknown>) =>
            recorded.nots.every(([col, op, val]) => {
              if (op === "is" && val === null) return row[col] !== null && row[col] !== undefined;
              return row[col] !== val;
            });
          const applyFilters = <T extends Record<string, unknown>>(rows: T[]): T[] =>
            rows.filter((row) => matchesEq(row) && matchesIn(row) && matchesNot(row));

          let data: unknown[] = [];
          if (table === "locations") data = applyFilters(mock.locations);
          else if (table === "sales") data = applyFilters(mock.sales);
          else if (table === "sale_state_events") data = applyFilters(mock.saleStateEvents);
          else if (table === "documents") data = applyFilters(mock.documents);
          else if (table === "repair_orders_overview") data = applyFilters(mock.repairOrders);

          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

describe("tradeins select API filters", () => {
  beforeEach(() => {
    mock.queries = [];
    mock.locations = [
      {
        id: "loc-quarantine",
        branch_id: BRANCH_1,
        name: "Cuarentena de canjes",
        is_active: true,
        allows_sale: false,
      },
      {
        id: "loc-sale",
        branch_id: BRANCH_1,
        name: "Depósito Central",
        is_active: true,
        allows_sale: true,
      },
      {
        id: "loc-inactive",
        branch_id: BRANCH_1,
        name: "Depósito Inactivo",
        is_active: false,
        allows_sale: true,
      },
    ];
    mock.sales = [
      {
        id: SALE_1,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        confirmed_at: "2026-11-18T14:00:00Z",
        total_amount: 850000,
        exchange_rate: 1,
        currency_code: "ARS",
        customers: { display_name: "Ana Pérez" },
      },
      {
        id: SALE_2,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        confirmed_at: "2026-11-18T12:00:00Z",
        total_amount: 1000,
        exchange_rate: 1200,
        currency_code: "USD",
        customers: { display_name: "Ana Pérez" },
      },
      {
        id: SALE_CANCELLED,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        confirmed_at: "2026-11-18T11:00:00Z",
        total_amount: 500000,
        exchange_rate: 1,
        currency_code: "ARS",
        customers: { display_name: "Ana Pérez" },
      },
      {
        id: SALE_OTHER_CUSTOMER,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_2,
        confirmed_at: "2026-11-18T15:00:00Z",
        total_amount: 400000,
        exchange_rate: 1,
        currency_code: "ARS",
        customers: { display_name: "Otro Cliente" },
      },
    ];
    mock.saleStateEvents = [{ sale_id: SALE_CANCELLED, sale_state: "cancelled" }];
    mock.documents = [
      {
        owner_type: "sale",
        owner_id: SALE_1,
        document_number: "NF-00000042",
        issued_at: "2026-11-18T14:00:00Z",
      },
      {
        owner_type: "sale",
        owner_id: SALE_1,
        document_number: "F-00000099",
        issued_at: "2026-11-18T14:05:00Z",
      },
    ];
    mock.repairOrders = [
      {
        id: REPAIR_DELIVERED,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        order_code: "REP-0015",
        opened_at: "2026-11-17T10:00:00Z",
        customer_name: "Ana Pérez",
        brand_snapshot: "Apple",
        model_snapshot: "iPhone 13",
        status_name: "Entregado",
        delivery_id: "del-1",
      },
      {
        id: REPAIR_OPEN,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_1,
        order_code: "REP-0016",
        opened_at: "2026-11-18T10:00:00Z",
        customer_name: "Ana Pérez",
        brand_snapshot: "Samsung",
        model_snapshot: "S23",
        status_name: "En taller",
        delivery_id: null,
      },
      {
        id: REPAIR_OTHER_CUSTOMER,
        branch_id: BRANCH_1,
        customer_id: CUSTOMER_2,
        order_code: "REP-0017",
        opened_at: "2026-11-18T11:00:00Z",
        customer_name: "Otro Cliente",
        brand_snapshot: "Apple",
        model_snapshot: "iPhone 14",
        status_name: "Entregado",
        delivery_id: "del-2",
      },
    ];
  });

  it("listTradeInLocations filtra por is_active=true y allows_sale=true", async () => {
    const locations = await listTradeInLocations();

    expect(mock.queries).toHaveLength(1);
    expect(mock.queries[0].table).toBe("locations");
    expect(mock.queries[0].eqs).toEqual([
      ["is_active", true],
      ["allows_sale", true],
    ]);
    expect(locations.map((l) => l.id)).toEqual(["loc-sale"]);
  });

  it("listRecentBranchSales filtra por branch_id, customer_id, excluye ventas anuladas, no duplica documentos y respalda ventas sin comprobante", async () => {
    const sales = await listRecentBranchSales(BRANCH_1, CUSTOMER_1);

    const salesQuery = mock.queries.find((q) => q.table === "sales");
    expect(salesQuery?.eqs).toEqual([
      ["branch_id", BRANCH_1],
      ["customer_id", CUSTOMER_1],
    ]);

    const stateQuery = mock.queries.find((q) => q.table === "sale_state_events");
    expect(stateQuery?.eqs).toEqual([["sale_state", "cancelled"]]);

    expect(sales).toEqual([
      {
        saleId: SALE_1,
        documentNumber: "NF-00000042",
        issuedAt: "2026-11-18T14:00:00Z",
        customerName: "Ana Pérez",
        totalArs: 850000,
      },
      {
        saleId: SALE_2,
        documentNumber: `Venta ${SALE_2.slice(0, 8).toUpperCase()}`,
        issuedAt: "2026-11-18T12:00:00Z",
        customerName: "Ana Pérez",
        totalArs: 1200000,
      },
    ]);
  });

  it("listRecentBranchRepairOrders filtra por branch_id, customer_id y delivery_id not null", async () => {
    const orders = await listRecentBranchRepairOrders(BRANCH_1, CUSTOMER_1);

    expect(mock.queries).toHaveLength(1);
    expect(mock.queries[0].table).toBe("repair_orders_overview");
    expect(mock.queries[0].eqs).toEqual([
      ["branch_id", BRANCH_1],
      ["customer_id", CUSTOMER_1],
    ]);
    expect(mock.queries[0].nots).toEqual([["delivery_id", "is", null]]);
    expect(orders.map((o) => o.id)).toEqual([REPAIR_DELIVERED]);
  });
});
