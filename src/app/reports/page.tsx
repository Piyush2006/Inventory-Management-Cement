import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { InventoryReportSection } from "./inventory-report";
import { ConsumptionReportSection } from "./consumption-report";
import { StockMovementReportSection } from "./stock-movement-report";
import { RequestReportSection } from "./request-report";
import { DispatchReportSection } from "./dispatch-report";

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
// Request tab scoped to their own raised requests (see request-report.tsx).
export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const currentUser = await getCurrentUser();
  const params = await searchParams;
  const tab = TABS.some((t) => t.key === params.tab) ? params.tab! : "inventory";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted">View and analyze your inventory data.</p>
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
      </div>

      {tab === "inventory" && <InventoryReportSection params={params} />}
      {tab === "consumption" && <ConsumptionReportSection params={params} />}
      {tab === "movement" && <StockMovementReportSection params={params} />}
      {tab === "request" && <RequestReportSection params={params} currentUser={{ id: currentUser.id, role: currentUser.role }} />}
      {tab === "dispatch" && <DispatchReportSection params={params} currentUser={{ id: currentUser.id, role: currentUser.role }} />}
    </div>
  );
}
