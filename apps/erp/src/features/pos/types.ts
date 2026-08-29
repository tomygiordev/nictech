export type PosRegister = {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type PosSaleInput = {
  branchId: string;
  customerId: string;
  currency: string;
  exchangeSnapshotId: string;
  operationKey: string;
  reason: string;
  lines: Array<Record<string, unknown>>;
  paymentLines: Array<Record<string, unknown>>;
};
