import type { StockStatus } from "@/lib/domain/enums";

/**
 * CRITICAL: stock < minimum stock. HEALTHY: otherwise. Shared by Dashboard, Inventory, and
 * Material Detail so every screen agrees. `overstock` is a separate, independent flag (stock >
 * maximum stock) — it never changes `status`, so a material can be simultaneously HEALTHY and
 * overstocked. maxStock is optional; callers that don't pass it just never see overstock: true.
 */
export function classifyStockStatus(args: {
  currentStock: number;
  minStock: number | null | undefined;
  maxStock?: number | null;
}): { status: StockStatus; reason: string; overstock: boolean } {
  const { currentStock, minStock, maxStock } = args;
  const overstock = maxStock != null && currentStock > maxStock;

  if (minStock != null && currentStock < minStock) {
    return { status: "CRITICAL", reason: `Current stock (${currentStock.toLocaleString()}) is below minimum stock (${minStock.toLocaleString()}).`, overstock };
  }
  return { status: "HEALTHY", reason: "Current stock is at or above minimum stock.", overstock };
}
