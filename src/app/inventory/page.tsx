import Link from "next/link";
import { prisma } from "@/lib/db";
import { classifyStockStatus } from "@/lib/inventory/status";
import { Panel, Th, Td, EmptyState, ViewIcon, OverstockBadge } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { ExportCsvButton } from "@/components/export-csv-button";
import { formatNumber } from "@/lib/format";
import { MATERIAL_CATEGORIES, STOCK_STATUSES, IN_TRANSIT_LOCATION_TYPE, STOCK_OPS_ROLES, type UserRole } from "@/lib/domain/enums";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// No restrictToRequestsOnly gate — Indentor (Requester) has full read access; the "+ Receive
// Material" action button below is separately gated to STOCK_OPS_ROLES so a role that can't
// reach /receipts/new (still write-gated) isn't shown a dead-end link.
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; locationId?: string; status?: string }>;
}) {
  const currentUser = await getCurrentUser();
  const canReceiveMaterial = STOCK_OPS_ROLES.includes(currentUser.role as UserRole);
  const params = await searchParams;
  const [materials, locations] = await Promise.all([
    prisma.material.findMany({
      where: {
        active: true,
        ...(params.category ? { category: params.category } : {}),
        ...(params.q ? { name: { contains: params.q } } : {}),
      },
      // Excludes the virtual in-transit location — material mid-delivery isn't on hand
      // anywhere, so it must not inflate this figure or diverge from getTotalOnHand()
      // (balance.ts), which the Material Detail page uses for the same material.
      include: { balances: { where: { location: { type: { not: IN_TRANSIT_LOCATION_TYPE } } }, include: { location: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({ where: { active: true, type: { not: IN_TRANSIT_LOCATION_TYPE } }, orderBy: { name: "asc" } }),
  ]);
  // One batched query for every material's QC Hold/Blocked quantities, keyed by location —
  // avoids an N+1 getUnrestrictedAvailable() call per row. Status classification below uses
  // this so QC Hold/Blocked stock can't make a material look falsely HEALTHY/LOW.
  const qualityBalances = await prisma.qualityBalance.findMany({ where: { materialId: { in: materials.map((m) => m.id) } } });
  const nonUnrestrictedByMaterialLocation = new Map<string, number>();
  for (const q of qualityBalances) {
    const key = `${q.materialId}:${q.locationId}`;
    nonUnrestrictedByMaterialLocation.set(key, (nonUnrestrictedByMaterialLocation.get(key) ?? 0) + q.quantity);
  }

  let rows = materials.map((m) => {
    const relevantBalances = params.locationId ? m.balances.filter((b) => b.locationId === params.locationId) : m.balances;
    const currentStock = relevantBalances.reduce((s, b) => s + b.quantity, 0);
    const nonUnrestricted = relevantBalances.reduce((s, b) => s + (nonUnrestrictedByMaterialLocation.get(`${m.id}:${b.locationId}`) ?? 0), 0);
    const unrestrictedStock = Math.max(0, currentStock - nonUnrestricted);
    const { status, overstock } = classifyStockStatus({ currentStock: unrestrictedStock, minStock: m.minStock, maxStock: m.maxStock });
    // Partitioned by location — every location actually holding this material, with its own
    // quantity, not just a flat total. Makes an increase at one specific location (e.g. after
    // a request is received) directly visible here instead of only on the Material Detail page.
    const locationBreakdown = m.balances
      .filter((b) => Math.abs(b.quantity) > 1e-6)
      .map((b) => ({ name: b.location.name, quantity: b.quantity }))
      .sort((a, b) => b.quantity - a.quantity);
    return { material: m, currentStock, status, overstock, locationBreakdown };
  });
  if (params.locationId) rows = rows.filter((r) => r.currentStock > 1e-6);
  if (params.status) rows = rows.filter((r) => r.status === params.status);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Inventory</h1>
        </div>
        {canReceiveMaterial && (
          <Link href="/receipts/new" className="btn btn-primary btn-md shrink-0">
            + Receive Material
          </Link>
        )}
      </div>

      <Panel>
        <form className="grid grid-cols-2 gap-3 sm:grid-cols-4" method="GET">
          <label className="text-xs text-muted">
            Search
            <input name="q" defaultValue={params.q ?? ""} placeholder="Material name…" className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-muted">
            Category
            <select name="category" defaultValue={params.category ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              <option value="">All categories</option>
              {MATERIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace("_", " ")}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Location
            <select name="locationId" defaultValue={params.locationId ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Status
            <select name="status" defaultValue={params.status ?? ""} className="mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent">
              <option value="">All statuses</option>
              {STOCK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </form>
      </Panel>

      <Panel
        title={`Materials (${rows.length})`}
        action={
          <ExportCsvButton
            filename="inventory.csv"
            headers={["Material", "Code", "Category", "Stock", "UOM", "Min Stock", "Max Stock", "Status", "Overstock", "Locations"]}
            rows={rows.map((r) => [
              r.material.name,
              r.material.materialCode,
              r.material.category,
              formatNumber(r.currentStock),
              r.material.uom,
              r.material.minStock != null ? formatNumber(r.material.minStock) : "",
              r.material.maxStock != null ? formatNumber(r.material.maxStock) : "",
              r.status,
              r.overstock ? "Yes" : "No",
              r.locationBreakdown.map((b) => `${b.name}: ${formatNumber(b.quantity)}`).join("; "),
            ])}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No materials match these filters" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-soft">
                  <Th>Material</Th>
                  <Th>Category</Th>
                  <Th>Location(s)</Th>
                  <Th className="text-right">Stock</Th>
                  <Th className="text-right">Min Stock</Th>
                  <Th className="text-right">Max Stock</Th>
                  <Th>Status</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.material.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                    <Td>
                      <div className="font-medium">{r.material.name}</div>
                      <div className="text-xs text-muted-soft">{r.material.materialCode}</div>
                    </Td>
                    <Td className="text-xs text-muted">{r.material.category.replace("_", " ")}</Td>
                    <Td className="text-xs text-muted">
                      {r.locationBreakdown.length === 0 ? (
                        "—"
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {r.locationBreakdown.map((b) => (
                            <div key={b.name} className="whitespace-nowrap">
                              <span className="text-foreground">{b.name}</span>
                              <span className="text-muted-soft"> — {formatNumber(b.quantity)} {r.material.uom}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td className="text-right tabular">
                      <span className={r.overstock ? "text-[var(--status-excess)]" : undefined}>{formatNumber(r.currentStock)} {r.material.uom}</span>
                      {r.overstock && (
                        <div className="mt-1 flex justify-end">
                          <OverstockBadge />
                        </div>
                      )}
                    </Td>
                    <Td className="text-right tabular text-muted">{r.material.minStock != null ? formatNumber(r.material.minStock) : "—"}</Td>
                    <Td className="text-right tabular text-muted">{r.material.maxStock != null ? formatNumber(r.material.maxStock) : "—"}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <Link
                        href={`/inventory/${r.material.id}`}
                        title="View details"
                        aria-label={`View details for ${r.material.name}`}
                        className="inline-flex rounded p-1.5 text-muted hover:bg-surface-raised hover:text-accent"
                      >
                        <ViewIcon />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
