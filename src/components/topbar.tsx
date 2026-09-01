import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { UserSwitcher } from "@/components/user-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export async function Topbar() {
  const [users, currentUser] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, orderBy: { role: "asc" } }),
    getCurrentUser(),
  ]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-5">
      <div className="text-xs text-muted-soft">{formatDate(new Date())} &middot; Simulated data &middot; Berrima Cement Plant</div>
      <div className="flex items-center gap-2">
        <UserSwitcher users={users.map((u) => ({ id: u.id, name: u.name, role: u.role }))} currentUserId={currentUser.id} />
        <ThemeToggle />
      </div>
    </header>
  );
}
