import type { TransactionType } from "@/lib/domain/enums";

// Friendly filter buckets over the real TransactionType enum — UI labeling only, no new
// transaction type is introduced. "Transfer" covers all three transfer-shaped ledger types
// (TRANSFER from Stock Operations, TRANSFER_OUT/TRANSFER_IN from the Request delivery flow).
export const OPERATION_GROUPS: { key: string; label: string; types: TransactionType[] }[] = [
  { key: "RECEIVE", label: "Receive", types: ["RECEIPT", "OPENING_BALANCE"] },
  { key: "CONSUME", label: "Consume", types: ["CONSUMPTION"] },
  { key: "TRANSFER", label: "Transfer", types: ["TRANSFER", "TRANSFER_OUT", "TRANSFER_IN"] },
  { key: "DISPATCH", label: "Dispatch", types: ["DISPATCH"] },
  { key: "ADJUSTMENT", label: "Adjustment", types: ["ADJUSTMENT"] },
];

export function operationGroupTypes(key: string | undefined): TransactionType[] | null {
  if (!key) return null;
  return OPERATION_GROUPS.find((g) => g.key === key)?.types ?? null;
}

export function operationLabelForType(type: string): string {
  return OPERATION_GROUPS.find((g) => (g.types as string[]).includes(type))?.label ?? type;
}
