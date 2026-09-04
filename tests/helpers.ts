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
  materialCode: string; name: string; category: string; uom: string; minStock: number; maxStock: number;
  defaultLocationId: string; tolerancePct: number;
}> = {}) {
  return prisma.material.create({
    data: {
      materialCode: overrides.materialCode ?? uid("MAT"),
      name: overrides.name ?? "Test Material",
      category: overrides.category ?? "RAW_MATERIAL",
      uom: overrides.uom ?? "MT",
      minStock: overrides.minStock,
      maxStock: overrides.maxStock,
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

// Creates a StockRequest directly at "already issued" state (requestType=SPARE, purpose=ISSUE,
// deliveredQuantity set) — skips replaying the full accept/route/assign/startDelivery lifecycle,
// which postSpareReturn doesn't touch or depend on beyond requestType/purpose/materialId/deliveredQuantity.
export async function makeSpareIssueRequest(overrides: {
  materialId: string;
  fromLocationId: string;
  requestedByUserId: string;
  deliveredQuantity?: number;
  quantityRequested?: number;
}) {
  return prisma.stockRequest.create({
    data: {
      requestNumber: uid("REQ"),
      materialId: overrides.materialId,
      quantityRequested: overrides.quantityRequested ?? overrides.deliveredQuantity ?? 1,
      deliveredQuantity: overrides.deliveredQuantity ?? 1,
      requiredByDate: new Date(),
      fromLocationId: overrides.fromLocationId,
      requestType: "SPARE",
      purpose: "ISSUE",
      issuedTo: "Test crew",
      requestedByUserId: overrides.requestedByUserId,
      requestedByRole: "REQUESTER",
      status: "COMPLETED",
    },
  });
}
