import { prisma } from "@/lib/db";
import { IN_TRANSIT_LOCATION_TYPE } from "@/lib/domain/enums";
import { formatQty, formatNumber, formatPct } from "@/lib/format";
import { getTotalOnHand } from "@/lib/inventory/balance";
import { getTotalQualityBalances } from "@/lib/inventory/quality";

export type InsightType = "HIGH_RISK" | "QUALITY_HOLD_RISK" | "MEDIUM_RISK" | "CONSUMPTION_ANOMALY";

export interface InventoryInsight {
  materialId: string;
  materialName: string;
  type: InsightType;
  typeLabel: string;
  explanation: string;
  metrics: { label: string; value: string }[];
  severity: number;
}

export interface MaterialRiskInput {
  materialId: string;
  materialName: string;
  uom: string;
  onHand: number;
  qcHold: number;
  blocked: number;
  minStock: number | null;
  dailyRate: number; // trailing TRAILING_WINDOW_DAYS-day average consumption
  recentDailyRate: number; // trailing RECENT_WINDOW_DAYS-day average consumption
  distinctConsumptionDays: number; // number of distinct days with a CONSUMPTION row in the trailing window
  totalTrailingConsumption: number;
  incomingQuantity: number; // open PO quantity not yet fully received
}

const TRAILING_WINDOW_DAYS = 30;
const RECENT_WINDOW_DAYS = 3;
const ANOMALY_MIN_DISTINCT_DAYS = 5; // enough history for a recent-vs-trailing comparison to mean something
const ANOMALY_MIN_TRAILING_QTY = 5; // ignore materials whose 30-day total is too small to be meaningful
const ANOMALY_THRESHOLD_PCT = 25;
const APPROACHING_MIN_STOCK_DAYS = 7;
const MEDIUM_RISK_DAYS_OF_COVER = 10;
const QUALITY_HOLD_FRACTION_THRESHOLD = 0.2;
const MAX_INSIGHTS = 5;

/**
 * Deterministic risk scoring + templated natural-language explanation for a single material,
 * given its already-computed inputs. Pure and DB-free by design — the highest-priority
 * applicable insight type wins (a material never gets more than one), evaluated in the order
 * High Risk -> Usable Stock Risk -> Medium Risk -> Unusual Consumption. Returns null when no
 * threshold is crossed.
 */
export function evaluateMaterialRisk(input: MaterialRiskInput): InventoryInsight | null {
  const { materialId, materialName, uom, onHand, qcHold, blocked, minStock, dailyRate, recentDailyRate, distinctConsumptionDays, totalTrailingConsumption, incomingQuantity } = input;
  const unrestricted = Math.max(0, onHand - qcHold - blocked);
  const daysCover = dailyRate > 1e-9 ? unrestricted / dailyRate : null;

  const incomingNote =
    minStock != null && unrestricted < minStock
      ? incomingQuantity >= minStock - unrestricted
        ? ` ${formatQty(incomingQuantity, uom)} is already on order.`
        : " No sufficient incoming stock is currently on order."
      : "";

  // Type 1 (highest priority): already at/below minimum stock, or projected to cross it soon.
  // "Already below" fires on the threshold alone, with or without consumption history — a
  // material can be below minimum stock the moment it's counted (e.g. seeded that way, or
  // never yet consumed), and that fact doesn't stop being true just because there's no rate to
  // project forward with. Only the *approaching* branch (not yet below, but will be soon) needs
  // a real dailyRate, since projecting "when" requires a rate.
  if (minStock != null) {
    const alreadyBelow = unrestricted <= minStock;
    if (alreadyBelow) {
      return {
        materialId,
        materialName,
        type: "HIGH_RISK",
        typeLabel: "High Inventory Risk",
        explanation: dailyRate > 1e-9
          ? `Usable stock is ${formatQty(unrestricted, uom)}, already at or below the ${formatQty(minStock, uom)} minimum stock level. Average consumption is ${formatQty(dailyRate, uom)}/day.${incomingNote}`
          : `Usable stock is ${formatQty(unrestricted, uom)}, already at or below the ${formatQty(minStock, uom)} minimum stock level. No recent consumption has been recorded, so a depletion rate can't be estimated.${incomingNote}`,
        metrics: [
          { label: "Usable Stock", value: formatQty(unrestricted, uom) },
          { label: "Avg Consumption", value: dailyRate > 1e-9 ? `${formatQty(dailyRate, uom)}/day` : "No recent data" },
          { label: "Minimum Stock", value: formatQty(minStock, uom) },
        ],
        severity: 1000,
      };
    }
    if (dailyRate > 1e-9) {
      const daysUntilMin = (unrestricted - minStock) / dailyRate;
      if (daysUntilMin <= APPROACHING_MIN_STOCK_DAYS) {
        return {
          materialId,
          materialName,
          type: "HIGH_RISK",
          typeLabel: "High Inventory Risk",
          explanation: `Usable stock is ${formatQty(unrestricted, uom)} with average consumption of ${formatQty(dailyRate, uom)}/day. This gives approximately ${formatNumber(daysCover!, 1)} days of cover, with minimum stock at ${formatQty(minStock, uom)}. Stock is likely to reach minimum stock in about ${daysUntilMin < 1 ? "less than a day" : `${formatNumber(daysUntilMin, 0)} day${daysUntilMin >= 1.5 ? "s" : ""}`}.${incomingNote}`,
          metrics: [
            { label: "Usable Stock", value: formatQty(unrestricted, uom) },
            { label: "Avg Consumption", value: `${formatQty(dailyRate, uom)}/day` },
            { label: "Minimum Stock", value: formatQty(minStock, uom) },
          ],
          severity: 900 - daysUntilMin * 10,
        };
      }
    }
  }

  // Type 2: QC Hold / Blocked stock materially reducing what's actually usable.
  const held = qcHold + blocked;
  if (onHand > 0 && held / onHand >= QUALITY_HOLD_FRACTION_THRESHOLD) {
    return {
      materialId,
      materialName,
      type: "QUALITY_HOLD_RISK",
      typeLabel: "Usable Stock Risk",
      explanation: `${formatQty(onHand, uom)} is physically on hand, but ${formatQty(held, uom)} is on QC Hold or Blocked, leaving only ${formatQty(unrestricted, uom)} usable.`,
      metrics: [
        { label: "On Hand", value: formatQty(onHand, uom) },
        { label: "Held (QC/Blocked)", value: formatQty(held, uom) },
        { label: "Usable", value: formatQty(unrestricted, uom) },
      ],
      severity: 700 + Math.min(200, (held / onHand) * 200),
    };
  }

  // Type 3: moderate days of cover, without an explicit safety-stock threshold to compare to.
  if (daysCover != null && daysCover <= MEDIUM_RISK_DAYS_OF_COVER) {
    return {
      materialId,
      materialName,
      type: "MEDIUM_RISK",
      typeLabel: "Medium Risk",
      explanation: `${formatNumber(daysCover, 1)} days of cover based on current usable stock (${formatQty(unrestricted, uom)}) and recent average consumption (${formatQty(dailyRate, uom)}/day).`,
      metrics: [
        { label: "Days of Cover", value: `${formatNumber(daysCover, 1)} days` },
        { label: "Usable Stock", value: formatQty(unrestricted, uom) },
      ],
      severity: 500 - daysCover * 10,
    };
  }

  // Type 4 (supplementary): recent consumption running well above its own trailing average.
  if (distinctConsumptionDays >= ANOMALY_MIN_DISTINCT_DAYS && totalTrailingConsumption >= ANOMALY_MIN_TRAILING_QTY) {
    const pctAbove = dailyRate > 1e-9 ? ((recentDailyRate - dailyRate) / dailyRate) * 100 : 0;
    if (pctAbove >= ANOMALY_THRESHOLD_PCT) {
      return {
        materialId,
        materialName,
        type: "CONSUMPTION_ANOMALY",
        typeLabel: "Unusual Consumption",
        explanation: `Consumption over the last ${RECENT_WINDOW_DAYS} days is ${formatPct(pctAbove, 0)} above the ${TRAILING_WINDOW_DAYS}-day average — worth a quick review.`,
        metrics: [
          { label: "Recent Avg", value: `${formatQty(recentDailyRate, uom)}/day` },
          { label: `${TRAILING_WINDOW_DAYS}-day Avg`, value: `${formatQty(dailyRate, uom)}/day` },
        ],
        // Capped below the stock-risk tiers — an anomaly is worth surfacing but shouldn't
        // crowd out a material that's actually running low.
        severity: Math.min(400, 300 + pctAbove),
      };
    }
  }

  return null;
}

/**
 * Builds the MaterialRiskInput for exactly one material, on demand — the single-material
 * counterpart to getInventoryInsights()'s batched loop below (used there for the whole active
 * catalog at once). Reuses the same single-material helpers the rest of the app already has for
 * on-hand and QC Hold/Blocked (getTotalOnHand, getTotalQualityBalances) rather than re-deriving
 * that math a second time. Exists so a "why is <material> critical" question (Bruce AI) can
 * evaluate any material regardless of whether it made getInventoryInsights()'s top-5 cut.
 */
export async function getMaterialRiskInputs(materialId: string): Promise<MaterialRiskInput> {
  const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });

  const since = new Date();
  since.setDate(since.getDate() - TRAILING_WINDOW_DAYS);
  since.setHours(0, 0, 0, 0);
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - RECENT_WINDOW_DAYS);

  const [onHand, { qcHold, blocked }, consumptionTx, openPOs] = await Promise.all([
    getTotalOnHand(materialId),
    getTotalQualityBalances(materialId),
    prisma.inventoryTransaction.findMany({
      where: { materialId, transactionType: "CONSUMPTION", timestamp: { gte: since } },
      select: { quantity: true, timestamp: true },
    }),
    prisma.purchaseReference.findMany({ where: { materialId, status: { in: ["EXPECTED", "PARTIALLY_RECEIVED"] } }, select: { orderedQuantity: true } }),
  ]);

  let total = 0;
  let recentTotal = 0;
  const distinctDays = new Set<string>();
  for (const c of consumptionTx) {
    total += c.quantity;
    distinctDays.add(c.timestamp.toISOString().slice(0, 10));
    if (c.timestamp >= recentCutoff) recentTotal += c.quantity;
  }
  const incomingQuantity = openPOs.reduce((s, po) => s + po.orderedQuantity, 0);

  return {
    materialId: material.id,
    materialName: material.name,
    uom: material.uom,
    onHand,
    qcHold,
    blocked,
    minStock: material.minStock ?? null,
    dailyRate: total / TRAILING_WINDOW_DAYS,
    recentDailyRate: recentTotal / RECENT_WINDOW_DAYS,
    distinctConsumptionDays: distinctDays.size,
    totalTrailingConsumption: total,
    incomingQuantity,
  };
}

/** "Why is `<material>` critical/high-risk" — null when the material has no risk signal at all (an honest "nothing concerning right now," not a forced explanation). */
export async function getMaterialRiskExplanation(materialId: string): Promise<InventoryInsight | null> {
  return evaluateMaterialRisk(await getMaterialRiskInputs(materialId));
}

/**
 * Deterministic risk scoring + templated natural-language explanation over existing persisted
 * data — no external model call, no new data store. "AI" here is the insight-generation and
 * prioritization step described in the spec's pipeline (Data -> Metrics -> Explanation ->
 * Dashboard), not a chatbot or ML service; this app has no existing AI backend to route through,
 * and the spec explicitly says not to introduce one unless already required.
 *
 * Purely advisory: this never touches InventoryTransaction/QualityBalance/etc, only reads them.
 */
export async function getInventoryInsights(): Promise<{ insights: InventoryInsight[]; hasConsumptionData: boolean }> {
  const materials = await prisma.material.findMany({
    where: { active: true },
    include: { balances: { where: { location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } } } },
  });

  const qualityBalances = await prisma.qualityBalance.findMany({ where: { materialId: { in: materials.map((m) => m.id) } } });
  const qcHoldByMaterial = new Map<string, number>();
  const blockedByMaterial = new Map<string, number>();
  for (const q of qualityBalances) {
    const map = q.status === "QC_HOLD" ? qcHoldByMaterial : q.status === "BLOCKED" ? blockedByMaterial : null;
    if (map) map.set(q.materialId, (map.get(q.materialId) ?? 0) + q.quantity);
  }

  const since = new Date();
  since.setDate(since.getDate() - TRAILING_WINDOW_DAYS);
  since.setHours(0, 0, 0, 0);
  const consumptionTx = await prisma.inventoryTransaction.findMany({
    where: { transactionType: "CONSUMPTION", timestamp: { gte: since } },
    select: { materialId: true, quantity: true, timestamp: true },
  });
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - RECENT_WINDOW_DAYS);
  const consumptionByMaterial = new Map<string, { total: number; recentTotal: number; distinctDays: Set<string> }>();
  for (const c of consumptionTx) {
    const entry = consumptionByMaterial.get(c.materialId) ?? { total: 0, recentTotal: 0, distinctDays: new Set<string>() };
    entry.total += c.quantity;
    entry.distinctDays.add(c.timestamp.toISOString().slice(0, 10));
    if (c.timestamp >= recentCutoff) entry.recentTotal += c.quantity;
    consumptionByMaterial.set(c.materialId, entry);
  }

  // Open purchase orders — context for whether a stock risk is already being addressed.
  const openPOs = await prisma.purchaseReference.findMany({
    where: { status: { in: ["EXPECTED", "PARTIALLY_RECEIVED"] } },
    select: { materialId: true, orderedQuantity: true },
  });
  const incomingByMaterial = new Map<string, number>();
  for (const po of openPOs) incomingByMaterial.set(po.materialId, (incomingByMaterial.get(po.materialId) ?? 0) + po.orderedQuantity);

  let hasConsumptionData = false;
  const candidates: InventoryInsight[] = [];

  for (const m of materials) {
    const onHand = m.balances.reduce((s, b) => s + b.quantity, 0);
    const c = consumptionByMaterial.get(m.id);
    const dailyRate = c ? c.total / TRAILING_WINDOW_DAYS : 0;
    if (dailyRate > 1e-9) hasConsumptionData = true;

    const insight = evaluateMaterialRisk({
      materialId: m.id,
      materialName: m.name,
      uom: m.uom,
      onHand,
      qcHold: qcHoldByMaterial.get(m.id) ?? 0,
      blocked: blockedByMaterial.get(m.id) ?? 0,
      minStock: m.minStock ?? null,
      dailyRate,
      recentDailyRate: c ? c.recentTotal / RECENT_WINDOW_DAYS : 0,
      distinctConsumptionDays: c?.distinctDays.size ?? 0,
      totalTrailingConsumption: c?.total ?? 0,
      incomingQuantity: incomingByMaterial.get(m.id) ?? 0,
    });
    if (insight) candidates.push(insight);
  }

  candidates.sort((a, b) => b.severity - a.severity);
  return { insights: candidates.slice(0, MAX_INSIGHTS), hasConsumptionData };
}
