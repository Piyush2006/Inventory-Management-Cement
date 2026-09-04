import { prisma } from "@/lib/db";
import { IN_TRANSIT_LOCATION_TYPE } from "@/lib/domain/enums";
import { classifyStockStatus } from "@/lib/inventory/status";
import { computeDaysOfCover } from "@/lib/inventory/daysOfCover";

// Small queries Bruce AI needs that don't already exist as a reusable single-material/whole-
// catalog function elsewhere — same batched shape dashboard.ts/inventory/page.tsx already use
// (active materials + balances + quality balances in one pass), not a new data model.

export async function getMaterialsByStatus(status: "LOW" | "CRITICAL") {
  const materials = await prisma.material.findMany({
    where: { active: true },
    include: { balances: { where: { location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } } } },
  });
  const qualityBalances = await prisma.qualityBalance.findMany({ where: { materialId: { in: materials.map((m) => m.id) } } });
  const heldByMaterial = new Map<string, number>();
  for (const q of qualityBalances) heldByMaterial.set(q.materialId, (heldByMaterial.get(q.materialId) ?? 0) + q.quantity);

  return materials
    .map((m) => {
      const onHand = m.balances.reduce((s, b) => s + b.quantity, 0);
      const unrestricted = Math.max(0, onHand - (heldByMaterial.get(m.id) ?? 0));
      const { status: s } = classifyStockStatus({ currentStock: unrestricted, minStock: m.minStock });
      return { material: m, unrestricted, status: s };
    })
    .filter((r) => r.status === status);
}

export async function getStockAtLocation(locationId: string) {
  const balances = await prisma.inventoryBalance.findMany({
    where: { locationId, quantity: { gt: 1e-6 } },
    include: { material: true },
    orderBy: { quantity: "desc" },
  });
  return balances.map((b) => ({ materialId: b.materialId, materialName: b.material.name, uom: b.material.uom, quantity: b.quantity }));
}

export async function getQualityHeld(status: "QC_HOLD" | "BLOCKED", materialId?: string) {
  const rows = await prisma.qualityBalance.findMany({
    where: { status, ...(materialId ? { materialId } : {}) },
    include: { material: true },
  });
  const byMaterial = new Map<string, { materialName: string; uom: string; quantity: number }>();
  for (const r of rows) {
    const entry = byMaterial.get(r.materialId) ?? { materialName: r.material.name, uom: r.material.uom, quantity: 0 };
    entry.quantity += r.quantity;
    byMaterial.set(r.materialId, entry);
  }
  return [...byMaterial.entries()].map(([materialId, v]) => ({ materialId, ...v })).sort((a, b) => b.quantity - a.quantity);
}

/** Days of Cover across the whole active catalog, ascending (soonest to run out first) — small enough scale for one call per chat question, not a batched loop elsewhere. */
export async function getLowestDaysOfCover(limit = 5) {
  const materials = await prisma.material.findMany({ where: { active: true } });
  const results = await Promise.all(materials.map((m) => computeDaysOfCover(m.id).then((r) => ({ material: m, ...r }))));
  return results
    .filter((r) => !r.na && r.daysCover != null)
    .sort((a, b) => a.daysCover! - b.daysCover!)
    .slice(0, limit);
}
