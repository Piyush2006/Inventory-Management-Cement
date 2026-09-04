import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Panel } from "@/components/ui";
import { InventoryReportSection } from "./inventory-report";
import { ConsumptionReportSection } from "./consumption-report";
import { StockMovementReportSection } from "./stock-movement-report";
import { RequestReportSection } from "./request-report";
import { DispatchReportSection } from "./dispatch-report";
import { SchedulesPanel, type ScheduleRow } from "./schedules-panel";
import { NOTIFICATION_CONFIG_ROLES, type UserRole } from "@/lib/domain/enums";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "inventory", label: "Inventory" },
  { key: "consumption", label: "Consumption" },
  { key: "movement", label: "Stock Movement" },
  { key: "request", label: "Request" },
  { key: "dispatch", label: "Dispatch" },
];

type SearchParams = Record<string, string | undefined>;

// No restrictToRequestsOnly gate — Indentor (Requester) has full read access, with the
// Request tab scoped to their own raised requests (see request-report.tsx). The Schedules tab
// is additionally gated behind NOTIFICATION_CONFIG_ROLES, same as Notification Rules — it's
// configuration, not reporting.
export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const currentUser = await getCurrentUser();
  const params = await searchParams;
  const canConfigureSchedules = NOTIFICATION_CONFIG_ROLES.includes(currentUser.role as UserRole);
  const tab = params.tab === "schedules" && canConfigureSchedules ? "schedules" : TABS.some((t) => t.key === params.tab) ? params.tab! : "inventory";

  let scheduleRows: ScheduleRow[] = [];
  let scheduleUsers: { id: string; name: string }[] = [];
  if (tab === "schedules") {
    const [schedules, users] = await Promise.all([
      prisma.reportSchedule.findMany({ include: { runs: { orderBy: { runAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } }),
      prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    ]);
    const userNameById = new Map(users.map((u) => [u.id, u.name]));
    scheduleUsers = users.map((u) => ({ id: u.id, name: u.name }));
    scheduleRows = schedules.map((s) => ({
      id: s.id,
      reportType: s.reportType,
      frequency: s.frequency,
      timeOfDay: s.timeOfDay,
      dayOfWeek: s.dayOfWeek,
      dayOfMonth: s.dayOfMonth,
      recipientType: s.recipientType,
      recipientRole: s.recipientRole,
      recipientUserId: s.recipientUserId,
      recipientUserName: s.recipientUserId ? (userNameById.get(s.recipientUserId) ?? null) : null,
      status: s.status,
      lastRunAt: s.runs[0]?.runAt ?? null,
      lastRunEmailStatus: s.runs[0]?.emailStatus ?? null,
    }));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Reports</h1>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border-soft pb-3">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/reports?tab=${t.key}`}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              tab === t.key ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
        {canConfigureSchedules && (
          <Link
            href="/reports?tab=schedules"
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              tab === "schedules" ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"
            }`}
          >
            Schedules
          </Link>
        )}
      </div>

      {tab === "inventory" && <InventoryReportSection params={params} />}
      {tab === "consumption" && <ConsumptionReportSection params={params} />}
      {tab === "movement" && <StockMovementReportSection params={params} />}
      {tab === "request" && <RequestReportSection params={params} currentUser={{ id: currentUser.id, role: currentUser.role }} />}
      {tab === "dispatch" && <DispatchReportSection params={params} currentUser={{ id: currentUser.id, role: currentUser.role }} />}
      {tab === "schedules" && (
        <Panel title="Report Schedules">
          <SchedulesPanel schedules={scheduleRows} users={scheduleUsers} />
        </Panel>
      )}
    </div>
  );
}
