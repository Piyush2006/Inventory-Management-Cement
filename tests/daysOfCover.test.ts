import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import { computeDaysOfCover } from "@/lib/inventory/daysOfCover";
import { makeLocation, makeMaterial } from "./helpers";

describe("days of cover", () => {
  it("computes stock ÷ 30-day average daily consumption", async () => {
    const location = await makeLocation();
    const material = await makeMaterial({ category: "FUEL" });

    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 12000, uom: "MT", locationId: location.id });
    for (let i = 0; i < 30; i++) {
      await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 400, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - i * 86400000) });
    }

    const result = await computeDaysOfCover(material.id);
    expect(result.na).toBe(false);
    expect(result.dailyConsumption).toBeCloseTo(400, 0);
    expect(result.daysCover).toBeCloseTo(0, 1); // fully consumed by the loop above
  });

  it("returns N/A instead of dividing by zero when there's no consumption history", async () => {
    const location = await makeLocation();
    const material = await makeMaterial();
    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 5000, uom: "MT", locationId: location.id });

    const result = await computeDaysOfCover(material.id);
    expect(result.na).toBe(true);
    expect(result.naReason).toBe("NO_CONSUMPTION_DATA");
    expect(result.daysCover).toBeNull();
  });
});
