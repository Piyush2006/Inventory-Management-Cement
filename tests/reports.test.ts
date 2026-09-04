import { describe, it, expect } from "vitest";
import { postMovement, postTransfer, postTransferOut, postAdjustment } from "@/lib/inventory/ledger";
import { getInventoryReport } from "@/lib/reports/inventory";
import { getConsumptionReport } from "@/lib/reports/consumption";
import { getRequestReport, getDispatchReport } from "@/lib/reports/requestDispatch";
import { makeLocation, makeMaterial, makeUser } from "./helpers";

// getInventoryReport queries every active material by default, and vitest shares one SQLite
// file across test files (fileParallelism: false) — so every assertion here passes an explicit
// materialId filter to isolate the material this test created, same defensive pattern used in
// tests/insights.test.ts.

describe("Inventory Report — ledger reconstruction", () => {
  it("computes Opening/Received/Consumed/Closing for a plain receipt + consumption", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    const day0 = new Date(Date.now() - 10 * 86400000);
    const from = new Date(Date.now() - 5 * 86400000);
    const to = new Date();

    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 1000, uom: "MT", locationId: location.id, timestamp: day0 }); // before `from` -> opening
    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 300, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 3 * 86400000) });
    await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 200, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 2 * 86400000) });

    const report = await getInventoryReport({ from, to, materialId: material.id });
    const row = report.materialRows.find((r) => r.materialId === material.id)!;
    expect(row.opening).toBeCloseTo(1000, 6);
    expect(row.received).toBeCloseTo(300, 6);
    expect(row.consumed).toBeCloseTo(200, 6);
    expect(row.closing).toBeCloseTo(1100, 6);
    // Identity holds by construction.
    expect(row.opening + row.received + row.transferIn - row.consumed - row.transferOut - row.dispatched + row.adjustments).toBeCloseTo(row.closing, 6);
  });

  it("nets a plain TRANSFER to zero plant-wide, but shows non-zero when location-filtered", async () => {
    const from = await makeLocation();
    const to = await makeLocation();
    const material = await makeMaterial();
    const rangeFrom = new Date(Date.now() - 5 * 86400000);
    const rangeTo = new Date();

    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 500, uom: "MT", locationId: from.id, timestamp: new Date(Date.now() - 10 * 86400000) });
    await postTransfer({ materialId: material.id, quantity: 150, uom: "MT", sourceLocationId: from.id, destinationLocationId: to.id, timestamp: new Date(Date.now() - 2 * 86400000) });

    const plantWide = await getInventoryReport({ from: rangeFrom, to: rangeTo, materialId: material.id });
    const plantRow = plantWide.materialRows.find((r) => r.materialId === material.id)!;
    expect(plantRow.transferIn).toBeCloseTo(150, 6);
    expect(plantRow.transferOut).toBeCloseTo(150, 6);
    expect(plantRow.closing).toBeCloseTo(500, 6); // unchanged plant-wide — it only moved location

    const filteredToSource = await getInventoryReport({ from: rangeFrom, to: rangeTo, materialId: material.id, locationId: from.id });
    const sourceRow = filteredToSource.materialRows.find((r) => r.materialId === material.id)!;
    expect(sourceRow.transferOut).toBeCloseTo(150, 6);
    expect(sourceRow.transferIn).toBeCloseTo(0, 6);
    expect(sourceRow.closing).toBeCloseTo(350, 6); // 500 - 150, only this location's leg
  });

  it("handles an in-flight TRANSFER_OUT with no matching TRANSFER_IN yet — the gap sits in the excluded in-transit bucket", async () => {
    const source = await makeLocation();
    const material = await makeMaterial();
    const rangeFrom = new Date(Date.now() - 5 * 86400000);
    const rangeTo = new Date();

    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 400, uom: "MT", locationId: source.id, timestamp: new Date(Date.now() - 10 * 86400000) });
    await postTransferOut({ materialId: material.id, quantity: 100, uom: "MT", sourceLocationId: source.id, timestamp: new Date(Date.now() - 1 * 86400000) });

    const report = await getInventoryReport({ from: rangeFrom, to: rangeTo, materialId: material.id });
    const row = report.materialRows.find((r) => r.materialId === material.id)!;
    expect(row.transferOut).toBeCloseTo(100, 6);
    expect(row.transferIn).toBeCloseTo(0, 6); // no matching TRANSFER_IN posted yet
    expect(row.closing).toBeCloseTo(300, 6); // the 100 left this location for the (excluded) in-transit bucket
  });

  it("folds an OPENING_BALANCE landing inside the window into Received, keeping the identity exact", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    const rangeFrom = new Date(Date.now() - 5 * 86400000);
    const rangeTo = new Date();

    // No prior history — the material's seed date itself falls inside the selected window.
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 700, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 2 * 86400000) });

    const report = await getInventoryReport({ from: rangeFrom, to: rangeTo, materialId: material.id });
    const row = report.materialRows.find((r) => r.materialId === material.id)!;
    expect(row.opening).toBeCloseTo(0, 6);
    expect(row.received).toBeCloseTo(700, 6);
    expect(row.closing).toBeCloseTo(700, 6);
  });

  it("reflects a negative Adjustment as a signed reduction, not a positive magnitude", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    const rangeFrom = new Date(Date.now() - 5 * 86400000);
    const rangeTo = new Date();

    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 600, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 10 * 86400000) });
    await postAdjustment({ materialId: material.id, locationId: location.id, quantity: -50, uom: "MT", reason: "Shrinkage found during count", timestamp: new Date(Date.now() - 1 * 86400000) });

    const report = await getInventoryReport({ from: rangeFrom, to: rangeTo, materialId: material.id });
    const row = report.materialRows.find((r) => r.materialId === material.id)!;
    expect(row.adjustments).toBeCloseTo(-50, 6);
    expect(row.closing).toBeCloseTo(550, 6);
  });
});

describe("Consumption Report", () => {
  it("computes average daily consumption over the inclusive calendar-day span, not just days with data", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    const from = new Date(Date.now() - 9 * 86400000); // 10 inclusive days through "now"
    const to = new Date();

    // Only 2 of the 10 days actually have a posted consumption row.
    await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 60, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 5 * 86400000) });
    await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 40, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 3 * 86400000) });

    const report = await getConsumptionReport({ from, to, materialId: material.id });
    const row = report.aggregateRows.find((r) => r.materialId === material.id)!;
    expect(row.totalConsumed).toBeCloseTo(100, 6);
    expect(row.averageDailyConsumption).toBeCloseTo(10, 6); // 100 / 10 calendar days, not 100 / 2
  });
});

describe("Request & Dispatch Report — status filter and RBAC scoping", () => {
  it("a Dispatch-only status value does not silently zero out the Request table", async () => {
    const requester = await makeUser({ role: "REQUESTER" });
    const from = await makeLocation();
    const to = await makeLocation();
    const material = await makeMaterial();
    const { createStockRequest } = await import("@/lib/inventory/requests");
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });

    // "DISPATCHED" is a Dispatch status, not a Request status — getRequestReport must ignore it
    // rather than passing it straight to `where: { status }` and returning nothing.
    const report = await getRequestReport({ status: "DISPATCHED", reference: request.requestNumber });
    expect(report.rows.some((r) => r.id === request.id)).toBe(true);
  });

  it("a Request-only status value does not silently zero out the Dispatch table", async () => {
    const supervisor = await makeUser({ role: "STORE_SUPERVISOR" });
    const location = await makeLocation();
    const material = await makeMaterial();
    const { createDispatch } = await import("@/lib/inventory/dispatch");
    const dispatch = await createDispatch({ materialId: material.id, quantity: 10, sourceLocationId: location.id, customerDestination: "Test Customer", createdByUserId: supervisor.id });

    const report = await getDispatchReport({ status: "NEW_REQUEST", reference: dispatch.dispatchReference });
    expect(report.rows.some((r) => r.id === dispatch.id)).toBe(true);
  });

  it("scopes to assignedToUserId only when explicitly requested (Store Operator RBAC)", async () => {
    const operatorA = await makeUser({ role: "STORE_OPERATOR" });
    const operatorB = await makeUser({ role: "STORE_OPERATOR" });
    const supervisor = await makeUser({ role: "STORE_SUPERVISOR" });
    const requester = await makeUser({ role: "REQUESTER" });
    const from = await makeLocation();
    const to = await makeLocation();
    const material = await makeMaterial();
    const { createStockRequest, acceptStockRequest, routeToSupervisor, assignOperator } = await import("@/lib/inventory/requests");
    const manager = await makeUser({ role: "INVENTORY_MANAGER" });
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operatorA.id, supervisor.id);

    const scopedToA = await getRequestReport({ reference: request.requestNumber }, operatorA.id);
    expect(scopedToA.rows.some((r) => r.id === request.id)).toBe(true);

    const scopedToB = await getRequestReport({ reference: request.requestNumber }, operatorB.id);
    expect(scopedToB.rows.some((r) => r.id === request.id)).toBe(false);

    const unscoped = await getRequestReport({ reference: request.requestNumber });
    expect(unscoped.rows.some((r) => r.id === request.id)).toBe(true);
  });

  it("scopes to requestedByUserId when scopeField is explicitly 'requestedByUserId' (Indentor/Requester RBAC)", async () => {
    const requesterA = await makeUser({ role: "REQUESTER" });
    const requesterB = await makeUser({ role: "REQUESTER" });
    const from = await makeLocation();
    const to = await makeLocation();
    const material = await makeMaterial();
    const { createStockRequest } = await import("@/lib/inventory/requests");
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requesterA.id });

    const scopedToA = await getRequestReport({ reference: request.requestNumber }, requesterA.id, "requestedByUserId");
    expect(scopedToA.rows.some((r) => r.id === request.id)).toBe(true);

    const scopedToB = await getRequestReport({ reference: request.requestNumber }, requesterB.id, "requestedByUserId");
    expect(scopedToB.rows.some((r) => r.id === request.id)).toBe(false);
  });
});
