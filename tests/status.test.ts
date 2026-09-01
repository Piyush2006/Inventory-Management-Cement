import { describe, it, expect } from "vitest";
import { classifyStockStatus } from "@/lib/inventory/status";

describe("stock status classification", () => {
  it("is CRITICAL when stock is below safety stock", () => {
    expect(classifyStockStatus({ currentStock: 200, minStock: 1000, safetyStock: 500 }).status).toBe("CRITICAL");
  });

  it("is LOW when stock is below minimum but at/above safety stock", () => {
    expect(classifyStockStatus({ currentStock: 700, minStock: 1000, safetyStock: 500 }).status).toBe("LOW");
  });

  it("is HEALTHY when stock is at or above minimum stock", () => {
    expect(classifyStockStatus({ currentStock: 1200, minStock: 1000, safetyStock: 500 }).status).toBe("HEALTHY");
  });

  it("treats an unconfigured threshold as not applicable rather than crashing", () => {
    expect(classifyStockStatus({ currentStock: 50, minStock: null, safetyStock: null }).status).toBe("HEALTHY");
  });
});
