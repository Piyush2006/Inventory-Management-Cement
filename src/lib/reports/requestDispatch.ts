import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { REQUEST_STATUSES, DISPATCH_STATUSES, REQUEST_PURPOSES, REQUEST_TYPES } from "@/lib/domain/enums";
import type { ReportFilters } from "./types";

export interface RequestReportRow {
  id: string;
  requestNumber: string;
  materialName: string;
  purpose: string;
  requestType: string;
  uom: string;
  quantityRequested: number;
  deliveredQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  status: string;
  requestedByName: string;
  assignedToName: string | null;
  requestedAt: Date;
  acceptedAt: Date | null;
  assignedAt: Date | null;
  inTransitAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
}

export interface DispatchReportRow {
  id: string;
  dispatchReference: string;
  materialName: string;
  category: string;
  uom: string;
  quantity: number;
  customerDestination: string;
  status: string;
  createdAt: Date;
  dispatchedAt: Date | null;
}

/**
 * Store Operator sees only its own requests/dispatches here — matching the existing scoping in
 * requests/page.tsx (Open/History tabs, not just actions) and movements/page.tsx's Dispatch
 * fetch. Reports must not grant a role more visibility than it already has elsewhere in the app.
 * Indentor (Requester) gets the same treatment via `scopeField: "requestedByUserId"` — their own
 * raised requests only, not the whole plant's.
 */
export async function getRequestReport(filters: ReportFilters, scopeToUserId?: string, scopeField: "assignedToUserId" | "requestedByUserId" = "assignedToUserId") {
  const status = filters.status && (REQUEST_STATUSES as readonly string[]).includes(filters.status) ? filters.status : undefined;
  const purpose = filters.purpose && (REQUEST_PURPOSES as readonly string[]).includes(filters.purpose) ? filters.purpose : undefined;
  const requestType = filters.requestType && (REQUEST_TYPES as readonly string[]).includes(filters.requestType) ? filters.requestType : undefined;
  const where: Prisma.StockRequestWhereInput = {
    ...(scopeToUserId ? { [scopeField]: scopeToUserId } : {}),
    ...(filters.materialId ? { materialId: filters.materialId } : {}),
    ...(status ? { status } : {}),
    ...(purpose ? { purpose } : {}),
    ...(requestType ? { requestType } : {}),
    ...(filters.reference ? { requestNumber: { contains: filters.reference } } : {}),
    ...(filters.userId ? { OR: [{ requestedByUserId: filters.userId }, { assignedToUserId: filters.userId }] } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };

  const requests = await prisma.stockRequest.findMany({
    where,
    include: { material: true, requestedBy: true, assignedTo: true },
    orderBy: { createdAt: "desc" },
  });

  // StockRequest has no inTransitAt column — that moment only exists as a RequestEvent row.
  const inTransitEvents = await prisma.requestEvent.findMany({
    where: { action: "IN_TRANSIT", stockRequestId: { in: requests.map((r) => r.id) } },
    select: { stockRequestId: true, timestamp: true },
    orderBy: { timestamp: "asc" },
  });
  const inTransitByRequest = new Map<string, Date>();
  for (const e of inTransitEvents) if (!inTransitByRequest.has(e.stockRequestId)) inTransitByRequest.set(e.stockRequestId, e.timestamp);

  const rows: RequestReportRow[] = requests.map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    materialName: r.material.name,
    purpose: r.purpose,
    requestType: r.requestType,
    uom: r.material.uom,
    quantityRequested: r.quantityRequested,
    deliveredQuantity: r.deliveredQuantity,
    receivedQuantity: r.receivedQuantity,
    remainingQuantity: Math.max(0, r.quantityRequested - r.receivedQuantity),
    status: r.status,
    requestedByName: r.requestedBy.name,
    assignedToName: r.assignedTo?.name ?? null,
    requestedAt: r.createdAt,
    acceptedAt: r.acceptedAt,
    assignedAt: r.assignedAt,
    inTransitAt: inTransitByRequest.get(r.id) ?? null,
    deliveredAt: r.deliveredAt,
    completedAt: r.completedAt,
  }));

  return { rows };
}

export async function getDispatchReport(filters: ReportFilters, scopeToUserId?: string) {
  const status = filters.status && (DISPATCH_STATUSES as readonly string[]).includes(filters.status) ? filters.status : undefined;
  const where: Prisma.DispatchWhereInput = {
    ...(scopeToUserId ? { assignedToUserId: scopeToUserId } : {}),
    ...(filters.materialId ? { materialId: filters.materialId } : {}),
    ...(filters.category ? { material: { category: filters.category } } : {}),
    ...(status ? { status } : {}),
    ...(filters.reference ? { dispatchReference: { contains: filters.reference } } : {}),
    ...(filters.userId ? { OR: [{ createdByUserId: filters.userId }, { assignedToUserId: filters.userId }] } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };

  const dispatches = await prisma.dispatch.findMany({
    where,
    include: { material: true },
    orderBy: { createdAt: "desc" },
  });

  const rows: DispatchReportRow[] = dispatches.map((d) => ({
    id: d.id,
    dispatchReference: d.dispatchReference,
    materialName: d.material.name,
    category: d.material.category,
    uom: d.material.uom,
    quantity: d.quantity,
    customerDestination: d.customerDestination,
    status: d.status,
    createdAt: d.createdAt,
    dispatchedAt: d.dispatchedAt,
  }));

  return { rows };
}
