import { prisma } from "@/lib/db";
import { getTotalUnrestrictedAvailable } from "@/lib/inventory/quality";
import { classifyStockStatus } from "@/lib/inventory/status";
import { triggerNotification } from "./engine";

const SEVERITY: Record<string, number> = { HEALTHY: 0, LOW: 1, CRITICAL: 2 };

/**
 * Fires STOCK_LOW / STOCK_CRITICAL only on a WORSENING transition (HEALTHY->LOW, HEALTHY->
 * CRITICAL, LOW->CRITICAL), not on every balance-changing action while a material is already at
 * that level — MaterialAlertState.lastStatus is the transition memory. Call after any action
 * that can move a material's network-wide unrestricted total (Consume/Transfer/Adjustment/GRN
 * post/Dispatch/Request delivery legs). Same single-material classifyStockStatus +
 * getTotalUnrestrictedAvailable pattern already used at
 * src/app/inventory/[materialId]/page.tsx — not the batched dashboard.ts variant, which
 * deliberately avoids per-material calls across the WHOLE catalog (a different N+1 concern that
 * doesn't apply to a single call after a single action).
 */
export async function checkStockThresholds(materialId: string): Promise<void> {
  try {
    const material = await prisma.material.findUnique({ where: { id: materialId } });
    if (!material) return;
    // A material with neither threshold set can never be classified LOW/CRITICAL — skip
    // entirely rather than writing a permanently-HEALTHY MaterialAlertState row on every call.
    if (material.minStock == null && material.safetyStock == null) return;

    const currentStock = await getTotalUnrestrictedAvailable(materialId);
    const { status } = classifyStockStatus({ currentStock, minStock: material.minStock, safetyStock: material.safetyStock });

    const previous = await prisma.materialAlertState.findUnique({ where: { materialId } });
    const lastStatus = previous?.lastStatus ?? "HEALTHY";

    if (SEVERITY[status] > SEVERITY[lastStatus]) {
      const event = status === "CRITICAL" ? "STOCK_CRITICAL" : status === "LOW" ? "STOCK_LOW" : null;
      if (event) {
        await triggerNotification(event, {
          recordId: material.id,
          materialId: material.id,
          currentStock,
          minimumStock: status === "CRITICAL" ? (material.safetyStock ?? undefined) : (material.minStock ?? undefined),
          link: `/inventory/${material.id}`,
        });
      }
    }

    if (status !== lastStatus) {
      await prisma.materialAlertState.upsert({
        where: { materialId },
        create: { materialId, lastStatus: status },
        update: { lastStatus: status },
      });
    }
  } catch (e) {
    console.error(`[notifications] checkStockThresholds(${materialId}) failed — ignored`, e);
  }
}
