import { prisma } from "@/lib/db";
import type { NotificationEvent } from "./events";
import type { NotificationContext } from "./types";

type Rule = { recipientType: string; recipientRole: string | null; recipientUserId: string | null };

// Per-event "who's relevant" lookup, reading straight off the FK ids already on the record —
// the same identity that already gates who can view/act on that record elsewhere in the app
// (requests/page.tsx, movements/page.tsx). Events with no entry here only make sense as a
// ROLE/SPECIFIC_USER rule:
//   - REQUEST_CREATED: no single relevant person yet — goes to a role (e.g. Store Supervisor).
//   - DISPATCH_CREATED: assignedToUserId doesn't exist until Approval — role-based only.
//   - STOCK_LOW / STOCK_CRITICAL / QUALITY_RELEASED: plant-wide alerts — role-based only.
const RELEVANT_USER_RESOLVERS: Partial<Record<NotificationEvent, (context: NotificationContext) => string | undefined>> = {
  REQUEST_ASSIGNED: (c) => c.assignedToUserId,
  REQUEST_ACCEPTED: (c) => c.requestedByUserId,
  REQUEST_REJECTED: (c) => c.requestedByUserId,
  DELIVERY_STARTED: (c) => c.requestedByUserId,
  REQUEST_DELIVERED: (c) => c.requestedByUserId,
  // The operator who delivered it, not the requester — the requester just performed this
  // confirm-receipt action themselves, so notifying them of their own action would be noise.
  REQUEST_RECEIVED: (c) => c.assignedToUserId,
  REQUEST_NOT_RECEIVED: (c) => c.routedToUserId,
  REQUEST_PARTIALLY_RECEIVED: (c) => c.routedToUserId,
  DISPATCH_APPROVED: (c) => c.assignedToUserId,
  DISPATCH_DISPATCHED: (c) => c.assignedToUserId,
  DISPATCH_CANCELLED: (c) => c.assignedToUserId,
};

export async function resolveRecipients(event: NotificationEvent, rule: Rule, context: NotificationContext) {
  if (rule.recipientType === "SPECIFIC_USER") {
    if (!rule.recipientUserId) return [];
    const user = await prisma.user.findUnique({ where: { id: rule.recipientUserId } });
    return user?.active ? [user] : [];
  }
  if (rule.recipientType === "ROLE") {
    if (!rule.recipientRole) return [];
    return prisma.user.findMany({ where: { role: rule.recipientRole, active: true } });
  }
  // RELEVANT_USER
  const userId = RELEVANT_USER_RESOLVERS[event]?.(context);
  if (!userId) return [];
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.active ? [user] : [];
}
