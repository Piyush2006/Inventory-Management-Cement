import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import { evaluateMaterialRisk, getInventoryInsights, getMaterialRiskInputs, type MaterialRiskInput } from "@/lib/inventory/insights";
import { makeLocation, makeMaterial } from "./helpers";

// evaluateMaterialRisk is a pure function — no DB, no shared state — so these tests exercise the
// actual risk-selection logic directly and deterministically. getInventoryInsights() itself
// queries every active material network-wide (by design, for the Dashboard), and vitest shares
// one SQLite file across all test files (fileParallelism: false), so it's only smoke-tested below
// (wiring + the MAX_INSIGHTS cap), never asserted against for specific per-material outcomes.
function baseInput(overrides: Partial<MaterialRiskInput> = {}): MaterialRiskInput {
  return {
    materialId: "mat-1",
    materialName: "Test Material",
    uom: "MT",
    onHand: 1000,
    qcHold: 0,
    blocked: 0,
    minStock: null,
    dailyRate: 0,
    recentDailyRate: 0,
    distinctConsumptionDays: 0,
    totalTrailingConsumption: 0,
    incomingQuantity: 0,
    ...overrides,
  };
}

describe("evaluateMaterialRisk", () => {
  it("flags High Inventory Risk once usable stock is already at or below minimum stock", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 250, minStock: 300, dailyRate: 10 }));
    expect(insight?.type).toBe("HIGH_RISK");
    expect(insight?.explanation).toMatch(/already at or below/);
  });

  it("flags High Inventory Risk when already below minimum stock even with zero recorded consumption (dailyRate: 0)", () => {
    // A material seeded critically low from day one, never yet consumed — classifyStockStatus
    // (the plain threshold check) already calls this CRITICAL; evaluateMaterialRisk must not
    // silently say nothing just because there's no rate to project a days-until-minimum-stock
    // figure with. Regression test for a real contradiction Bruce AI's "why is X critical"
    // surfaced: the material appeared in the Critical Stock list but got no explanation at all.
    const insight = evaluateMaterialRisk(baseInput({ onHand: 80, minStock: 100, dailyRate: 0 }));
    expect(insight?.type).toBe("HIGH_RISK");
    expect(insight?.explanation).toMatch(/already at or below/);
    expect(insight?.explanation).toMatch(/consumption.*recorded|can't be estimated/i);
  });

  it("flags High Inventory Risk (approaching) when projected to cross minimum stock within a week", () => {
    // 400 usable, 20/day -> reaches 300 minimum stock in 5 days (<= 7-day threshold).
    const insight = evaluateMaterialRisk(baseInput({ onHand: 400, minStock: 300, dailyRate: 20 }));
    expect(insight?.type).toBe("HIGH_RISK");
    expect(insight?.explanation).toMatch(/likely to reach minimum stock in about 5 days/);
  });

  it("does not flag High Inventory Risk when comfortably above minimum stock", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 5000, minStock: 100, dailyRate: 5 }));
    expect(insight).toBeNull();
  });

  it("mentions an open purchase order that covers the minimum-stock gap", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 250, minStock: 300, dailyRate: 10, incomingQuantity: 500 }));
    expect(insight?.explanation).toMatch(/already on order/);
  });

  it("notes when incoming stock does not cover the gap", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 250, minStock: 300, dailyRate: 10, incomingQuantity: 10 }));
    expect(insight?.explanation).toMatch(/No sufficient incoming stock/);
  });

  it("flags Usable Stock Risk when QC Hold/Blocked removes a large share of On Hand", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 600, qcHold: 200 }));
    expect(insight?.type).toBe("QUALITY_HOLD_RISK");
    expect(insight?.explanation).toContain("600 MT is physically on hand");
    expect(insight?.explanation).toContain("400 MT usable");
  });

  it("does not flag Usable Stock Risk for a small hold that barely dents On Hand", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 1000, qcHold: 20 }));
    expect(insight).toBeNull();
  });

  it("prefers High Inventory Risk over Usable Stock Risk when both conditions are met", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 250, minStock: 300, dailyRate: 10, qcHold: 50 }));
    expect(insight?.type).toBe("HIGH_RISK");
  });

  it("flags Medium Risk from low days of cover when there's no minimum stock to compare to", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 50, minStock: null, dailyRate: 10 })); // 5 days of cover
    expect(insight?.type).toBe("MEDIUM_RISK");
  });

  it("does not flag Medium Risk when days of cover is comfortably high", () => {
    const insight = evaluateMaterialRisk(baseInput({ onHand: 5000, dailyRate: 10 })); // 500 days of cover
    expect(insight).toBeNull();
  });

  it("flags Unusual Consumption when the recent rate runs well above the trailing average", () => {
    const insight = evaluateMaterialRisk(
      baseInput({ onHand: 100000, dailyRate: 10, recentDailyRate: 14, distinctConsumptionDays: 14, totalTrailingConsumption: 300 }),
    );
    expect(insight?.type).toBe("CONSUMPTION_ANOMALY");
    expect(insight?.explanation).toMatch(/40% above the 30-day average/);
  });

  it("does not flag Unusual Consumption without enough historical days, even if the rate spiked", () => {
    const insight = evaluateMaterialRisk(
      baseInput({ onHand: 100000, dailyRate: 10, recentDailyRate: 20, distinctConsumptionDays: 2, totalTrailingConsumption: 60 }),
    );
    expect(insight).toBeNull();
  });

  it("returns null when a material has no stock signal at all", () => {
    expect(evaluateMaterialRisk(baseInput())).toBeNull();
  });
});

describe("getInventoryInsights (integration)", () => {
  it("computes a real HIGH_RISK signal for a freshly created at-risk material, wired through the same builder getInventoryInsights uses", async () => {
    const location = await makeLocation();
    const material = await makeMaterial({ minStock: 300 });
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 250, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 20 * 86400000) });
    for (let i = 10; i >= 1; i--) {
      await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 10, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - i * 86400000) });
    }

    // Single-material check via the exact same input-builder getInventoryInsights() uses
    // internally — proves the wiring is correct without depending on this material winning a
    // top-5 tie-break against whatever other materials the shared test DB (fileParallelism:
    // false) happens to contain from other test files at severity 1000.
    const insight = evaluateMaterialRisk(await getMaterialRiskInputs(material.id));
    expect(insight?.type).toBe("HIGH_RISK");
  });

  it("never returns more than 5 insights", async () => {
    const { insights } = await getInventoryInsights();
    expect(insights.length).toBeLessThanOrEqual(5);
  });
});
