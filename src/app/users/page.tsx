import Link from "next/link";
import { prisma } from "@/lib/db";
import { Panel } from "@/components/ui";
import { getCurrentUser, restrictToAdminOnly } from "@/lib/auth";
import { UsersManager } from "./users-manager";
import { RolesPanel } from "./roles-panel";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles" },
];

// Admin-only end to end — restrictToAdminOnly redirects anyone else away, same shape as the
// existing restrictToRequestsOnly/restrictStockOperationsFromSupervisor page guards.
export default async function UsersRolesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const currentUser = await getCurrentUser();
  restrictToAdminOnly(currentUser);
  const params = await searchParams;
  const tab = TABS.some((t) => t.key === params.tab) ? params.tab! : "users";

  const users = tab === "users" ? await prisma.user.findMany({ orderBy: { role: "asc" } }) : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Users &amp; Roles</h1>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border-soft pb-3">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/users?tab=${t.key}`}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              tab === t.key ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "users" ? (
        <Panel>
          <UsersManager
            users={users.map((u) => ({ id: u.id, name: u.name, role: u.role, email: u.email, active: u.active }))}
            currentUserId={currentUser.id}
          />
        </Panel>
      ) : (
        <Panel>
          <RolesPanel />
        </Panel>
      )}
    </div>
  );
}
