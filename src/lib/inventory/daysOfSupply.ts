import { prisma } from "@/lib/db";
import { getTotalUnrestrictedAvailable } from "@/lib/inventory/quality";

export interface DaysOfSupplyResult {
  currentStock: number; // Unrestricted (usable) stock — excludes QC Hold/Blocked
  dailyConsumption: number;
  total30Day: number;
  daysSupply: number | null;
  na: boolean;
  naReason?: string;
  explanation: string;
}

/**
 * Informational days-of-supply: usable (Unrestricted) stock ÷ average daily CONSUMPTION over
 * the trailing 30 days, read directly from the ledger (no separate consumption table to fall
 * out of sync with). QC Hold/Blocked stock is excluded from the numerator — it isn't usable,
 * so it can't count toward how many days the plant is actually supplied for. Never divides by
 * zero — returns N/A instead.
 */
export async function computeDaysOfSupply(materialId: string, windowDays = 30): Promise<DaysOfSupplyResult> {
  const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });
  const currentStock = await getTotalUnrestrictedAvailable(materialId);

  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const consumed = await prisma.inventoryTransaction.aggregate({
    where: { materialId, transactionType: "CONSUMPTION", timestamp: { gte: since } },
    _sum: { quantity: true },
  });
  const total30Day = consumed._sum.quantity ?? 0;
  const dailyConsumption = total30Day / windowDays;

  if (dailyConsumption <= 1e-9) {
    return {
      currentStock,
      dailyConsumption: 0,
      total30Day,
      daysSupply: null,
      na: true,
      naReason: "NO_CONSUMPTION_DATA",
      explanation: `No consumption recorded for ${material.name} in the last ${windowDays} days, so days of supply can't be calculated.`,
    };
  }

  const daysSupply = currentStock / dailyConsumption;
  return {
    currentStock,
    dailyConsumption,
    total30Day,
    daysSupply,
    na: false,
    explanation: `${currentStock.toLocaleString()} ${material.uom} unrestricted ÷ ${dailyConsumption.toFixed(1)} ${material.uom}/day (${windowDays}-day average consumption) = ${daysSupply.toFixed(1)} days.`,
  };
}
