import { describe, it, expect } from "vitest";
import { postMovement } from "@/lib/inventory/ledger";
import { changeQualityStatus } from "@/lib/inventory/quality";
import {
  createDispatch,
  approveDispatch,
  reassignDispatchOperator,
  startDispatchLoading,
  markDispatched,
  cancelDispatch,
  DispatchError,
} from "@/lib/inventory/dispatch";
import { PermissionError } from "@/lib/auth";
import { makeLocation, makeMaterial, makeUser, getBalance } from "./helpers";
import { prisma } from "@/lib/db";

async function setup(materialQty = 1000) {
  const source = await makeLocation();
  const material = await makeMaterial();
  await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: materialQty, uom: "MT", locationId: source.id });
  const requester = await makeUser({ role: "REQUESTER" });
  const supervisor = await makeUser({ role: "STORE_SUPERVISOR" });
  const manager = await makeUser({ role: "INVENTORY_MANAGER" });
  const operator = await makeUser({ role: "STORE_OPERATOR" });
  return { source, material, requester, supervisor, manager, operator };
}

describe("dispatch lifecycle", () => {
  it("walks the full path: CREATED -> APPROVED -> LOADING -> DISPATCHED, reduces stock exactly once", async () => {
    const { source, material, supervisor, operator } = await setup();
    const dispatch = await createDispatch({ materialId: material.id, quantity: 300, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    expect(dispatch.status).toBe("CREATED");

    const approved = await approveDispatch(dispatch.id, operator.id, supervisor.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.assignedToUserId).toBe(operator.id);
    expect(await getBalance(material.id, source.id)).toBeCloseTo(1000, 6); // no stock impact yet

    const loading = await startDispatchLoading(dispatch.id, operator.id);
    expect(loading.status).toBe("LOADING");
    expect(await getBalance(material.id, source.id)).toBeCloseTo(1000, 6); // still no impact

    const dispatched = await markDispatched(dispatch.id, operator.id);
    expect(dispatched.status).toBe("DISPATCHED");
    expect(dispatched.inventoryTransactionId).toBeTruthy();
    expect(await getBalance(material.id, source.id)).toBeCloseTo(700, 6); // reduced exactly once

    const tx = await prisma.inventoryTransaction.findUnique({ where: { id: dispatched.inventoryTransactionId! } });
    expect(tx?.transactionType).toBe("DISPATCH");
    expect(tx?.quantity).toBeCloseTo(300, 6);

    const events = await prisma.dispatchEvent.findMany({ where: { dispatchId: dispatch.id }, orderBy: { timestamp: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["CREATED", "APPROVED", "LOADING_STARTED", "DISPATCHED"]);
  });

  it("cannot be dispatched twice", async () => {
    const { source, material, supervisor, operator } = await setup();
    const dispatch = await createDispatch({ materialId: material.id, quantity: 100, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await approveDispatch(dispatch.id, operator.id, supervisor.id);
    await startDispatchLoading(dispatch.id, operator.id);
    await markDispatched(dispatch.id, operator.id);

    await expect(markDispatched(dispatch.id, operator.id)).rejects.toThrow(DispatchError);
  });

  it("rejects Approve/Create from a Requester and rejects Approve of a non-CREATED dispatch", async () => {
    const { source, material, requester, supervisor, operator } = await setup();
    await expect(createDispatch({ materialId: material.id, quantity: 100, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: requester.id })).rejects.toThrow(PermissionError);

    const dispatch = await createDispatch({ materialId: material.id, quantity: 100, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await expect(approveDispatch(dispatch.id, operator.id, requester.id)).rejects.toThrow(PermissionError);

    await approveDispatch(dispatch.id, operator.id, supervisor.id);
    await expect(approveDispatch(dispatch.id, operator.id, supervisor.id)).rejects.toThrow(DispatchError);
  });

  it("only the assigned Store Operator can start loading or mark dispatched — not a different operator — but Admin bypasses ownership", async () => {
    const { source, material, supervisor, operator } = await setup();
    const otherOperator = await makeUser({ role: "STORE_OPERATOR" });
    const admin = await makeUser({ role: "ADMIN" });
    const dispatch = await createDispatch({ materialId: material.id, quantity: 100, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await approveDispatch(dispatch.id, operator.id, supervisor.id);

    await expect(startDispatchLoading(dispatch.id, otherOperator.id)).rejects.toThrow(PermissionError);
    // Admin can act despite not being the assigned operator.
    const loading = await startDispatchLoading(dispatch.id, admin.id);
    expect(loading.status).toBe("LOADING");

    await expect(markDispatched(dispatch.id, otherOperator.id)).rejects.toThrow(PermissionError);
    const dispatched = await markDispatched(dispatch.id, operator.id); // still the originally assigned operator
    expect(dispatched.status).toBe("DISPATCHED");
  });

  it("blocks Approval when the requested quantity exceeds what's Unrestricted (QC Hold/Blocked reduces eligibility below On Hand)", async () => {
    const { source, material, supervisor, operator } = await setup(1000);
    await changeQualityStatus({ materialId: material.id, locationId: source.id, quantity: 800, fromStatus: "UNRESTRICTED", toStatus: "QC_HOLD", userId: supervisor.id, reason: "Awaiting lab clearance" });
    // Only 200 Unrestricted remains out of 1000 On Hand.

    const dispatch = await createDispatch({ materialId: material.id, quantity: 300, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await expect(approveDispatch(dispatch.id, operator.id, supervisor.id)).rejects.toThrow(DispatchError);

    // A dispatch within the Unrestricted amount still succeeds.
    const okDispatch = await createDispatch({ materialId: material.id, quantity: 150, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    const approved = await approveDispatch(okDispatch.id, operator.id, supervisor.id);
    expect(approved.status).toBe("APPROVED");
  });

  it("re-checks Unrestricted-sufficiency at Start Loading — stock placed on hold after Approval blocks the next step", async () => {
    const { source, material, supervisor, operator } = await setup(500);
    const dispatch = await createDispatch({ materialId: material.id, quantity: 400, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await approveDispatch(dispatch.id, operator.id, supervisor.id); // fine — 500 Unrestricted available

    // Stock gets placed on hold after Approval but before loading starts.
    await changeQualityStatus({ materialId: material.id, locationId: source.id, quantity: 200, fromStatus: "UNRESTRICTED", toStatus: "QC_HOLD", userId: supervisor.id, reason: "Surprise inspection" });

    await expect(startDispatchLoading(dispatch.id, operator.id)).rejects.toThrow(DispatchError);
  });

  it("supports reassigning the operator while APPROVED, but not once LOADING has started", async () => {
    const { source, material, supervisor, operator } = await setup();
    const otherOperator = await makeUser({ role: "STORE_OPERATOR" });
    const dispatch = await createDispatch({ materialId: material.id, quantity: 100, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await approveDispatch(dispatch.id, operator.id, supervisor.id);

    const reassigned = await reassignDispatchOperator(dispatch.id, otherOperator.id, supervisor.id);
    expect(reassigned.assignedToUserId).toBe(otherOperator.id);
    // The original operator, no longer assigned, can no longer act.
    await expect(startDispatchLoading(dispatch.id, operator.id)).rejects.toThrow(PermissionError);

    await startDispatchLoading(dispatch.id, otherOperator.id);
    await expect(reassignDispatchOperator(dispatch.id, operator.id, supervisor.id)).rejects.toThrow(DispatchError);
  });

  it("cancels from CREATED, APPROVED, and LOADING with no inventory impact, but rejects once DISPATCHED and requires a reason", async () => {
    const { source, material, supervisor, operator } = await setup();

    const d1 = await createDispatch({ materialId: material.id, quantity: 50, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    const c1 = await cancelDispatch(d1.id, supervisor.id, "Customer changed order");
    expect(c1.status).toBe("CANCELLED");
    await expect(cancelDispatch(d1.id, supervisor.id, "again")).rejects.toThrow(DispatchError);

    const d2 = await createDispatch({ materialId: material.id, quantity: 50, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await approveDispatch(d2.id, operator.id, supervisor.id);
    const c2 = await cancelDispatch(d2.id, supervisor.id, "Vehicle unavailable");
    expect(c2.status).toBe("CANCELLED");

    const d3 = await createDispatch({ materialId: material.id, quantity: 50, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await approveDispatch(d3.id, operator.id, supervisor.id);
    await startDispatchLoading(d3.id, operator.id);
    await expect(cancelDispatch(d3.id, supervisor.id, "")).rejects.toThrow(DispatchError);
    const c3 = await cancelDispatch(d3.id, supervisor.id, "Weighbridge fault");
    expect(c3.status).toBe("CANCELLED");
    expect(await getBalance(material.id, source.id)).toBeCloseTo(1000 - 0, 6); // none of the three touched stock

    const d4 = await createDispatch({ materialId: material.id, quantity: 50, sourceLocationId: source.id, customerDestination: "Acme Concrete Co", createdByUserId: supervisor.id });
    await approveDispatch(d4.id, operator.id, supervisor.id);
    await startDispatchLoading(d4.id, operator.id);
    await markDispatched(d4.id, operator.id);
    await expect(cancelDispatch(d4.id, supervisor.id, "too late")).rejects.toThrow(DispatchError);
  });
});
