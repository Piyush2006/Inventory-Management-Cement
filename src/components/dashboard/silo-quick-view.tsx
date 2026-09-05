import Link from "next/link";
import { Panel } from "@/components/ui";
import { formatNumber } from "@/lib/format";

export interface SiloCardData {
  locationId: string;
  locationName: string;
  materialId: string | null;
  materialName: string | null;
  uom: string;
  total: number;
  capacity: number;
  fillPct: number;
}

// A drawn silo silhouette (cylinder body + tapered hopper + support legs), not a decorative
// stock photo or a plain progress bar — the green fill is clipped to the same body shape and its
// height is the only thing that varies. Fill color is fixed green regardless of level: a silo's
// physical book level and a material's HEALTHY/CRITICAL inventory status are two different,
// independent things (an 18%-full silo is not "critical" just because it's a small number) —
// this component never calls classifyStockStatus or renders a status badge.
function SiloVessel({ fillPct, clipId }: { fillPct: number; clipId: string }) {
  const clamped = Math.max(0, Math.min(100, fillPct));
  // Body interior spans y=6..64 (height 58) inside the viewBox below.
  const fillHeight = (58 * clamped) / 100;
  const fillY = 64 - fillHeight;
  return (
    <svg viewBox="0 0 64 96" width="40" height="60" className="shrink-0">
      <defs>
        <clipPath id={clipId}>
          <path d="M10 12a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v52H10Z" />
        </clipPath>
      </defs>
      {/* Body outline */}
      <path d="M10 12a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v52H10Z" fill="var(--surface-raised)" stroke="var(--border)" strokeWidth="1.5" />
      {/* Book-level fill, clipped to the body */}
      <rect x="10" y={fillY} width="24" height={fillHeight} fill="var(--status-healthy)" clipPath={`url(#${clipId})`} />
      {/* Hopper (tapered bottom) */}
      <path d="M10 64h24l-8 14h-8Z" fill="var(--surface-raised)" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Legs */}
      <path d="M15 78v10M29 78v10" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SiloCard({ silo }: { silo: SiloCardData }) {
  const remaining = Math.max(0, silo.capacity - silo.total);
  const body = (
    <div className="flex h-full flex-col rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent/40 hover:shadow-[var(--shadow-md)]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">{silo.locationName}</div>
          <div className="text-xs text-muted-soft">{silo.materialName ?? "No material assigned"}</div>
        </div>
        {silo.materialId && <span className="text-muted-soft"><ChevronRightIcon /></span>}
      </div>
      <div className="mt-2 flex items-end gap-3">
        <SiloVessel fillPct={silo.fillPct} clipId={`silo-clip-${silo.locationId}`} />
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold tabular text-foreground">{silo.fillPct.toFixed(0)}%</div>
          {/* Fixed green regardless of level — see the SiloVessel comment above: fill % is a
              physical/book reading, never a Critical/Healthy classification. */}
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
            <div className="h-full rounded-full bg-[var(--status-healthy)]" style={{ width: `${Math.max(0, Math.min(100, silo.fillPct))}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted-soft">
            {formatNumber(silo.total)} / {formatNumber(silo.capacity)} {silo.uom}
          </div>
          <div className="text-xs text-muted-soft">{formatNumber(remaining)} {silo.uom} remaining</div>
        </div>
      </div>
    </div>
  );
  return silo.materialId ? (
    <Link href={`/inventory/${silo.materialId}`} className="block h-full">{body}</Link>
  ) : (
    body
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

// Strictly the three cement silo vessels (Location.type === "SILO") — no other storage location
// (yards, bunkers, stores, warehouses, production areas) belongs here, and fill percentage is
// never turned into a Critical/Healthy classification (that stays the material-level logic).
export function SiloQuickView({ silos }: { silos: SiloCardData[] }) {
  return (
    <Panel
      title="Silo Quick View"
      action={
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-soft">Book levels — derived from the ledger</span>
          <Link href="/inventory" className="text-xs text-accent hover:underline">View all silos →</Link>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {silos.map((s) => (
          <SiloCard key={s.locationId} silo={s} />
        ))}
      </div>
    </Panel>
  );
}
