import type { StockStatus } from "@/lib/domain/enums";

/**
 * CRITICAL: stock < safety stock. LOW: stock < minimum stock. HEALTHY: otherwise.
 * Shared by Dashboard, Inventory, and Material Detail so every screen agrees.
 */
export function classifyStockStatus(args: { currentStock: number; minStock: number | null | undefined; safetyStock: number | null | undefined }): {
  status: StockStatus;
  reason: string;
} {
  const { currentStock, minStock, safetyStock } = args;

  if (safetyStock != null && currentStock < safetyStock) {
    return { status: "CRITICAL", reason: `Current stock (${currentStock.toLocaleString()}) is below safety stock (${safetyStock.toLocaleString()}).` };
  }
  if (minStock != null && currentStock < minStock) {
    return { status: "LOW", reason: `Current stock (${currentStock.toLocaleString()}) is below minimum stock (${minStock.toLocaleString()}).` };
  }
  return { status: "HEALTHY", reason: "Current stock is at or above minimum and safety stock." };
}
