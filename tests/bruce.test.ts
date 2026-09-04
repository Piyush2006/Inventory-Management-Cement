import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import { createStockRequest, acceptStockRequest, routeToSupervisor, assignOperator } from "@/lib/inventory/requests";
import { getMaterialRiskExplanation } from "@/lib/inventory/insights";
import { extractMaterial, extractLocation, extractPeriod } from "@/lib/bruce/entities";
import { answerBruceQuestion } from "@/lib/bruce/answer";
import { makeLocation, makeMaterial, makeUser } from "./helpers";

describe("Bruce AI — entity extraction", () => {
  it("matches a material by name and prefers the longest match when several appear in the text", () => {
    const materials = [
      { id: "m1", name: "Cement", materialCode: "CEM", uom: "MT" },
      { id: "m2", name: "Cement GP", materialCode: "CGP", uom: "MT" },
    ];
    expect(extractMaterial("what is the usable stock for cement gp", materials)?.id).toBe("m2");
    expect(extractMaterial("how much cement do we have", materials)?.id).toBe("m1");
    expect(extractMaterial("random unrelated question", materials)).toBeNull();
  });

  it("matches a location by name", () => {
    const locations = [{ id: "l1", name: "Main Store" }, { id: "l2", name: "Silo 2" }];
    expect(extractLocation("how much stock at main store", locations)?.id).toBe("l1");
    expect(extractLocation("no location mentioned here", locations)).toBeNull();
  });

  it("resolves period phrases to the right day range", () => {
    const today = extractPeriod("what did we consume today");
    expect(today.label).toBe("today");
    expect(today.from.getDate()).toBe(new Date().getDate());

    const yesterday = extractPeriod("what did we consume yesterday");
    expect(yesterday.label).toBe("yesterday");
    expect(yesterday.to.getTime()).toBeLessThan(today.from.getTime());

    const noPhrase = extractPeriod("which materials are below minimum stock");
    expect(noPhrase.label).toBe("today"); // sensible default
  });
});

describe("Bruce AI — getMaterialRiskExplanation (single-material, not capped by the top-5 list)", () => {
  it("returns a real explanation for a material genuinely at risk", async () => {
    const location = await makeLocation();
    const material = await makeMaterial({ minStock: 300 });
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 250, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 20 * 86400000) });
    for (let i = 10; i >= 1; i--) {
      await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 10, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - i * 86400000) });
    }
    const explanation = await getMaterialRiskExplanation(material.id);
    expect(explanation?.type).toBe("HIGH_RISK");
    expect(explanation?.explanation).toMatch(/already at or below/);
  });

  it("returns null for a healthy material with no risk signal", async () => {
    const location = await makeLocation();
    const material = await makeMaterial({ minStock: 100 });
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 5000, uom: "MT", locationId: location.id });
    expect(await getMaterialRiskExplanation(material.id)).toBeNull();
  });
});

describe("Bruce AI — answerBruceQuestion (end to end against real seeded data)", () => {
  it("finds a material below its minimum stock when asked which materials are below minimum stock", async () => {
    // makeMaterial()'s default name is the fixed string "Test Material" (only materialCode is
    // auto-unique) — since extractMaterial/entity-matching works by name and this vitest run
    // shares one SQLite file across every test file, an unnamed material here could collide
    // with an unrelated material of the same default name from another test. Explicit unique
    // names throughout this file for anything the intent engine needs to match by name.
    const location = await makeLocation();
    const material = await makeMaterial({ name: "Bruce Below Min Cement", minStock: 500 });
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 300, uom: "MT", locationId: location.id }); // below min -> CRITICAL
    const supervisor = await makeUser({ role: "STORE_SUPERVISOR" });

    const answer = await answerBruceQuestion("which materials are below minimum stock?", { id: supervisor.id, role: supervisor.role });
    expect(answer.text).toContain(material.name);
  });

  it("answers 'why is <material> critical' with a real, material-specific explanation", async () => {
    const location = await makeLocation();
    const material = await makeMaterial({ name: "Bruce Critical Clinker", minStock: 300 });
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 200, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - 20 * 86400000) });
    for (let i = 10; i >= 1; i--) {
      await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 5, uom: "MT", locationId: location.id, timestamp: new Date(Date.now() - i * 86400000) });
    }
    const manager = await makeUser({ role: "INVENTORY_MANAGER" });

    const answer = await answerBruceQuestion(`why is ${material.name} critical?`, { id: manager.id, role: manager.role });
    expect(answer.text).toContain(material.name);
    expect(answer.text.toLowerCase()).toMatch(/minimum stock|below/);
    expect(answer.links?.[0]?.href).toBe(`/inventory/${material.id}`);
  });

  it("scopes 'pending requests' to the asking Store Operator's own assignments, same as Reports", async () => {
    const operatorA = await makeUser({ role: "STORE_OPERATOR" });
    const operatorB = await makeUser({ role: "STORE_OPERATOR" });
    const supervisor = await makeUser({ role: "STORE_SUPERVISOR" });
    const manager = await makeUser({ role: "INVENTORY_MANAGER" });
    const requester = await makeUser({ role: "REQUESTER" });
    const from = await makeLocation();
    const to = await makeLocation();
    const material = await makeMaterial();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requester.id });
    await acceptStockRequest(request.id, manager.id);
    await routeToSupervisor(request.id, supervisor.id, manager.id);
    await assignOperator(request.id, operatorA.id, supervisor.id);

    const asA = await answerBruceQuestion("pending requests", { id: operatorA.id, role: operatorA.role });
    expect(asA.text).toContain(request.requestNumber);

    const asB = await answerBruceQuestion("pending requests", { id: operatorB.id, role: operatorB.role });
    expect(asB.text).not.toContain(request.requestNumber);
  });

  it("scopes 'pending requests' to the asking Indentor's own raised requests", async () => {
    const requesterA = await makeUser({ role: "REQUESTER" });
    const requesterB = await makeUser({ role: "REQUESTER" });
    const from = await makeLocation();
    const to = await makeLocation();
    const material = await makeMaterial();
    const request = await createStockRequest({ materialId: material.id, quantityRequested: 10, requiredByDate: new Date(), fromLocationId: from.id, toLocationId: to.id, requestedByUserId: requesterA.id });

    const asA = await answerBruceQuestion("pending requests", { id: requesterA.id, role: requesterA.role });
    expect(asA.text).toContain(request.requestNumber);

    const asB = await answerBruceQuestion("pending requests", { id: requesterB.id, role: requesterB.role });
    expect(asB.text).not.toContain(request.requestNumber);
  });

  it("falls back to the fixed in-scope message for an unrelated question", async () => {
    const user = await makeUser({ role: "ADMIN" });
    const answer = await answerBruceQuestion("what's the weather like today", { id: user.id, role: user.role });
    expect(answer.text).toMatch(/inventory, consumption, stock movements/);
  });

  it("never throws, even for an empty question", async () => {
    const user = await makeUser({ role: "ADMIN" });
    await expect(answerBruceQuestion("", { id: user.id, role: user.role })).resolves.toBeTruthy();
    await expect(answerBruceQuestion("   ", { id: user.id, role: user.role })).resolves.toBeTruthy();
  });
});
