import Link from "next/link";
import { prisma } from "@/lib/db";
import { Panel, EmptyState } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { NOTIFICATION_CONFIG_ROLES, type UserRole } from "@/lib/domain/enums";
import { MarkAllReadButton } from "./mark-all-read-button";
import { RulesPanel, type RuleRow } from "./rules-panel";

export const dynamic = "force-dynamic";

const TYPE_TONE: Record<string, string> = {
  ACTION_REQUIRED: "text-[var(--status-warning)] bg-[var(--status-warning-bg)]",
  INFORMATION: "text-[var(--status-transit)] bg-[var(--status-transit-bg)]",
};
const TYPE_LABEL: Record<string, string> = { ACTION_REQUIRED: "Action Required", INFORMATION: "Information" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string }> }) {
  // Deliberately NOT restrictToRequestsOnly-gated — every role, including Requester, needs
  // their own notification feed (spec: "Requester: notifications relating to their own
  // requests"). The Rules tab below is separately gated to NOTIFICATION_CONFIG_ROLES.
  const currentUser = await getCurrentUser();
  const params = await searchParams;
  const canConfigure = NOTIFICATION_CONFIG_ROLES.includes(currentUser.role as UserRole);
  const tab = params.tab === "rules" && canConfigure ? "rules" : "inbox";
  const filter = params.filter === "unread" ? "unread" : "all";

  const notifications = await prisma.notification.findMany({
    where: { recipientUserId: currentUser.id, ...(filter === "unread" ? { read: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unreadCount = await prisma.notification.count({ where: { recipientUserId: currentUser.id, read: false } });

  let ruleRows: RuleRow[] = [];
  let users: { id: string; name: string }[] = [];
  if (tab === "rules") {
    const [rules, allUsers] = await Promise.all([
      prisma.notificationRule.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    ]);
    users = allUsers.map((u) => ({ id: u.id, name: u.name }));
    const userNameById = new Map(allUsers.map((u) => [u.id, u.name]));
    ruleRows = rules.map((r) => ({
      id: r.id,
      event: r.event,
      recipientType: r.recipientType,
      recipientRole: r.recipientRole,
      recipientUserId: r.recipientUserId,
      recipientUserName: r.recipientUserId ? (userNameById.get(r.recipientUserId) ?? null) : null,
      channel: r.channel,
      status: r.status,
      notificationType: r.notificationType,
      title: r.title,
      message: r.message,
    }));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Notification &amp; Alert Management</h1>
        <p className="mt-1 text-sm text-muted">What happened, who needs to know, and who needs to act.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border-soft pb-3">
        <Link href="/notifications?tab=inbox" className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${tab === "inbox" ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"}`}>
          Notifications
        </Link>
        {canConfigure && (
          <Link href="/notifications?tab=rules" className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${tab === "rules" ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"}`}>
            Rules
          </Link>
        )}
      </div>

      {tab === "inbox" ? (
        <Panel
          title={filter === "unread" ? `Unread (${notifications.length})` : `All Notifications (${notifications.length})`}
          action={
            <div className="flex items-center gap-2">
              <div className="flex gap-1 rounded-md border border-border p-0.5 text-xs">
                <Link href="/notifications?tab=inbox&filter=all" className={`rounded px-2 py-1 ${filter === "all" ? "bg-accent-soft text-accent" : "text-muted"}`}>All</Link>
                <Link href="/notifications?tab=inbox&filter=unread" className={`rounded px-2 py-1 ${filter === "unread" ? "bg-accent-soft text-accent" : "text-muted"}`}>Unread</Link>
              </div>
              <MarkAllReadButton disabled={unreadCount === 0} />
            </div>
          }
        >
          {notifications.length === 0 ? (
            <EmptyState title={filter === "unread" ? "No unread notifications" : "No notifications yet"} />
          ) : (
            <ul className="divide-y divide-border-soft">
              {notifications.map((n) => {
                const row = (
                  <div className="flex items-start gap-3 py-3">
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    <div className={`min-w-0 flex-1 ${n.read ? "pl-5" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{n.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_TONE[n.type] ?? ""}`}>{TYPE_LABEL[n.type] ?? n.type}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{n.message}</p>
                      <div className="mt-1 text-xs text-muted-soft">{formatDateTime(n.createdAt)}</div>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? <Link href={n.link} className="block hover:bg-surface-raised">{row}</Link> : row}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      ) : (
        <Panel title="Notification Rules">
          <RulesPanel rules={ruleRows} users={users} />
        </Panel>
      )}
    </div>
  );
}
