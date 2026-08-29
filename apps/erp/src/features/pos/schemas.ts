import { z } from "zod";

const uuid = z.string().uuid();
const requiredText = z.string().trim().min(1);

export const saleSchema = z.object({
  branchId: uuid,
  customerId: uuid,
  currency: requiredText.max(3),
  exchangeSnapshotId: uuid,
  operationKey: requiredText.max(120),
  reason: requiredText.max(500),
});

export type SaleFormInput = z.infer<typeof saleSchema>;
