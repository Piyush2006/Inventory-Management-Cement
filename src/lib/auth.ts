import { cookies } from "next/headers";
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

export function requireRole(user: { role: string; name: string }, allowed: UserRole[]) {
  if (!allowed.includes(user.role as UserRole)) {
    throw new PermissionError(`${user.name} (${user.role}) is not permitted to perform this action — requires ${allowed.join(" or ")}.`);
  }
}
