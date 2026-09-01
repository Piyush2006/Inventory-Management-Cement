import { prisma } from "@/lib/db";
import { getTotalOnHand } from "@/lib/inventory/balance";

export interface DaysOfCoverResult {
  currentStock: number;
  dailyConsumption: number;
  daysCover: number | null;
  na: boolean;
  naReason?: string;
  explanation: string;
}

/**
 * Informational days-of-cover: current stock ÷ average daily CONSUMPTION over
 * the trailing 30 days, read directly from the ledger (no separate consumption
 * table to fall out of sync with). Never divides by zero — returns N/A instead.
 */
export async function computeDaysOfCover(materialId: string, windowDays = 30): Promise<DaysOfCoverResult> {
  const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });
  const currentStock = await getTotalOnHand(materialId);

  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const consumed = await prisma.inventoryTransaction.aggregate({
    where: { materialId, transactionType: "CONSUMPTION", timestamp: { gte: since } },
    _sum: { quantity: true },
  });
  const dailyConsumption = (consumed._sum.quantity ?? 0) / windowDays;

  if (dailyConsumption <= 1e-9) {
    return {
      currentStock,
      dailyConsumption: 0,
      daysCover: null,
      na: true,
      naReason: "NO_CONSUMPTION_DATA",
      explanation: `No consumption recorded for ${material.name} in the last ${windowDays} days, so days of cover can't be calculated.`,
    };
  }

  const daysCover = currentStock / dailyConsumption;
  return {
    currentStock,
    dailyConsumption,
    daysCover,
    na: false,
    explanation: `${currentStock.toLocaleString()} ${material.uom} on hand ÷ ${dailyConsumption.toFixed(1)} ${material.uom}/day (${windowDays}-day average consumption) = ${daysCover.toFixed(1)} days.`,
  };
}
