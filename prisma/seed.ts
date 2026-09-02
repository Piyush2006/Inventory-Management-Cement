/* eslint-disable no-console */
import { prisma, ensureSqliteTuned } from "../src/lib/db";
import { postMovement, postTransfer } from "../src/lib/inventory/ledger";
import { recordPhysicalCount, postCountAdjustment } from "../src/lib/inventory/reconciliation";
import {
  createStockRequest,
  acceptStockRequest,
  rejectStockRequest,
  routeToSupervisor,
  assignOperator,
  startDelivery,
  markDelivered,
  confirmReceipt,
  markNotReceived,
} from "../src/lib/inventory/requests";
import { resolveSupplier, createPurchaseReference, createAndPostMaterialReceipt, createMaterialReceipt } from "../src/lib/inventory/procurement";
import { changeQualityStatus } from "../src/lib/inventory/quality";
import { createDispatch, approveDispatch, startDispatchLoading, markDispatched, cancelDispatch } from "../src/lib/inventory/dispatch";

async function main() {
  await ensureSqliteTuned();

  console.log("Wiping existing data...");
  await prisma.$transaction([
    prisma.dispatchEvent.deleteMany(),
    prisma.dispatch.deleteMany(),
    prisma.requestEvent.deleteMany(),
    prisma.stockReservation.deleteMany(),
    prisma.materialReceipt.deleteMany(),
    prisma.purchaseReference.deleteMany(),
    prisma.stockRequest.deleteMany(),
    prisma.physicalCount.deleteMany(),
    prisma.qualityStatusEvent.deleteMany(),
    prisma.qualityBalance.deleteMany(),
    prisma.inventoryTransaction.deleteMany(),
    prisma.inventoryBalance.deleteMany(),
    prisma.supplier.deleteMany(),
    prisma.user.deleteMany(),
    prisma.material.deleteMany(),
    prisma.location.deleteMany(),
  ]);

  console.log("Creating locations...");
  async function loc(name: string, type: string, capacity?: number) {
    return prisma.location.create({ data: { name, type, capacity } });
  }
  const limestoneStockpileA = await loc("Limestone Stockpile A", "STOCKPILE");
  const coalYard = await loc("Coal Yard", "YARD");
  const altFuelBunker = await loc("Alternative Fuel Bunker", "BUNKER");
  const clinkerStore = await loc("Clinker Store", "STORE");
  const gypsumStore = await loc("Gypsum Store", "STORE");
  const cementSilo1 = await loc("Cement Silo 1", "SILO", 5000);
  const cementSilo2 = await loc("Cement Silo 2", "SILO", 5000);
  const cementSilo3 = await loc("Cement Silo 3", "SILO", 2000);
  const packingArea = await loc("Packing Area", "WAREHOUSE");
  const baggedWarehouse = await loc("Bagged Warehouse", "WAREHOUSE");
  const maintenanceStore = await loc("Maintenance Store", "STORE");
  const cementMill1 = await loc("Cement Mill 1", "PRODUCTION_AREA");
  const kiln = await loc("Kiln", "PRODUCTION_AREA");

  console.log("Creating users...");
  const rahul = await prisma.user.create({ data: { name: "Rahul", role: "REQUESTER" } });
  const priya = await prisma.user.create({ data: { name: "Priya", role: "REQUESTER" } });
  const amit = await prisma.user.create({ data: { name: "Amit", role: "STORE_SUPERVISOR" } });
  const suresh = await prisma.user.create({ data: { name: "Suresh", role: "STORE_OPERATOR" } });
  const neha = await prisma.user.create({ data: { name: "Neha", role: "INVENTORY_MANAGER" } });
  await prisma.user.create({ data: { name: "Admin", role: "ADMIN" } });

  console.log("Creating materials...");
  async function mat(input: { code: string; name: string; category: string; uom: string; minStock?: number; safetyStock?: number; defaultLocationId?: string }) {
    return prisma.material.create({
      data: {
        materialCode: input.code, name: input.name, category: input.category, uom: input.uom,
        minStock: input.minStock, safetyStock: input.safetyStock, defaultLocationId: input.defaultLocationId,
      },
    });
  }
  const limestone = await mat({ code: "RM-LIM", name: "Limestone", category: "RAW_MATERIAL", uom: "MT", minStock: 10000, safetyStock: 8000, defaultLocationId: limestoneStockpileA.id });
  await mat({ code: "RM-SHL", name: "Shale", category: "RAW_MATERIAL", uom: "MT" });
  const ironCorrective = await mat({ code: "RM-IRC", name: "Iron Corrective", category: "RAW_MATERIAL", uom: "MT", minStock: 100, safetyStock: 40, defaultLocationId: maintenanceStore.id });
  const sand = await mat({ code: "RM-SND", name: "Sand", category: "RAW_MATERIAL", uom: "MT", minStock: 100, safetyStock: 40, defaultLocationId: maintenanceStore.id });
  const coal = await mat({ code: "FL-COL", name: "Coal", category: "FUEL", uom: "MT", minStock: 1000, safetyStock: 600, defaultLocationId: coalYard.id });
  const altFuel = await mat({ code: "FL-ALT", name: "Alternative Fuel", category: "FUEL", uom: "MT", minStock: 150, safetyStock: 100, defaultLocationId: altFuelBunker.id });
  const gypsum = await mat({ code: "AD-GYP", name: "Gypsum", category: "ADDITIVE", uom: "MT", minStock: 800, safetyStock: 500, defaultLocationId: gypsumStore.id });
  const flyAsh = await mat({ code: "AD-FLA", name: "Fly Ash", category: "ADDITIVE", uom: "MT", minStock: 100, safetyStock: 40, defaultLocationId: maintenanceStore.id });
  const slag = await mat({ code: "AD-SLG", name: "Slag", category: "ADDITIVE", uom: "MT", minStock: 100, safetyStock: 40, defaultLocationId: maintenanceStore.id });
  await mat({ code: "IN-RWM", name: "Raw Meal", category: "INTERMEDIATE", uom: "MT" });
  const clinker = await mat({ code: "IN-CLK", name: "Clinker", category: "INTERMEDIATE", uom: "MT", minStock: 2000, safetyStock: 1000, defaultLocationId: clinkerStore.id });
  const cementGp = await mat({ code: "FG-CGP", name: "Cement GP", category: "FINISHED_GOODS", uom: "MT", minStock: 1000, safetyStock: 500, defaultLocationId: cementSilo1.id });
  const cementGb = await mat({ code: "FG-CGB", name: "Cement GB", category: "FINISHED_GOODS", uom: "MT", minStock: 800, safetyStock: 400, defaultLocationId: cementSilo2.id });
  const cementHe = await mat({ code: "FG-CHE", name: "Cement HE", category: "FINISHED_GOODS", uom: "MT", minStock: 600, safetyStock: 200, defaultLocationId: cementSilo3.id });
  const cementBag = await mat({ code: "PK-BAG", name: "20 kg Cement Bag", category: "PACKING", uom: "Nos", minStock: 20000, safetyStock: 10000, defaultLocationId: packingArea.id });

  console.log("Posting opening balances — dated ~25 days ago (plant baseline), well before the 14-day trend charts' window...");
  const openingBalanceDate = new Date(Date.now() - 25 * 86400000);
  async function opening(materialId: string, locationId: string, quantity: number) {
    await postMovement({ materialId, transactionType: "OPENING_BALANCE", quantity, uom: "MT", locationId, reference: "Initial Inventory", timestamp: openingBalanceDate });
  }
  await opening(limestone.id, limestoneStockpileA.id, 25000);
  await opening(coal.id, coalYard.id, 5000);
  await opening(altFuel.id, altFuelBunker.id, 80); // deliberately below safety stock -> CRITICAL
  await opening(gypsum.id, gypsumStore.id, 3000);
  await opening(clinker.id, clinkerStore.id, 4000);
  await opening(cementGp.id, cementSilo1.id, 2200);
  await opening(cementGb.id, cementSilo2.id, 1500);
  await opening(cementHe.id, cementSilo3.id, 529); // below min, above safety -> LOW, matches the spec's own worked example
  await postMovement({ materialId: cementBag.id, transactionType: "OPENING_BALANCE", quantity: 50000, uom: "Nos", locationId: packingArea.id, reference: "Initial Inventory", timestamp: openingBalanceDate });
  await opening(ironCorrective.id, maintenanceStore.id, 500);
  await opening(sand.id, maintenanceStore.id, 300);
  await opening(flyAsh.id, maintenanceStore.id, 150);
  await opening(slag.id, maintenanceStore.id, 200);

  console.log("Recording standalone Stock Operations (Consume / Transfer)...");
  await postTransfer({ materialId: clinker.id, quantity: 200, uom: "MT", sourceLocationId: clinkerStore.id, destinationLocationId: cementMill1.id, reference: "Cement Mill 1 topping-up" });
  await postTransfer({ materialId: cementBag.id, quantity: 8000, uom: "Nos", sourceLocationId: packingArea.id, destinationLocationId: baggedWarehouse.id, reference: "Overflow to Bagged Warehouse" });

  console.log("Placing stock on Quality Hold / Block across several materials — Unrestricted, QC Hold, and Blocked all in play, plus a full hold-then-release cycle...");
  await changeQualityStatus({
    materialId: gypsum.id,
    locationId: gypsumStore.id,
    quantity: 500,
    fromStatus: "UNRESTRICTED",
    toStatus: "QC_HOLD",
    userId: neha.id,
    reason: "Awaiting lab quality clearance on incoming batch",
  });
  await changeQualityStatus({
    materialId: clinker.id,
    locationId: clinkerStore.id,
    quantity: 150,
    fromStatus: "UNRESTRICTED",
    toStatus: "BLOCKED",
    userId: neha.id,
    reason: "Contamination suspected in this batch — quarantined pending investigation",
  });
  await changeQualityStatus({
    materialId: cementHe.id,
    locationId: cementSilo3.id,
    quantity: 80,
    fromStatus: "UNRESTRICTED",
    toStatus: "QC_HOLD",
    userId: neha.id,
    reason: "Awaiting 28-day strength test results before release to dispatch",
  });
  await changeQualityStatus({
    materialId: sand.id,
    locationId: maintenanceStore.id,
    quantity: 25,
    fromStatus: "UNRESTRICTED",
    toStatus: "QC_HOLD",
    userId: neha.id,
    reason: "Moisture content re-test requested",
  });
  await changeQualityStatus({
    materialId: sand.id,
    locationId: maintenanceStore.id,
    quantity: 25,
    fromStatus: "QC_HOLD",
    toStatus: "UNRESTRICTED",
    userId: neha.id,
    reason: "Re-test passed — cleared for use",
  });

  console.log("Recording physical counts — one small variance posted immediately, one larger variance left pending the Inventory Manager's approval...");
  const count = await recordPhysicalCount({ locationId: coalYard.id, materialId: coal.id, countedQuantity: 4970, countedBy: "Amit", note: "Weekly coal yard count" });
  if (Math.abs(count.preview.varianceQty) > 1e-9) {
    await postCountAdjustment({ physicalCountId: count.count.id, reason: "Weighbridge shrinkage during weekly count", userId: neha.id });
  }
  const ironBalance = await prisma.inventoryBalance.findUnique({ where: { materialId_locationId: { materialId: ironCorrective.id, locationId: maintenanceStore.id } } });
  await recordPhysicalCount({ locationId: maintenanceStore.id, materialId: ironCorrective.id, countedQuantity: Math.round((ironBalance?.quantity ?? 500) * 0.82), countedBy: "Suresh", note: "Monthly maintenance store count — noticeable shortfall, flagged for review" });
  // Left unposted deliberately — this is what populates the "Pending Physical Counts" approval queue for Neha/Admin.

  console.log("Seeding the Requests lifecycle — every role, every status...");

  // REQ-001 — the primary client demo: full walkthrough, same Request ID throughout.
  const req1 = await createStockRequest({ materialId: gypsum.id, quantityRequested: 500, requiredByDate: new Date(Date.now() + 4 * 86400000), fromLocationId: gypsumStore.id, toLocationId: cementMill1.id, reason: "Production requirement", requestedByUserId: rahul.id });
  await acceptStockRequest(req1.id, neha.id);
  await routeToSupervisor(req1.id, amit.id, neha.id);
  await assignOperator(req1.id, suresh.id, amit.id);
  await startDelivery(req1.id, suresh.id);
  await markDelivered(req1.id, suresh.id, "Delivered to Cement Mill 1 loading bay");
  await confirmReceipt(req1.id, 500, rahul.id);

  // REQ-002 — IN_TRANSIT: delivery under way, nothing confirmed yet.
  const req2 = await createStockRequest({ materialId: clinker.id, quantityRequested: 1000, requiredByDate: new Date(Date.now() + 3 * 86400000), fromLocationId: clinkerStore.id, toLocationId: cementMill1.id, reason: "Cement Mill 1 clinker feed", requestedByUserId: priya.id });
  await acceptStockRequest(req2.id, neha.id);
  await routeToSupervisor(req2.id, amit.id, neha.id);
  await assignOperator(req2.id, suresh.id, amit.id);
  await startDelivery(req2.id, suresh.id);

  // REQ-003 — a second completed request, matching the spec's own Requester screen example (Coal, Coal Yard -> Kiln).
  const req3 = await createStockRequest({ materialId: coal.id, quantityRequested: 800, requiredByDate: new Date(Date.now() + 2 * 86400000), fromLocationId: coalYard.id, toLocationId: kiln.id, reason: "Kiln firing", requestedByUserId: rahul.id });
  await acceptStockRequest(req3.id, neha.id);
  await routeToSupervisor(req3.id, amit.id, neha.id);
  await assignOperator(req3.id, suresh.id, amit.id);
  await startDelivery(req3.id, suresh.id);
  await markDelivered(req3.id, suresh.id);
  await confirmReceipt(req3.id, 800, rahul.id);

  // REQ-004 — PARTIALLY_RECEIVED: matches the spec's own worked example (1000 requested, 1000 delivered, 600 received, 400 remaining).
  const req4 = await createStockRequest({ materialId: gypsum.id, quantityRequested: 1000, requiredByDate: new Date(Date.now() + 5 * 86400000), fromLocationId: gypsumStore.id, toLocationId: cementMill1.id, reason: "Extended production run", requestedByUserId: priya.id });
  await acceptStockRequest(req4.id, neha.id);
  await routeToSupervisor(req4.id, amit.id, neha.id);
  await assignOperator(req4.id, suresh.id, amit.id);
  await startDelivery(req4.id, suresh.id);
  await markDelivered(req4.id, suresh.id);
  await confirmReceipt(req4.id, 600, priya.id);

  // REQ-005 — REJECTED, with a reason tied to the genuinely critical Alternative Fuel stock.
  const req5 = await createStockRequest({ materialId: altFuel.id, quantityRequested: 300, requiredByDate: new Date(Date.now() + 6 * 86400000), fromLocationId: altFuelBunker.id, toLocationId: cementMill1.id, reason: "Kiln alt-fuel substitution trial", requestedByUserId: rahul.id });
  await rejectStockRequest(req5.id, neha.id, "Alternative Fuel stock is critical — cannot release any quantity right now");

  // REQ-006 — NOT_RECEIVED exception: delivered, but the requester reports it never arrived.
  const req6 = await createStockRequest({ materialId: coal.id, quantityRequested: 200, requiredByDate: new Date(Date.now() + 2 * 86400000), fromLocationId: coalYard.id, toLocationId: kiln.id, reason: "Kiln top-up", requestedByUserId: priya.id });
  await acceptStockRequest(req6.id, neha.id);
  await routeToSupervisor(req6.id, amit.id, neha.id);
  await assignOperator(req6.id, suresh.id, amit.id);
  await startDelivery(req6.id, suresh.id);
  await markDelivered(req6.id, suresh.id);
  await markNotReceived(req6.id, priya.id, "Material delivered to wrong location");

  // REQ-007 — NEW_REQUEST, urgent: a live "needs your action" item for the Store Supervisor.
  await createStockRequest({ materialId: ironCorrective.id, quantityRequested: 150, requiredByDate: new Date(Date.now() + 1 * 86400000), priority: "URGENT", fromLocationId: maintenanceStore.id, toLocationId: cementMill1.id, reason: "Kiln feed correction", requestedByUserId: rahul.id });

  // REQ-008 — ACCEPTED, awaiting assignment.
  const req8 = await createStockRequest({ materialId: sand.id, quantityRequested: 60, requiredByDate: new Date(Date.now() + 4 * 86400000), fromLocationId: maintenanceStore.id, toLocationId: cementMill1.id, reason: "Civil repair work", requestedByUserId: priya.id });
  await acceptStockRequest(req8.id, neha.id);

  // REQ-009 — ASSIGNED, awaiting the operator to start delivery.
  const req9 = await createStockRequest({ materialId: slag.id, quantityRequested: 40, requiredByDate: new Date(Date.now() + 4 * 86400000), fromLocationId: maintenanceStore.id, toLocationId: cementMill1.id, reason: "Trial blend", requestedByUserId: rahul.id });
  await acceptStockRequest(req9.id, neha.id);
  await routeToSupervisor(req9.id, amit.id, neha.id);
  await assignOperator(req9.id, suresh.id, amit.id);

  // REQ-010 — DELIVERED, awaiting the requester's confirmation.
  const req10 = await createStockRequest({ materialId: flyAsh.id, quantityRequested: 30, requiredByDate: new Date(Date.now() + 4 * 86400000), fromLocationId: maintenanceStore.id, toLocationId: cementMill1.id, reason: "Trial blend", requestedByUserId: priya.id });
  await acceptStockRequest(req10.id, neha.id);
  await routeToSupervisor(req10.id, amit.id, neha.id);
  await assignOperator(req10.id, suresh.id, amit.id);
  await startDelivery(req10.id, suresh.id);
  await markDelivered(req10.id, suresh.id, "Left with the shift supervisor");

  // REQ-011 and REQ-012 — two more completed round-trips, purely for History-tab depth.
  const req11 = await createStockRequest({ materialId: ironCorrective.id, quantityRequested: 80, requiredByDate: new Date(Date.now() + 3 * 86400000), fromLocationId: maintenanceStore.id, toLocationId: cementMill1.id, reason: "Scheduled kiln correction", requestedByUserId: priya.id });
  await acceptStockRequest(req11.id, neha.id);
  await routeToSupervisor(req11.id, amit.id, neha.id);
  await assignOperator(req11.id, suresh.id, amit.id);
  await startDelivery(req11.id, suresh.id);
  await markDelivered(req11.id, suresh.id, "Delivered to Cement Mill 1 store");
  await confirmReceipt(req11.id, 80, priya.id);

  const req12 = await createStockRequest({ materialId: cementGp.id, quantityRequested: 150, requiredByDate: new Date(Date.now() + 2 * 86400000), fromLocationId: cementSilo1.id, toLocationId: packingArea.id, reason: "Packing run top-up", requestedByUserId: rahul.id });
  await acceptStockRequest(req12.id, neha.id);
  await routeToSupervisor(req12.id, amit.id, neha.id);
  await assignOperator(req12.id, suresh.id, amit.id);
  await startDelivery(req12.id, suresh.id);
  await markDelivered(req12.id, suresh.id, "Delivered to Packing Area");
  await confirmReceipt(req12.id, 150, rahul.id);

  // REQ-013 — ACCEPTED and already routed to a Store Supervisor, but no operator picked yet.
  // Demonstrates the two-hop chain's intermediate state: Inventory Manager's part is done,
  // now it sits in Amit's (Store Supervisor's) queue specifically, not anyone else's.
  const req13 = await createStockRequest({ materialId: slag.id, quantityRequested: 25, requiredByDate: new Date(Date.now() + 3 * 86400000), fromLocationId: maintenanceStore.id, toLocationId: cementMill1.id, reason: "Trial blend follow-up", requestedByUserId: priya.id });
  await acceptStockRequest(req13.id, neha.id);
  await routeToSupervisor(req13.id, amit.id, neha.id);

  console.log("Seeding the Dispatch lifecycle — customer-bound finished goods, separate from the internal Request lifecycle...");

  // DIS-A — full happy path: CREATED -> APPROVED -> LOADING -> DISPATCHED, reduces Cement Silo 1 exactly once.
  const disA = await createDispatch({ materialId: cementGp.id, quantity: 300, sourceLocationId: cementSilo1.id, customerDestination: "Sydney Readymix Concrete Pty Ltd", weighmentReference: "WB-88213", createdByUserId: amit.id });
  await approveDispatch(disA.id, suresh.id, amit.id);
  await startDispatchLoading(disA.id, suresh.id);
  await markDispatched(disA.id, suresh.id);

  // DIS-B — APPROVED and assigned, loading not yet started.
  const disB = await createDispatch({ materialId: cementGb.id, quantity: 200, sourceLocationId: cementSilo2.id, customerDestination: "Western Sydney Builders Co", createdByUserId: neha.id });
  await approveDispatch(disB.id, suresh.id, neha.id);

  // DIS-C — CREATED, awaiting approval — a live "needs your action" item for Amit/Neha.
  await createDispatch({ materialId: cementBag.id, quantity: 500, sourceLocationId: baggedWarehouse.id, customerDestination: "Metro Hardware Distributors", createdByUserId: amit.id });

  // DIS-D — CANCELLED before dispatch, no inventory impact.
  const disD = await createDispatch({ materialId: cementHe.id, quantity: 100, sourceLocationId: cementSilo3.id, customerDestination: "Coastal Infrastructure Projects", createdByUserId: neha.id });
  await cancelDispatch(disD.id, neha.id, "Customer postponed pickup indefinitely");

  console.log("Seeding the external Receive Material (GRN) demo — separate from the internal request lifecycle...");
  const abcMinerals = await resolveSupplier({ name: "ABC Minerals" });
  const po = await createPurchaseReference({ supplierId: abcMinerals.id, materialId: gypsum.id, orderedQuantity: 2000, expectedDeliveryDate: new Date(Date.now() + 2 * 86400000), note: "Quarterly gypsum top-up" });
  await createAndPostMaterialReceipt({
    supplierId: abcMinerals.id, purchaseReferenceId: po.id, materialId: gypsum.id, receiptDate: new Date(Date.now() - 6 * 86400000),
    receivedQuantity: 2000, acceptedQuantity: 1980, destinationLocationId: gypsumStore.id,
    invoiceNumber: "INV-4587", batchLot: "GYP-2026-09-A",
  });

  const illawarraCoal = await resolveSupplier({ name: "Illawarra Coal Supply Co" });
  await createAndPostMaterialReceipt({
    supplierId: illawarraCoal.id, materialId: coal.id, receiptDate: new Date(Date.now() - 9 * 86400000),
    receivedQuantity: 1500, acceptedQuantity: 1500, destinationLocationId: coalYard.id, invoiceNumber: "INV-8821",
  });

  const nationalBagCo = await resolveSupplier({ name: "National Bag Co" });
  await createMaterialReceipt({
    supplierId: nationalBagCo.id, materialId: cementBag.id, receiptDate: new Date(),
    receivedQuantity: 20000, acceptedQuantity: 20000, destinationLocationId: packingArea.id, invoiceNumber: "INV-1102",
  }); // left as DRAFT deliberately — never touches stock until posted

  const sydneyAggregates = await resolveSupplier({ name: "Sydney Aggregates & Sand", referenceCode: "SUP-0042", contactInfo: "orders@sydneyaggregates.example" });
  const sandPo = await createPurchaseReference({ supplierId: sydneyAggregates.id, materialId: sand.id, orderedQuantity: 400, expectedDeliveryDate: new Date(Date.now() + 1 * 86400000), note: "Civil works replenishment" });
  await createAndPostMaterialReceipt({
    supplierId: sydneyAggregates.id, purchaseReferenceId: sandPo.id, materialId: sand.id, receiptDate: new Date(Date.now() - 2 * 86400000),
    receivedQuantity: 400, acceptedQuantity: 390, destinationLocationId: maintenanceStore.id, invoiceNumber: "INV-2291", batchLot: "SND-2026-08-C",
  });

  const ironOreCorp = await resolveSupplier({ name: "Iron Ore Corp" });
  await createAndPostMaterialReceipt({
    supplierId: ironOreCorp.id, materialId: ironCorrective.id, receiptDate: new Date(Date.now() - 5 * 86400000),
    receivedQuantity: 250, acceptedQuantity: 240, rejectedQuantity: 10, destinationLocationId: maintenanceStore.id, invoiceNumber: "INV-7734",
  });

  const flyAshTraders = await resolveSupplier({ name: "Fly Ash Traders Pty Ltd" });
  const flyAshPo = await createPurchaseReference({ supplierId: flyAshTraders.id, materialId: flyAsh.id, orderedQuantity: 200, note: "Additive blend top-up" });
  await createMaterialReceipt({
    supplierId: flyAshTraders.id, purchaseReferenceId: flyAshPo.id, materialId: flyAsh.id, receiptDate: new Date(),
    receivedQuantity: 200, acceptedQuantity: 200, destinationLocationId: maintenanceStore.id, invoiceNumber: "INV-5510",
  }); // also left as DRAFT — a second example awaiting posting

  console.log("Building consumption history across the catalog — Days of Cover, Consumption History, and the dashboard trend charts all read this...");
  async function consumptionHistory(materialId: string, locationId: string, uom: string, processName: string, opts: { days?: number; dailyRatePct?: number } = {}) {
    const days = opts.days ?? 18;
    const dailyRatePct = opts.dailyRatePct ?? 0.012;
    const balance = await prisma.inventoryBalance.findUnique({ where: { materialId_locationId: { materialId, locationId } } });
    const current = balance?.quantity ?? 0;
    const dailyQty = current * dailyRatePct;
    if (dailyQty < 0.5) return; // not enough stock here for a meaningful daily draw-down
    for (let i = days; i >= 1; i--) {
      const jitter = 0.75 + Math.random() * 0.5; // day-to-day variability so trend charts aren't a flat line
      const quantity = Math.max(0.1, Math.round(dailyQty * jitter * 10) / 10);
      const timestamp = new Date(Date.now() - i * 86400000);
      await postMovement({ materialId, transactionType: "CONSUMPTION", quantity, uom, locationId, processName, reference: `Shift log ${timestamp.toISOString().slice(0, 10)}`, timestamp });
    }
  }
  // Alternative Fuel is deliberately left out — it's already seeded critically low, and drawing it
  // down further would just be redundant with that intentional scenario.
  await consumptionHistory(limestone.id, limestoneStockpileA.id, "MT", "Raw Mill");
  await consumptionHistory(coal.id, coalYard.id, "MT", "Kiln Firing");
  await consumptionHistory(gypsum.id, gypsumStore.id, "MT", "Cement Mill 1");
  await consumptionHistory(clinker.id, clinkerStore.id, "MT", "Cement Mill 1");
  await consumptionHistory(flyAsh.id, maintenanceStore.id, "MT", "Cement Mill 1");
  await consumptionHistory(slag.id, maintenanceStore.id, "MT", "Cement Mill 1");
  await consumptionHistory(ironCorrective.id, maintenanceStore.id, "MT", "Kiln Feed Correction");
  await consumptionHistory(sand.id, maintenanceStore.id, "MT", "Civil Works");
  await consumptionHistory(cementGp.id, cementSilo1.id, "MT", "Packing Area");
  await consumptionHistory(cementGb.id, cementSilo2.id, "MT", "Packing Area");
  await consumptionHistory(cementHe.id, cementSilo3.id, "MT", "Packing Area");
  await consumptionHistory(cementBag.id, packingArea.id, "Nos", "Dispatch Loading", { dailyRatePct: 0.01 });

  console.log("Seed complete.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
