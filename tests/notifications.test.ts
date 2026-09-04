import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { triggerNotification } from "@/lib/notifications/engine";
import { checkStockThresholds } from "@/lib/notifications/stockThreshold";
import { renderTemplate } from "@/lib/notifications/templates";
import { postMovement } from "@/lib/inventory/ledger";
import { makeLocation, makeMaterial, makeUser } from "./helpers";

async function makeRule(overrides: Partial<{
  event: string; recipientType: string; recipientRole: string | null; recipientUserId: string | null;
  channel: string; status: string; notificationType: string; title: string; message: string;
}> = {}) {
  return prisma.notificationRule.create({
    data: {
      event: overrides.event ?? "REQUEST_CREATED",
      recipientType: overrides.recipientType ?? "ROLE",
      recipientRole: overrides.recipientRole ?? "STORE_SUPERVISOR",
      recipientUserId: overrides.recipientUserId ?? null,
      channel: overrides.channel ?? "IN_APP",
      status: overrides.status ?? "ENABLED",
      notificationType: overrides.notificationType ?? "ACTION_REQUIRED",
      title: overrides.title ?? "New Request {reference}",
      message: overrides.message ?? "{quantity} {material} requires your action.",
    },
  });
}

describe("renderTemplate", () => {
  it("substitutes only known keys and leaves an unmatched token literal", () => {
    expect(renderTemplate("Hello {name}, stock is {currentStock}", { name: "Amit" })).toBe("Hello Amit, stock is {currentStock}");
  });
});

describe("triggerNotification (engine)", () => {
  it("an ENABLED rule creates a Notification for every resolved recipient with the rendered template", async () => {
    // ROLE-based resolution queries every active STORE_SUPERVISOR network-wide — this vitest
    // run shares one SQLite file across all test files (fileParallelism: false), and other
    // test files also create STORE_SUPERVISOR users, so the notification set for this rule can
    // legitimately be larger than just the two created here. Assert containment + the specific
    // rows for these two, not the full set's size — same defensive pattern as insights.test.ts.
    const supervisor = await makeUser({ role: "STORE_SUPERVISOR" });
    const otherSupervisor = await makeUser({ role: "STORE_SUPERVISOR" });
    const material = await makeMaterial();
    const rule = await makeRule({ event: "REQUEST_CREATED", title: "New Request {reference}", message: "{quantity} {material} needs action" });

    await triggerNotification("REQUEST_CREATED", { recordId: "req-1", materialId: material.id, quantity: 500, reference: "REQ-1024", link: "/requests/req-1" });

    const notifications = await prisma.notification.findMany({ where: { ruleId: rule.id } });
    const recipientIds = notifications.map((n) => n.recipientUserId);
    expect(recipientIds).toContain(supervisor.id);
    expect(recipientIds).toContain(otherSupervisor.id);

    const mine = notifications.find((n) => n.recipientUserId === supervisor.id)!;
    expect(mine.title).toBe("New Request REQ-1024");
    expect(mine.message).toContain(`500 MT ${material.name}`);
    expect(mine.link).toBe("/requests/req-1");
    expect(mine.channel).toBe("IN_APP");
    expect(mine.emailStatus).toBe("NOT_APPLICABLE");
  });

  it("a DISABLED rule does not fire", async () => {
    await makeUser({ role: "STORE_SUPERVISOR" });
    const material = await makeMaterial();
    const rule = await makeRule({ event: "REQUEST_CREATED", status: "DISABLED" });

    await triggerNotification("REQUEST_CREATED", { recordId: "req-2", materialId: material.id, quantity: 10, reference: "REQ-DISABLED" });

    const notifications = await prisma.notification.findMany({ where: { ruleId: rule.id } });
    expect(notifications).toHaveLength(0);
  });

  it("RELEVANT_USER resolves to the correct person for the event, and creates zero rows when unresolved", async () => {
    const operator = await makeUser({ role: "STORE_OPERATOR" });
    const otherOperator = await makeUser({ role: "STORE_OPERATOR" });
    const material = await makeMaterial();
    const rule = await makeRule({ event: "REQUEST_ASSIGNED", recipientType: "RELEVANT_USER", recipientRole: null });

    await triggerNotification("REQUEST_ASSIGNED", { recordId: "req-3", materialId: material.id, quantity: 20, reference: "REQ-ASSIGNED", assignedToUserId: operator.id });

    const notifications = await prisma.notification.findMany({ where: { ruleId: rule.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipientUserId).toBe(operator.id);
    void otherOperator;

    // No assignedToUserId in context -> resolver returns undefined -> zero rows, not a crash.
    const rule2 = await makeRule({ event: "REQUEST_ASSIGNED", recipientType: "RELEVANT_USER", recipientRole: null });
    await triggerNotification("REQUEST_ASSIGNED", { recordId: "req-4", materialId: material.id, quantity: 5, reference: "REQ-UNASSIGNED" });
    expect(await prisma.notification.findMany({ where: { ruleId: rule2.id } })).toHaveLength(0);
  });

  it("EMAIL/BOTH channel attempts a simulated send and records emailStatus", async () => {
    const supervisor = await makeUser({ role: "STORE_SUPERVISOR", email: "supervisor@example.test" });
    const material = await makeMaterial();
    const rule = await makeRule({ event: "REQUEST_CREATED", channel: "BOTH" });

    await triggerNotification("REQUEST_CREATED", { recordId: "req-5", materialId: material.id, quantity: 1, reference: "REQ-EMAIL" });

    const notification = await prisma.notification.findFirstOrThrow({ where: { ruleId: rule.id, recipientUserId: supervisor.id } });
    expect(notification.channel).toBe("BOTH");
    expect(notification.emailStatus).toBe("SENT");
  });

  it("EMAIL channel fails gracefully (recorded, not thrown) when the recipient has no email on file", async () => {
    const supervisor = await makeUser({ role: "STORE_SUPERVISOR" }); // no email
    const material = await makeMaterial();
    const rule = await makeRule({ event: "REQUEST_CREATED", channel: "EMAIL" });

    await triggerNotification("REQUEST_CREATED", { recordId: "req-6", materialId: material.id, quantity: 1, reference: "REQ-NOEMAIL" });

    const notification = await prisma.notification.findFirstOrThrow({ where: { ruleId: rule.id, recipientUserId: supervisor.id } });
    expect(notification.emailStatus).toBe("FAILED");
    expect(notification.emailError).toBeTruthy();
  });

  it("never throws even when something inside goes wrong (e.g. an event with no rules at all)", async () => {
    await expect(triggerNotification("STOCK_LOW", { materialId: "does-not-exist" })).resolves.toBeUndefined();
  });
});

describe("checkStockThresholds", () => {
  it("fires STOCK_CRITICAL once on the HEALTHY->CRITICAL transition and does not re-fire while still CRITICAL", async () => {
    const manager = await makeUser({ role: "INVENTORY_MANAGER" });
    const location = await makeLocation();
    const material = await makeMaterial({ minStock: 500 });
    const rule = await makeRule({ event: "STOCK_CRITICAL", recipientType: "ROLE", recipientRole: "INVENTORY_MANAGER" });
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 400, uom: "MT", locationId: location.id }); // below minStock -> CRITICAL

    // Scoped by this test's own ruleId — ROLE-based rules created by earlier tests in this
    // file stay ENABLED and also match any INVENTORY_MANAGER, so counting by
    // recipientUserId+relatedRecordId alone would double-count across rules from other tests.
    await checkStockThresholds(material.id);
    let count = await prisma.notification.count({ where: { ruleId: rule.id, recipientUserId: manager.id } });
    expect(count).toBe(1);

    await checkStockThresholds(material.id); // still CRITICAL, no new balance change
    count = await prisma.notification.count({ where: { ruleId: rule.id, recipientUserId: manager.id } });
    expect(count).toBe(1);
  });

  it("re-fires on CRITICAL after recovering to HEALTHY, and never fires STOCK_LOW (unreachable now that Min is the only understock threshold)", async () => {
    const manager = await makeUser({ role: "INVENTORY_MANAGER" });
    const location = await makeLocation();
    const material = await makeMaterial({ minStock: 500 });
    const lowRule = await makeRule({ event: "STOCK_LOW", recipientType: "ROLE", recipientRole: "INVENTORY_MANAGER" });
    const criticalRule = await makeRule({ event: "STOCK_CRITICAL", recipientType: "ROLE", recipientRole: "INVENTORY_MANAGER" });

    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 1000, uom: "MT", locationId: location.id }); // HEALTHY
    await checkStockThresholds(material.id);
    expect(await prisma.notification.count({ where: { ruleId: criticalRule.id, recipientUserId: manager.id } })).toBe(0);

    await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 700, uom: "MT", locationId: location.id }); // 300 left -> CRITICAL
    await checkStockThresholds(material.id);
    expect(await prisma.notification.count({ where: { ruleId: criticalRule.id, recipientUserId: manager.id } })).toBe(1);

    await postMovement({ materialId: material.id, transactionType: "RECEIPT", quantity: 1000, uom: "MT", locationId: location.id }); // back to HEALTHY
    await checkStockThresholds(material.id);
    expect(await prisma.notification.count({ where: { ruleId: criticalRule.id, recipientUserId: manager.id } })).toBe(1); // recovery doesn't fire

    await postMovement({ materialId: material.id, transactionType: "CONSUMPTION", quantity: 900, uom: "MT", locationId: location.id }); // CRITICAL again
    await checkStockThresholds(material.id);
    expect(await prisma.notification.count({ where: { ruleId: criticalRule.id, recipientUserId: manager.id } })).toBe(2); // re-fires

    expect(await prisma.notification.count({ where: { ruleId: lowRule.id, recipientUserId: manager.id } })).toBe(0);
  });

  it("never fires and never writes MaterialAlertState for a material with no minStock", async () => {
    const location = await makeLocation();
    const material = await makeMaterial(); // no thresholds
    await postMovement({ materialId: material.id, transactionType: "OPENING_BALANCE", quantity: 10, uom: "MT", locationId: location.id });

    await checkStockThresholds(material.id);

    expect(await prisma.materialAlertState.findUnique({ where: { materialId: material.id } })).toBeNull();
    expect(await prisma.notification.count({ where: { relatedRecordId: material.id } })).toBe(0);
  });
});
