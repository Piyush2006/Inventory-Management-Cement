import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { UserRole } from "@/lib/domain/enums";

const CURRENT_USER_COOKIE = "currentUserId";

export class PermissionError extends Error {}

/**
 * Resolves "who is acting" from a cookie rather than a real login — this is a demo
 * with no auth system. The important part is that every privileged action re-derives
 * the user from THIS server-side cookie store and checks their role independently;
 * a client can't grant itself a role just by hiding/showing buttons differently.
 */
export async function getCurrentUser() {
  const store = await cookies();
  const id = store.get(CURRENT_USER_COOKIE)?.value;
  if (id) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (user?.active) return user;
  }
  // Fall back to the first active user (keeps the demo usable before a selection is made).
  const fallback = await prisma.user.findFirst({ where: { active: true }, orderBy: { role: "asc" } });
  if (!fallback) throw new PermissionError("No active users are configured");
  return fallback;
}

export async function setCurrentUser(userId: string) {
  const store = await cookies();
  store.set(CURRENT_USER_COOKIE, userId, { path: "/", sameSite: "lax" });
}

/** Clears the demo session — getCurrentUser()'s existing fallback (first active user) takes over. */
export async function clearCurrentUser() {
  const store = await cookies();
  store.delete(CURRENT_USER_COOKIE);
}

export function requireRole(user: { role: string; name: string }, allowed: UserRole[]) {
  if (!allowed.includes(user.role as UserRole)) {
    throw new PermissionError(`${user.name} (${user.role}) is not permitted to perform this action — requires ${allowed.join(" or ")}.`);
  }
}

/**
 * Indentor (Requester, role key unchanged in code/DB — only the display label changed) has
 * full read access to every informational screen (Dashboard, Inventory, Locations, Materials,
 * Reports, Ledger) — this gate is now only called from the pages that stay write-only for this
 * role: Stock Operations, GRN receiving, and the Dispatch detail page. None of those are
 * something a production requisitioner performs; their own Request lifecycle (raise, view own,
 * confirm/not-received) plus read access everywhere else covers what they need. Call at the top
 * of any such page so this role can't reach it even by typing the URL, not just by not seeing
 * it in the sidebar.
 */
export function restrictToRequestsOnly(user: { role: string }) {
  if (user.role === "REQUESTER") redirect("/requests");
}

/**
 * Store Supervisor's job is managing the request queue, not touching stock directly — per
 * the RBAC matrix its Stock Operations cell is a bare "no access" (unlike its view-only
 * access to Dashboard/Inventory/etc), so it's blocked outright here, not just hidden buttons.
 */
export function restrictStockOperationsFromSupervisor(user: { role: string }) {
  if (user.role === "STORE_SUPERVISOR") redirect("/");
}

/**
 * Users & Roles has no legitimate content for anyone but Admin (unlike e.g. Notifications, where
 * every role has its own inbox) — a full redirect guard, same shape as the two guards above.
 */
export function restrictToAdminOnly(user: { role: string }) {
  if (user.role !== "ADMIN") redirect("/");
}
