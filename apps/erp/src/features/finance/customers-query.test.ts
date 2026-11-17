import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCustomers } from "./api";

const { fromMock, eqMock } = vi.hoisted(() => {
  const orderMock = vi.fn(async () => ({ data: [], error: null }));
  const eqMock = vi.fn(() => ({ order: orderMock }));
  const fromMock = vi.fn(() => ({
    select: vi.fn(() => ({ eq: eqMock })),
  }));

  return { fromMock, eqMock };
});

vi.mock("../../lib/supabase", () => ({
  supabase: { from: fromMock },
}));

describe("finance customer options", () => {
  beforeEach(() => {
    fromMock.mockClear();
    eqMock.mockClear();
  });

  it("only lists active customers for financing", async () => {
    await listCustomers();

    expect(fromMock).toHaveBeenCalledWith("customers");
    expect(eqMock).toHaveBeenCalledWith("is_active", true);
  });
});
