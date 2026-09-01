import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import { postProduction } from "@/lib/inventory/production";
import { getBalance } from "./helpers";
import { makeLocation, makeMaterial } from "./helpers";
import { prisma } from "@/lib/db";

describe("production", () => {
  it("posting production auto-consumes configured inputs from their default locations", async () => {
    const clinkerLoc = await makeLocation({ name: "Clinker Store" });
    const rawMealLoc = await makeLocation({ name: "Raw Meal Silo" });
    const coalLoc = await makeLocation({ name: "Coal Yard" });

    const rawMeal = await makeMaterial({ category: "INTERMEDIATE", defaultLocationId: rawMealLoc.id });
    const coal = await makeMaterial({ category: "FUEL", defaultLocationId: coalLoc.id });
    const clinker = await makeMaterial({ category: "INTERMEDIATE", defaultLocationId: clinkerLoc.id });

    await prisma.consumptionCoefficient.create({ data: { outputMaterialId: clinker.id, inputMaterialId: rawMeal.id, rate: 1.55 } });
    await prisma.consumptionCoefficient.create({ data: { outputMaterialId: clinker.id, inputMaterialId: coal.id, rate: 0.1 } });

    await postMovement({ materialId: rawMeal.id, transactionType: "RECEIPT", quantity: 5000, uom: "MT", locationId: rawMealLoc.id });
    await postMovement({ materialId: coal.id, transactionType: "RECEIPT", quantity: 1000, uom: "MT", locationId: coalLoc.id });

    const result = await postProduction({ outputMaterialId: clinker.id, outputLocationId: clinkerLoc.id, quantity: 1000, processName: "Kiln" });

    expect(await getBalance(clinker.id, clinkerLoc.id)).toBeCloseTo(1000, 6);
    expect(await getBalance(rawMeal.id, rawMealLoc.id)).toBeCloseTo(5000 - 1550, 6);
    expect(await getBalance(coal.id, coalLoc.id)).toBeCloseTo(1000 - 100, 6);
    expect(result.consumedInputs).toHaveLength(2);
  });

  it("skips an input with no configured default location rather than guessing", async () => {
    const outputLoc = await makeLocation();
    const output = await makeMaterial({ category: "FINISHED_GOODS", defaultLocationId: outputLoc.id });
    const inputNoLocation = await makeMaterial({ category: "ADDITIVE" }); // no defaultLocationId

    await prisma.consumptionCoefficient.create({ data: { outputMaterialId: output.id, inputMaterialId: inputNoLocation.id, rate: 0.5 } });

    const result = await postProduction({ outputMaterialId: output.id, outputLocationId: outputLoc.id, quantity: 100 });
    expect(result.consumedInputs).toHaveLength(0);
    expect(await getBalance(output.id, outputLoc.id)).toBeCloseTo(100, 6);
  });
});
