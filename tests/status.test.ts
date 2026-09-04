import { describe, it, expect } from "vitest";
import { classifyStockStatus } from "@/lib/inventory/status";

describe("stock status classification", () => {
  it("is CRITICAL when stock is below minimum stock", () => {
    expect(classifyStockStatus({ currentStock: 700, minStock: 1000 }).status).toBe("CRITICAL");
  });

  it("is HEALTHY when stock is at or above minimum stock", () => {
    expect(classifyStockStatus({ currentStock: 1200, minStock: 1000 }).status).toBe("HEALTHY");
  });

  it("treats an unconfigured minStock as not applicable rather than crashing", () => {
    expect(classifyStockStatus({ currentStock: 50, minStock: null }).status).toBe("HEALTHY");
  });

  it("overstock is a separate flag from status — a material can be HEALTHY and overstocked at once", () => {
    const healthyButOver = classifyStockStatus({ currentStock: 1200, minStock: 1000, maxStock: 1100 });
    expect(healthyButOver.status).toBe("HEALTHY");
    expect(healthyButOver.overstock).toBe(true);

    const withinBounds = classifyStockStatus({ currentStock: 1050, minStock: 1000, maxStock: 1100 });
    expect(withinBounds.overstock).toBe(false);

    const noMaxConfigured = classifyStockStatus({ currentStock: 5000, minStock: 1000 });
    expect(noMaxConfigured.overstock).toBe(false);
  });
});
