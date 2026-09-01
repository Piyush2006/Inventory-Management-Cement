/* eslint-disable no-console */
import { postMovement, postAdjustment, postTransfer, postPacking } from "../src/lib/inventory/ledger";
import { postProduction } from "../src/lib/inventory/production";
import { recordPhysicalCount } from "../src/lib/inventory/reconciliation";
import {
  createStockRequest,
  acceptStockRequest,
  rejectStockRequest,
  allocateStock,
  issueStock,
  confirmReceipt,
} from "../src/lib/inventory/requests";
import { resolveSupplier, createPurchaseReference, createAndPostMaterialReceipt, createMaterialReceipt } from "../src/lib/inventory/procurement";
import { prisma, ensureSqliteTuned } from "../src/lib/db";

function daysAgo(n: number, hour = 9): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number, hour = 9): Date {
  return daysAgo(-n, hour);
}
function wave(day: number, amplitude: number, period = 11) {
  return Math.sin((day / period) * Math.PI * 2) * amplitude;
}

async function main() {
  await ensureSqliteTuned();
  console.log("Wiping existing data...");
  await prisma.$transaction([
    prisma.requestEvent.deleteMany(),
    prisma.stockReservation.deleteMany(),
    prisma.materialReceipt.deleteMany(),
    prisma.purchaseReference.deleteMany(),
    prisma.stockRequest.deleteMany(),
    prisma.physicalCount.deleteMany(),
    prisma.consumptionCoefficient.deleteMany(),
    prisma.inventoryTransaction.deleteMany(),
    prisma.inventoryBalance.deleteMany(),
    prisma.supplier.deleteMany(),
    prisma.user.deleteMany(),
    prisma.material.deleteMany(),
    prisma.location.deleteMany(),
  ]);

  // -------------------------------------------------------------------------
  // Locations (fixed list per spec — single site, no site selector)
  // -------------------------------------------------------------------------
  console.log("Creating locations...");
  async function loc(name: string, type: string, capacity?: number) {
    return prisma.location.create({ data: { name, type, capacity } });
  }
  const limestoneA = await loc("Limestone Stockpile A", "STOCKPILE", 45000);
  const limestoneB = await loc("Limestone Stockpile B", "STOCKPILE", 20000);
  const coalYard = await loc("Coal Yard", "YARD", 12000);
  const altFuelBunker = await loc("Alternative Fuel Bunker", "BUNKER", 6000);
  const rawMealSilo = await loc("Raw Meal Silo", "SILO", 8000);
  const clinkerStore = await loc("Clinker Store", "STORE", 60000);
  const gypsumStore = await loc("Gypsum Store", "STORE", 10000);
  const cementSilo1GP = await loc("Cement Silo 1 – GP", "SILO", 12000);
  const cementSilo2GB = await loc("Cement Silo 2 – GB", "SILO", 12000);
  const cementSilo3HE = await loc("Cement Silo 3 – HE", "SILO", 8000);
  const bagStore = await loc("Bag Store", "STORE", 800000);
  const baggedWarehouse = await loc("Bagged Warehouse", "WAREHOUSE", 6000);
  const cementMill1 = await loc("Cement Mill 1", "PRODUCTION_AREA");

  // -------------------------------------------------------------------------
  // Users & roles
  // -------------------------------------------------------------------------
  console.log("Creating users...");
  const rahul = await prisma.user.create({ data: { name: "Rahul", role: "REQUESTER" } });
  const priya = await prisma.user.create({ data: { name: "Priya", role: "REQUESTER" } });
  const amit = await prisma.user.create({ data: { name: "Amit", role: "STORE_OPERATOR" } });
  const sunita = await prisma.user.create({ data: { name: "Sunita", role: "INVENTORY_MANAGER" } });
  const admin = await prisma.user.create({ data: { name: "Admin", role: "ADMIN" } });
  void admin;

  // -------------------------------------------------------------------------
  // Materials
  // -------------------------------------------------------------------------
  console.log("Creating materials...");
  async function mat(input: {
    code: string; name: string; category: string; uom: string; defaultLocationId?: string;
    minStock?: number; safetyStock?: number; bagWeightKg?: number; productGrade?: string; active?: boolean;
  }) {
    return prisma.material.create({
      data: {
        materialCode: input.code, name: input.name, category: input.category, uom: input.uom,
        defaultLocationId: input.defaultLocationId, minStock: input.minStock, safetyStock: input.safetyStock,
        bagWeightKg: input.bagWeightKg, productGrade: input.productGrade, active: input.active ?? true,
      },
    });
  }

  const limestone = await mat({ code: "RM-001", name: "Limestone", category: "RAW_MATERIAL", uom: "MT", defaultLocationId: limestoneA.id, minStock: 10000, safetyStock: 5000 });
  const shale = await mat({ code: "RM-002", name: "Shale", category: "RAW_MATERIAL", uom: "MT", defaultLocationId: limestoneB.id, minStock: 2000, safetyStock: 1000 });
  const ironCorrective = await mat({ code: "RM-003", name: "Iron Corrective", category: "RAW_MATERIAL", uom: "MT", defaultLocationId: limestoneB.id, minStock: 300, safetyStock: 150 });
  const sand = await mat({ code: "RM-004", name: "Sand", category: "RAW_MATERIAL", uom: "MT", defaultLocationId: limestoneB.id, minStock: 500, safetyStock: 250 });

  const coal = await mat({ code: "FU-001", name: "Coal", category: "FUEL", uom: "MT", defaultLocationId: coalYard.id, minStock: 3000, safetyStock: 1500 });
  const altFuel = await mat({ code: "FU-002", name: "Alternative Fuel", category: "FUEL", uom: "MT", defaultLocationId: altFuelBunker.id, minStock: 800, safetyStock: 300 });

  const gypsum = await mat({ code: "AD-001", name: "Gypsum", category: "ADDITIVE", uom: "MT", defaultLocationId: gypsumStore.id, minStock: 1500, safetyStock: 600 });
  const flyAsh = await mat({ code: "AD-002", name: "Fly Ash", category: "ADDITIVE", uom: "MT", defaultLocationId: gypsumStore.id, minStock: 1200, safetyStock: 500 });
  const slag = await mat({ code: "AD-003", name: "Slag", category: "ADDITIVE", uom: "MT", defaultLocationId: gypsumStore.id, minStock: 1000, safetyStock: 400 });

  const rawMeal = await mat({ code: "IM-001", name: "Raw Meal", category: "INTERMEDIATE", uom: "MT", defaultLocationId: rawMealSilo.id, minStock: 2000, safetyStock: 800 });
  const clinker = await mat({ code: "IM-002", name: "Clinker", category: "INTERMEDIATE", uom: "MT", defaultLocationId: clinkerStore.id, minStock: 8000, safetyStock: 3000 });

  const cementGP = await mat({ code: "FG-001", name: "Cement GP", category: "FINISHED_GOODS", uom: "MT", defaultLocationId: cementSilo1GP.id, productGrade: "GP", bagWeightKg: 20, minStock: 1500, safetyStock: 500 });
  const cementGB = await mat({ code: "FG-002", name: "Cement GB", category: "FINISHED_GOODS", uom: "MT", defaultLocationId: cementSilo2GB.id, productGrade: "GB", bagWeightKg: 20, minStock: 1500, safetyStock: 500 });
  const cementHE = await mat({ code: "FG-003", name: "Cement HE", category: "FINISHED_GOODS", uom: "MT", defaultLocationId: cementSilo3HE.id, productGrade: "HE", bagWeightKg: 20, minStock: 600, safetyStock: 200 });

  const bag20kg = await mat({ code: "PK-001", name: "20 kg Cement Bag", category: "PACKING", uom: "Nos", defaultLocationId: bagStore.id, minStock: 200000, safetyStock: 80000 });

  // -------------------------------------------------------------------------
  // Consumption coefficients (configurable recipe)
  // -------------------------------------------------------------------------
  console.log("Creating consumption coefficients...");
  async function coeff(outputMaterialId: string, inputMaterialId: string, rate: number, notes?: string) {
    await prisma.consumptionCoefficient.create({ data: { outputMaterialId, inputMaterialId, rate, notes } });
  }
  await coeff(rawMeal.id, limestone.id, 0.83, "Limestone share of raw meal feed");
  await coeff(rawMeal.id, shale.id, 0.13, "Shale share of raw meal feed");
  await coeff(rawMeal.id, ironCorrective.id, 0.015, "Iron corrective share of raw meal feed");
  await coeff(rawMeal.id, sand.id, 0.025, "Sand share of raw meal feed");

  await coeff(clinker.id, rawMeal.id, 1.55, "Kiln feed ratio");
  await coeff(clinker.id, coal.id, 0.1, "Thermal fuel — coal");
  await coeff(clinker.id, altFuel.id, 0.043, "Alternative fuel");

  await coeff(cementGP.id, clinker.id, 0.93, "Clinker factor — GP");
  await coeff(cementGP.id, gypsum.id, 0.05, "Gypsum — GP");
  await coeff(cementGB.id, clinker.id, 0.68, "Clinker factor — GB (blended)");
  await coeff(cementGB.id, gypsum.id, 0.04, "Gypsum — GB");
  await coeff(cementGB.id, flyAsh.id, 0.18, "Fly ash — GB");
  await coeff(cementGB.id, slag.id, 0.1, "Slag — GB");
  await coeff(cementHE.id, clinker.id, 0.95, "Clinker factor — HE (finer grind)");
  await coeff(cementHE.id, gypsum.id, 0.05, "Gypsum — HE");

  // -------------------------------------------------------------------------
  // Opening balances
  // -------------------------------------------------------------------------
  console.log("Posting opening balances...");
  const HISTORY_DAYS = 45;
  const openingDate = daysAgo(HISTORY_DAYS, 6);

  async function opening(materialId: string, locationId: string, qty: number, uom = "MT") {
    if (qty <= 0) return;
    await postMovement({ materialId, transactionType: "OPENING_BALANCE", quantity: qty, uom, locationId, timestamp: openingDate, reference: "Opening balance (system go-live)" });
  }
  await opening(limestone.id, limestoneA.id, 40000);
  await opening(shale.id, limestoneB.id, 6000);
  await opening(ironCorrective.id, limestoneB.id, 700);
  await opening(sand.id, limestoneB.id, 1200);
  await opening(coal.id, coalYard.id, 6000);
  await opening(altFuel.id, altFuelBunker.id, 1600);
  await opening(gypsum.id, gypsumStore.id, 3000);
  await opening(flyAsh.id, gypsumStore.id, 2400);
  await opening(slag.id, gypsumStore.id, 1800);
  await opening(rawMeal.id, rawMealSilo.id, 4000);
  await opening(clinker.id, clinkerStore.id, 22000);
  await opening(cementGP.id, cementSilo1GP.id, 3200);
  await opening(cementGB.id, cementSilo2GB.id, 3000);
  await opening(cementHE.id, cementSilo3HE.id, 1400);
  await opening(bag20kg.id, bagStore.id, 550000, "Nos");

  // -------------------------------------------------------------------------
  // Operating history
  // -------------------------------------------------------------------------
  console.log(`Generating ${HISTORY_DAYS} days of operating history...`);

  // Safety net: tops a location up via an audited ADJUSTMENT whenever it's about to run
  // short, so the hand-tuned daily rates below never need to balance perfectly. Target is
  // sized against the material's own safety stock so it also never leaves a material
  // permanently "critical" by construction.
  const materialCache = new Map<string, { safetyStock: number | null }>();
  async function ensureBuffer(materialId: string, locationId: string, aboutToConsume: number, uom = "MT") {
    const bal = await prisma.inventoryBalance.findFirst({ where: { materialId, locationId } });
    const have = bal?.quantity ?? 0;
    if (have < aboutToConsume * 3) {
      if (!materialCache.has(materialId)) {
        const m = await prisma.material.findUnique({ where: { id: materialId }, select: { safetyStock: true } });
        materialCache.set(materialId, { safetyStock: m?.safetyStock ?? null });
      }
      const safetyMargin = (materialCache.get(materialId)?.safetyStock ?? 0) * 1.3;
      const target = Math.max(aboutToConsume * 18, safetyMargin);
      await postAdjustment({ materialId, locationId, quantity: target - have, uom, reason: "Historical data backfill — simulated replenishment" });
    }
  }

  for (let d = HISTORY_DAYS - 1; d >= 1; d--) {
    const ts = daysAgo(d, 7);
    const dayIndex = HISTORY_DAYS - d;

    // --- Receipts: limestone, coal, gypsum ---
    await postMovement({ materialId: limestone.id, transactionType: "RECEIPT", quantity: 780 + wave(dayIndex, 100, 6), uom: "MT", locationId: limestoneA.id, timestamp: ts, reference: "Quarry delivery" });
    if (dayIndex % 4 === 0) await postMovement({ materialId: coal.id, transactionType: "RECEIPT", quantity: 250 + wave(dayIndex, 40, 5), uom: "MT", locationId: coalYard.id, timestamp: ts, reference: "Coal supplier delivery" });
    if (dayIndex % 5 === 0) await postMovement({ materialId: gypsum.id, transactionType: "RECEIPT", quantity: 125 + wave(dayIndex, 20, 4), uom: "MT", locationId: gypsumStore.id, timestamp: ts, reference: "Gypsum supplier delivery" });
    if (dayIndex % 6 === 0) await postMovement({ materialId: flyAsh.id, transactionType: "RECEIPT", quantity: 175 + wave(dayIndex, 25, 4), uom: "MT", locationId: gypsumStore.id, timestamp: ts, reference: "Fly ash supplier delivery" });
    if (dayIndex % 6 === 3) await postMovement({ materialId: slag.id, transactionType: "RECEIPT", quantity: 100 + wave(dayIndex, 15, 4), uom: "MT", locationId: gypsumStore.id, timestamp: ts, reference: "Slag supplier delivery" });
    if (dayIndex % 5 === 2) await postMovement({ materialId: shale.id, transactionType: "RECEIPT", quantity: 220 + wave(dayIndex, 30, 5), uom: "MT", locationId: limestoneB.id, timestamp: ts, reference: "Shale delivery" });
    if (dayIndex % 7 === 1) await postMovement({ materialId: ironCorrective.id, transactionType: "RECEIPT", quantity: 30 + wave(dayIndex, 5, 5), uom: "MT", locationId: limestoneB.id, timestamp: ts, reference: "Iron corrective delivery" });
    if (dayIndex % 7 === 4) await postMovement({ materialId: sand.id, transactionType: "RECEIPT", quantity: 50 + wave(dayIndex, 8, 5), uom: "MT", locationId: limestoneB.id, timestamp: ts, reference: "Sand delivery" });
    if (dayIndex % 9 === 0) await postMovement({ materialId: altFuel.id, transactionType: "RECEIPT", quantity: 260 + wave(dayIndex, 30, 5), uom: "MT", locationId: altFuelBunker.id, timestamp: ts, reference: "Alternative fuel delivery" });
    if (dayIndex % 10 === 0) await postMovement({ materialId: bag20kg.id, transactionType: "RECEIPT", quantity: 40000, uom: "Nos", locationId: bagStore.id, timestamp: ts, reference: "Bag supplier delivery" });

    // --- Production: Raw Meal -> Clinker -> Cement (auto-consumes configured inputs) ---
    const rawMealOut = 900 + wave(dayIndex, 60, 9);
    await ensureBuffer(limestone.id, limestoneA.id, rawMealOut * 0.83);
    await ensureBuffer(shale.id, limestoneB.id, rawMealOut * 0.13);
    await ensureBuffer(ironCorrective.id, limestoneB.id, rawMealOut * 0.015);
    await ensureBuffer(sand.id, limestoneB.id, rawMealOut * 0.025);
    await postProduction({ outputMaterialId: rawMeal.id, outputLocationId: rawMealSilo.id, quantity: rawMealOut, processName: "Raw Mill", timestamp: ts });

    const clinkerOut = 580 + wave(dayIndex, 45, 13);
    await ensureBuffer(rawMeal.id, rawMealSilo.id, clinkerOut * 1.55);
    await ensureBuffer(coal.id, coalYard.id, clinkerOut * 0.1);
    await ensureBuffer(altFuel.id, altFuelBunker.id, clinkerOut * 0.043);
    await postProduction({ outputMaterialId: clinker.id, outputLocationId: clinkerStore.id, quantity: clinkerOut, processName: "Kiln", timestamp: ts });

    const gpOut = 340 + wave(dayIndex, 30, 5);
    await ensureBuffer(clinker.id, clinkerStore.id, gpOut * 0.93);
    await ensureBuffer(gypsum.id, gypsumStore.id, gpOut * 0.05);
    await postProduction({ outputMaterialId: cementGP.id, outputLocationId: cementSilo1GP.id, quantity: gpOut, processName: "Cement Mill", timestamp: ts });

    const gbOut = 160 + wave(dayIndex, 20, 8);
    await ensureBuffer(clinker.id, clinkerStore.id, gbOut * 0.68);
    await ensureBuffer(gypsum.id, gypsumStore.id, gbOut * 0.04);
    await ensureBuffer(flyAsh.id, gypsumStore.id, gbOut * 0.18);
    await ensureBuffer(slag.id, gypsumStore.id, gbOut * 0.1);
    await postProduction({ outputMaterialId: cementGB.id, outputLocationId: cementSilo2GB.id, quantity: gbOut, processName: "Cement Mill", timestamp: ts });

    if (dayIndex % 2 === 0) {
      const heOut = 70 + wave(dayIndex, 10, 6);
      await ensureBuffer(clinker.id, clinkerStore.id, heOut * 0.95);
      await ensureBuffer(gypsum.id, gypsumStore.id, heOut * 0.05);
      await postProduction({ outputMaterialId: cementHE.id, outputLocationId: cementSilo3HE.id, quantity: heOut, processName: "Cement Mill", timestamp: ts });
    }

    // --- Packing (bulk -> bagged, same material moved to Bagged Warehouse) ---
    if (dayIndex % 2 === 0) {
      await ensureBuffer(bag20kg.id, bagStore.id, 5000, "Nos");
      await postPacking({ bulkMaterialId: cementGP.id, bulkLocationId: cementSilo1GP.id, bulkQuantity: 90 + wave(dayIndex, 10, 5), bagMaterialId: bag20kg.id, bagLocationId: bagStore.id, baggedMaterialId: cementGP.id, baggedLocationId: baggedWarehouse.id, timestamp: ts });
    }
    if (dayIndex % 4 === 1) {
      await ensureBuffer(bag20kg.id, bagStore.id, 3000, "Nos");
      await postPacking({ bulkMaterialId: cementGB.id, bulkLocationId: cementSilo2GB.id, bulkQuantity: 55 + wave(dayIndex, 8, 5), bagMaterialId: bag20kg.id, bagLocationId: bagStore.id, baggedMaterialId: cementGB.id, baggedLocationId: baggedWarehouse.id, timestamp: ts });
    }

    // --- Transfers between plant locations (occasional silo rebalancing) ---
    if (dayIndex % 8 === 0) {
      await postTransfer({ materialId: limestone.id, quantity: 500, uom: "MT", sourceLocationId: limestoneA.id, destinationLocationId: limestoneB.id, timestamp: ts, reference: "Stockpile rebalancing" });
    }

    // --- Dispatch (leaves the plant to customers) — capped to available stock ---
    async function dispatch(materialId: string, locationId: string, desired: number) {
      const bal = await prisma.inventoryBalance.findFirst({ where: { materialId, locationId } });
      const have = bal?.quantity ?? 0;
      const qty = Math.max(0, Math.min(desired, have * 0.9));
      if (qty > 1) await postMovement({ materialId, transactionType: "DISPATCH", quantity: qty, uom: "MT", locationId, timestamp: ts, reference: "Customer sales order" });
    }
    await dispatch(cementGP.id, cementSilo1GP.id, gpOut * 0.9);
    await dispatch(cementGB.id, cementSilo2GB.id, gbOut * 0.85);
    await dispatch(cementHE.id, cementSilo3HE.id, 55);

    if (dayIndex % 15 === 0) process.stdout.write(`  ...day -${d}\n`);
  }

  // -------------------------------------------------------------------------
  // One low coal condition
  // -------------------------------------------------------------------------
  console.log("Seeding low-coal condition...");
  const coalBalance = await prisma.inventoryBalance.findFirst({ where: { materialId: coal.id, locationId: coalYard.id } });
  const coalTarget = 2600; // below minStock 3000 but above safetyStock 1500 -> LOW status
  if (coalBalance && Math.abs(coalBalance.quantity - coalTarget) > 1) {
    await postAdjustment({ materialId: coal.id, locationId: coalYard.id, quantity: coalTarget - coalBalance.quantity, uom: "MT", reason: "Stocktake alignment ahead of go-live demo" });
  }

  // -------------------------------------------------------------------------
  // One critical material — Alternative Fuel below safety stock
  // -------------------------------------------------------------------------
  console.log("Seeding one critical material...");
  const altFuelBalance = await prisma.inventoryBalance.findFirst({ where: { materialId: altFuel.id, locationId: altFuelBunker.id } });
  const altFuelTarget = 220; // below safetyStock 300 -> CRITICAL status
  if (altFuelBalance && Math.abs(altFuelBalance.quantity - altFuelTarget) > 1) {
    await postAdjustment({ materialId: altFuel.id, locationId: altFuelBunker.id, quantity: altFuelTarget - altFuelBalance.quantity, uom: "MT", reason: "Stocktake alignment ahead of go-live demo" });
  }

  // -------------------------------------------------------------------------
  // One physical stock adjustment (pending — recorded, not yet posted)
  // -------------------------------------------------------------------------
  console.log("Seeding one physical stock adjustment...");
  const limestoneBalance = await prisma.inventoryBalance.findFirst({ where: { materialId: limestone.id, locationId: limestoneA.id } });
  const limestoneBook = limestoneBalance?.quantity ?? 40000;
  if (Math.abs(limestoneBook - 40000) > 1) {
    await postAdjustment({ materialId: limestone.id, locationId: limestoneA.id, quantity: 40000 - limestoneBook, uom: "MT", reason: "Stocktake alignment ahead of go-live demo" });
  }
  await recordPhysicalCount({ locationId: limestoneA.id, materialId: limestone.id, countedQuantity: 38800, countedBy: "Plant Storekeeper", note: "Quarterly volumetric survey" });

  // -------------------------------------------------------------------------
  // Stock Requests — full lifecycle demo (Section 19's primary walkthrough, plus
  // partial fulfilment, rejection, a live pending item, and external replenishment)
  // -------------------------------------------------------------------------
  console.log("Seeding stock requests — full lifecycle...");

  // REQ-001 — the primary live-demo scenario, driven start-to-finish through the real
  // lifecycle functions (not raw DB writes) so ledger + timeline are fully authentic:
  // Rahul raises it -> Amit accepts -> allocates -> issues (IN_TRANSIT) -> Rahul confirms
  // receipt -> auto-COMPLETED.
  const req1 = await createStockRequest({
    materialId: gypsum.id, quantityRequested: 500, requiredByDate: daysFromNow(3), priority: "NORMAL",
    reason: "Cement Mill 1 gypsum top-up", fromLocationId: gypsumStore.id, toLocationId: cementMill1.id, requestedByUserId: rahul.id,
  });
  await acceptStockRequest(req1.id, amit.id);
  await allocateStock(req1.id, 500, amit.id);
  await issueStock(req1.id, 500, amit.id);
  await confirmReceipt(req1.id, 500, rahul.id);

  // REQ-002 — partial fulfilment, left mid-cycle (600 of 1,000 received) so the demo can
  // show allocating/issuing/receiving the remaining 400 MT live.
  const req2 = await createStockRequest({
    materialId: limestone.id, quantityRequested: 1000, requiredByDate: daysFromNow(6), priority: "NORMAL",
    reason: "Raw mill feed top-up", fromLocationId: limestoneA.id, toLocationId: cementMill1.id, requestedByUserId: priya.id,
  });
  await acceptStockRequest(req2.id, amit.id);
  await allocateStock(req2.id, 600, amit.id);
  await issueStock(req2.id, 600, amit.id);
  await confirmReceipt(req2.id, 600, priya.id);

  // REQ-003 — rejected, with a mandatory reason; stays visible in history.
  const req3 = await createStockRequest({
    materialId: coal.id, quantityRequested: 1200, requiredByDate: daysFromNow(7), priority: "NORMAL",
    reason: "Routine coal top-up", fromLocationId: coalYard.id, toLocationId: cementMill1.id, requestedByUserId: rahul.id,
  });
  await rejectStockRequest(req3.id, amit.id, "Coal yard capacity already committed to next scheduled delivery");

  // REQ-004 — left PENDING, urgent: a live "needs your action" item for the Store Operator.
  await createStockRequest({
    materialId: altFuel.id, quantityRequested: 300, requiredByDate: daysFromNow(2), priority: "URGENT",
    reason: "Alt fuel bunker running critical", fromLocationId: altFuelBunker.id, toLocationId: cementMill1.id, requestedByUserId: priya.id,
  });

  // REQ-005 — external replenishment path (Section 16): accepted internally, but internal
  // stock can't cover it, so fulfilment goes through Purchase Reference -> GRN instead of
  // allocate/issue. The same Request ID stays attached throughout.
  const req5 = await createStockRequest({
    materialId: gypsum.id, quantityRequested: 2500, requiredByDate: daysFromNow(5), priority: "NORMAL",
    reason: "Cement Mill 1 gypsum top-up — insufficient stock on site", fromLocationId: gypsumStore.id, toLocationId: cementMill1.id, requestedByUserId: rahul.id,
  });
  await acceptStockRequest(req5.id, amit.id);

  // -------------------------------------------------------------------------
  // Procurement / Material Receipt (GRN) demo scenario
  // Stock Request -> Source/PO -> Material Arrives -> GRN -> Accept/Reject -> Post
  // -------------------------------------------------------------------------
  console.log("Seeding procurement / GRN demo scenario...");
  const abcMinerals = await resolveSupplier({ name: "ABC Minerals", referenceCode: "SUP-ABC", contactInfo: "orders@abcminerals.example" });
  const nationalBagCo = await resolveSupplier({ name: "National Bag Co", referenceCode: "SUP-NBC" });
  const illawarraCoal = await resolveSupplier({ name: "Illawarra Coal Supply Co", referenceCode: "SUP-ICS" });

  // Step 2 — Source: PO-1025, ABC Minerals, Gypsum, 2,500 MT ordered, linked to REQ-005.
  const po1025 = await createPurchaseReference({
    supplierId: abcMinerals.id,
    materialId: gypsum.id,
    orderedQuantity: 2500,
    expectedDeliveryDate: daysFromNow(4),
    note: "Cement Mill 1 gypsum top-up",
    stockRequestId: req5.id,
  });

  // Step 3-5 — Material arrives, GRN-001 raised and posted: received 2,000, accepted 1,980,
  // rejected 20 (auto-derived), invoice INV-4587. Inventory increases by 1,980 MT only, and
  // because this GRN is linked to REQ-005 and PO-1025, both roll forward automatically:
  // REQ-005 -> PARTIALLY_RECEIVED (1,980 of 2,500), PO-1025 -> PARTIALLY_RECEIVED.
  await createAndPostMaterialReceipt(
    {
      supplierId: abcMinerals.id,
      purchaseReferenceId: po1025.id,
      materialId: gypsum.id,
      receiptDate: daysAgo(1),
      receivedQuantity: 2000,
      acceptedQuantity: 1980,
      destinationLocationId: gypsumStore.id,
      batchLot: "GYP-SEP-001",
      invoiceNumber: "INV-4587",
      invoiceDate: daysAgo(1),
      invoiceAmount: 2000 * 38, // MT x standard cost/MT
      deliveryNoteNumber: "DN-77213",
      vehicleReference: "WB-55210",
      truckNumber: "NSW-42A-118",
      notes: "20 MT rejected — moisture content out of spec on QC check.",
      stockRequestId: req5.id,
    },
    sunita.id
  );

  // A second, direct receipt (no PO, no stock request) fully receives a routine coal delivery.
  await createAndPostMaterialReceipt(
    {
      supplierId: illawarraCoal.id,
      materialId: coal.id,
      receiptDate: daysAgo(2),
      receivedQuantity: 1500,
      acceptedQuantity: 1500,
      destinationLocationId: coalYard.id,
      invoiceNumber: "INV-9012",
      invoiceDate: daysAgo(2),
      deliveryNoteNumber: "DN-77190",
      truckNumber: "NSW-18B-227",
      notes: "Routine coal top-up, no PO raised.",
    },
    sunita.id
  );

  // A DRAFT receipt awaiting quality sign-off — demonstrates that a draft never touches stock.
  await createMaterialReceipt({
    supplierId: nationalBagCo.id,
    materialId: bag20kg.id,
    receiptDate: daysAgo(0),
    receivedQuantity: 40000,
    acceptedQuantity: 39500,
    destinationLocationId: bagStore.id,
    invoiceNumber: "INV-3321",
    deliveryNoteNumber: "DN-77250",
    notes: "Awaiting QC sign-off on bag seam quality before posting.",
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
