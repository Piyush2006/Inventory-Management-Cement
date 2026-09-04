import { prisma } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { NOTIFICATION_EVENT_META, type NotificationEvent } from "./events";
import { resolveRecipients } from "./recipients";
import { renderTemplate } from "./templates";
import { sendEmail } from "./email";
import type { NotificationContext } from "./types";

/**
 * The single entry point every src/app/actions.ts hook calls, right after its lib call
 * succeeds. Looks up ENABLED rules for `event`, resolves recipients + renders the message per
 * rule, persists one Notification row per recipient, and "sends" email where the rule's channel
 * calls for it. Never throws — a notification failure must never break the calling action
 * (spec section 15), enforced structurally here rather than by convention at each call site.
 */
export async function triggerNotification(event: NotificationEvent, context: NotificationContext): Promise<void> {
  try {
    const rules = await prisma.notificationRule.findMany({ where: { event, status: "ENABLED" } });
    if (rules.length === 0) return;

    // Name resolution happens here, once per trigger call, shared across every matching rule —
    // not at the actions.ts call site, which only ever has raw ids in scope.
    const [material, location] = await Promise.all([
      context.materialId ? prisma.material.findUnique({ where: { id: context.materialId } }) : null,
      context.locationId ? prisma.location.findUnique({ where: { id: context.locationId } }) : null,
    ]);

    const uom = material?.uom;
    const withUom = (n: number) => (uom ? `${formatNumber(n)} ${uom}` : formatNumber(n));

    const variables: Record<string, string> = {};
    if (context.reference) variables.reference = context.reference;
    if (material) variables.material = material.name;
    if (material) variables.category = material.category === "SPARE" ? "Spare" : "Material";
    if (location) variables.location = location.name;
    if (context.quantity != null) variables.quantity = withUom(context.quantity);
    if (context.currentStock != null) variables.currentStock = withUom(context.currentStock);
    if (context.minimumStock != null) variables.minimumStock = withUom(context.minimumStock);
    if (context.requestType) variables.type = context.requestType === "SPARE" ? "Spare" : "Material";

    const relatedRecordType = NOTIFICATION_EVENT_META[event].relatedRecordType;

    for (const rule of rules) {
      const recipients = await resolveRecipients(event, rule, context);
      for (const recipient of recipients) {
        const title = renderTemplate(rule.title, variables);
        const message = renderTemplate(rule.message, variables);

        let emailStatus: "SENT" | "FAILED" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
        let emailError: string | null = null;
        if (rule.channel === "EMAIL" || rule.channel === "BOTH") {
          if (recipient.email) {
            const result = await sendEmail({ to: recipient.email, subject: title, body: message });
            emailStatus = result.status;
            emailError = result.error ?? null;
          } else {
            emailStatus = "FAILED";
            emailError = "Recipient has no email address on file";
          }
        }

        await prisma.notification.create({
          data: {
            ruleId: rule.id,
            recipientUserId: recipient.id,
            type: rule.notificationType,
            title,
            message,
            relatedRecordType,
            relatedRecordId: context.recordId,
            link: context.link,
            channel: rule.channel,
            emailStatus,
            emailError,
          },
        });
      }
    }
  } catch (e) {
    console.error(`[notifications] triggerNotification(${event}) failed — ignored, this must never break the calling action`, e);
  }
}
