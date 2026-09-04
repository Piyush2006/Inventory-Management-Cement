import { prisma } from "@/lib/db";

let counter = 0;
function uid(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function makeLocation(overrides: Partial<{ name: string; type: string; capacity: number }> = {}) {
  return prisma.location.create({
    data: {
      name: overrides.name ?? uid("LOC"),
      type: overrides.type ?? "STORE",
      capacity: overrides.capacity,
    },
  });
}

export async function makeMaterial(overrides: Partial<{
  materialCode: string; name: string; category: string; uom: string; minStock: number; safetyStock: number;
  defaultLocationId: string; tolerancePct: number;
}> = {}) {
  return prisma.material.create({
    data: {
      materialCode: overrides.materialCode ?? uid("MAT"),
      name: overrides.name ?? "Test Material",
      category: overrides.category ?? "RAW_MATERIAL",
      uom: overrides.uom ?? "MT",
      minStock: overrides.minStock,
      safetyStock: overrides.safetyStock,
      defaultLocationId: overrides.defaultLocationId,
      tolerancePct: overrides.tolerancePct,
    },
  });
}

export async function getBalance(materialId: string, locationId: string) {
  const row = await prisma.inventoryBalance.findUnique({ where: { materialId_locationId: { materialId, locationId } } });
  return row?.quantity ?? 0;
}

export async function makeUser(overrides: Partial<{ name: string; role: string; email: string }> = {}) {
  return prisma.user.create({
    data: {
      name: overrides.name ?? uid("User"),
      role: overrides.role ?? "REQUESTER",
      email: overrides.email,
    },
  });
}
