import { prisma } from "@/lib/db";
import { postMovement } from "@/lib/inventory/ledger";

export interface PostProductionInput {
  outputMaterialId: string;
  outputLocationId: string;
  quantity: number;
  processName?: string;
  timestamp?: Date;
  note?: string;
  userId?: string;
}

export interface PostProductionResult {
  productionTransactionId: string;
  consumedInputs: { materialId: string; materialName: string; quantity: number; locationId: string }[];
}

/**
 * Posts a production output and, from the configured recipe (ConsumptionCoefficient
 * rows keyed by output material), automatically posts the matching CONSUMPTION
 * movements for each input — e.g. producing Clinker consumes Raw Meal + Coal + Alt
 * Fuel; producing Cement GP consumes Clinker + Gypsum. Coefficients are configurable
 * demo data, not a hard-coded recipe.
 */
export async function postProduction(input: PostProductionInput): Promise<PostProductionResult> {
  const outputMaterial = await prisma.material.findUniqueOrThrow({ where: { id: input.outputMaterialId } });
  const timestamp = input.timestamp ?? new Date();

  const productionTx = await postMovement({
    materialId: input.outputMaterialId,
    transactionType: "PRODUCTION",
    quantity: input.quantity,
    uom: outputMaterial.uom,
    locationId: input.outputLocationId,
    timestamp,
    processName: input.processName,
    reference: input.note,
    userId: input.userId,
  });

  const coefficients = await prisma.consumptionCoefficient.findMany({
    where: { outputMaterialId: input.outputMaterialId, active: true },
    include: { inputMaterial: true },
  });

  const consumedInputs: PostProductionResult["consumedInputs"] = [];
  for (const coeff of coefficients) {
    const inputMaterial = coeff.inputMaterial;
    if (!inputMaterial.defaultLocationId) continue; // no configured source location — skip rather than guess
    const consumeQty = coeff.rate * input.quantity;
    if (consumeQty <= 0) continue;

    await postMovement({
      materialId: inputMaterial.id,
      transactionType: "CONSUMPTION",
      quantity: consumeQty,
      uom: inputMaterial.uom,
      locationId: inputMaterial.defaultLocationId,
      timestamp,
      processName: input.processName,
      reference: `Auto-consumed for ${outputMaterial.name} production`,
      userId: input.userId,
    });
    consumedInputs.push({ materialId: inputMaterial.id, materialName: inputMaterial.name, quantity: consumeQty, locationId: inputMaterial.defaultLocationId });
  }

  return { productionTransactionId: productionTx.id, consumedInputs };
}
