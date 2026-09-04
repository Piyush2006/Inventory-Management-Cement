import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { UserProfileMenu } from "@/components/user-profile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notification-bell";

const BELL_RECENT_LIMIT = 8;

export async function Topbar() {
  const currentUser = await getCurrentUser();

  // currentUser is already in hand here — no separate getCurrentUser() call inside the bell.
  const [recent, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { recipientUserId: currentUser.id }, orderBy: { createdAt: "desc" }, take: BELL_RECENT_LIMIT }),
    prisma.notification.count({ where: { recipientUserId: currentUser.id, read: false } }),
  ]);

  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-5 shadow-panel">
      <div className="text-xs text-muted-soft">{formatDate(new Date())} &middot; Boral Cement Plant</div>
      <div className="flex items-center gap-2">
        <NotificationBell
          notifications={recent.map((n) => ({ id: n.id, title: n.title, message: n.message, read: n.read, type: n.type, link: n.link, createdAt: formatDateTime(n.createdAt) }))}
          unreadCount={unreadCount}
        />
        <UserProfileMenu user={{ name: currentUser.name, role: currentUser.role }} />
        <ThemeToggle />
      </div>
    </header>
  );
}
