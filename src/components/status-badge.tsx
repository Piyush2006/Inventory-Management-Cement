import type { RequestStatus, StockStatus } from "@/lib/domain/enums";

const STOCK_STYLES: Record<StockStatus, { label: string; fg: string; bg: string; dot: string }> = {
  HEALTHY: { label: "Healthy", fg: "text-[var(--status-healthy)]", bg: "bg-[var(--status-healthy-bg)]", dot: "bg-[var(--status-healthy)]" },
  LOW: { label: "Low", fg: "text-[var(--status-warning)]", bg: "bg-[var(--status-warning-bg)]", dot: "bg-[var(--status-warning)]" },
  CRITICAL: { label: "Critical", fg: "text-[var(--status-critical)]", bg: "bg-[var(--status-critical-bg)]", dot: "bg-[var(--status-critical)]" },
};

export function StatusBadge({ status, label }: { status: StockStatus; label?: string }) {
  const s = STOCK_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.fg} ${s.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {label ?? s.label}
    </span>
  );
}

const REQUEST_STYLES: Record<RequestStatus, { fg: string; bg: string }> = {
  NEW_REQUEST: { fg: "text-[var(--status-transit)]", bg: "bg-[var(--status-transit-bg)]" },
  ACCEPTED: { fg: "text-[var(--status-transit)]", bg: "bg-[var(--status-transit-bg)]" },
  REJECTED: { fg: "text-[var(--status-critical)]", bg: "bg-[var(--status-critical-bg)]" },
  ASSIGNED: { fg: "text-[var(--status-warning)]", bg: "bg-[var(--status-warning-bg)]" },
  IN_TRANSIT: { fg: "text-[var(--status-excess)]", bg: "bg-[var(--status-excess-bg)]" },
  DELIVERED: { fg: "text-[var(--status-warning)]", bg: "bg-[var(--status-warning-bg)]" },
  NOT_RECEIVED: { fg: "text-[var(--status-critical)]", bg: "bg-[var(--status-critical-bg)]" },
  PARTIALLY_RECEIVED: { fg: "text-[var(--status-warning)]", bg: "bg-[var(--status-warning-bg)]" },
  COMPLETED: { fg: "text-[var(--status-healthy)]", bg: "bg-[var(--status-healthy-bg)]" },
};
const REQUEST_LABEL: Record<RequestStatus, string> = {
  NEW_REQUEST: "New Request",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  ASSIGNED: "Assigned",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  NOT_RECEIVED: "Not Received",
  PARTIALLY_RECEIVED: "Partially Received",
  COMPLETED: "Completed",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const s = REQUEST_STYLES[status];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${s.fg} ${s.bg}`}>{REQUEST_LABEL[status]}</span>;
}
