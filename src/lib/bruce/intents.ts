import { getInventoryInsights, getMaterialRiskExplanation } from "@/lib/inventory/insights";
import { getTotalOnHand } from "@/lib/inventory/balance";
import { getTotalUnrestrictedAvailable } from "@/lib/inventory/quality";
import { getConsumptionReport } from "@/lib/reports/consumption";
import { getRequestReport, getDispatchReport } from "@/lib/reports/requestDispatch";
import { getStockMovementReport } from "@/lib/reports/stockMovement";
import { getInventoryReport } from "@/lib/reports/inventory";
import { OPEN_REQUEST_STATUSES } from "@/lib/domain/enums";
import { formatQty, formatNumber } from "@/lib/format";
import { extractPeriod } from "./entities";
import { getMaterialsByStatus, getStockAtLocation, getQualityHeld, getLowestDaysOfCover } from "./queries";
import type { BruceIntent } from "./types";

// A Dispatch has no "open" status list exported anywhere in the app (unlike Requests'
// OPEN_REQUEST_STATUSES) — defined locally rather than inventing a shared constant nothing
// else needs.
const OPEN_DISPATCH_STATUSES = ["CREATED", "APPROVED", "LOADING"];

function scopeToUserId(currentUser: { id: string; role: string }) {
  return currentUser.role === "STORE_OPERATOR" ? currentUser.id : undefined;
}

// Request-specific scoping additionally covers Indentor (Requester) — scoped to the requests
// they themselves raised, matching Reports' request-report.tsx (see requestDispatch.ts's
// scopeField param). Dispatch has no Requester-relevant scope at all — this role never creates
// or is assigned a dispatch, so Dispatch intents keep using the plain scopeToUserId above.
function requestScope(currentUser: { id: string; role: string }): [string | undefined, "assignedToUserId" | "requestedByUserId"] {
  if (currentUser.role === "STORE_OPERATOR") return [currentUser.id, "assignedToUserId"];
  if (currentUser.role === "REQUESTER") return [currentUser.id, "requestedByUserId"];
  return [undefined, "assignedToUserId"];
}

function elapsed(from: Date): string {
  const ms = Date.now() - from.getTime();
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.floor(ms / 3600000));
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// Intents requiring a successfully-extracted material/location are listed first (answer.ts
// only tries them when that entity was actually found) so "usable stock for OPC 43" resolves to
// the material-specific handler instead of a generic list-style intent matching on "stock".
export const BRUCE_INTENTS: BruceIntent[] = [
  {
    key: "why_material_critical",
    requiresEntity: true,
    match: (q) => /\bwhy\b/.test(q) && (q.includes("critical") || q.includes("risk") || q.includes("high risk")),
    handle: async (ctx) => {
      const m = ctx.material!;
      const risk = await getMaterialRiskExplanation(m.id);
      if (!risk) return { text: `Nothing concerning about ${m.name} right now — no risk signal is currently flagged for it.`, links: [{ label: "View Inventory", href: `/inventory/${m.id}` }] };
      return { text: `${m.name} — ${risk.typeLabel}\n\n${risk.explanation}`, links: [{ label: "View Inventory", href: `/inventory/${m.id}` }] };
    },
  },
  {
    key: "usable_stock_for_material",
    requiresEntity: true,
    match: (q) => q.includes("usable stock") || q.includes("current stock") || q.includes("how much stock"),
    handle: async (ctx) => {
      const m = ctx.material!;
      const [onHand, unrestricted] = await Promise.all([getTotalOnHand(m.id), getTotalUnrestrictedAvailable(m.id)]);
      const held = Math.max(0, onHand - unrestricted);
      const text = held > 1e-6
        ? `${m.name}: ${formatQty(onHand, m.uom)} on hand, ${formatQty(held, m.uom)} on QC Hold/Blocked, leaving ${formatQty(unrestricted, m.uom)} usable.`
        : `${m.name}: ${formatQty(unrestricted, m.uom)} usable stock on hand.`;
      return { text, links: [{ label: "View Inventory", href: `/inventory/${m.id}` }] };
    },
  },
  {
    key: "consumption_trend_for_material",
    requiresEntity: true,
    match: (q) => (q.includes("consumption") || q.includes("trend")) && (q.includes("change") || q.includes("trend") || q.includes("how has")),
    handle: async (ctx) => {
      const m = ctx.material!;
      const period = { from: new Date(Date.now() - 14 * 86400000), to: new Date() };
      const report = await getConsumptionReport({ ...period, materialId: m.id });
      const row = report.aggregateRows.find((r) => r.materialId === m.id);
      if (!row) return { text: `There is insufficient consumption history for ${m.name} over the last 14 days to describe a trend.`, links: [{ label: "View Inventory", href: `/inventory/${m.id}` }] };
      return {
        text: `${m.name} consumed ${formatQty(row.totalConsumed, m.uom)} over the last 14 days — averaging ${formatQty(row.averageDailyConsumption, m.uom)}/day.`,
        links: [{ label: "View Consumption Report", href: "/reports?tab=consumption" }],
      };
    },
  },
  {
    key: "stock_at_location",
    requiresEntity: true,
    match: (q) => q.includes("stock at") || q.includes("at main store") || /\bat\b.*\bstore\b/.test(q),
    handle: async (ctx) => {
      const l = ctx.location!;
      const rows = await getStockAtLocation(l.id);
      if (rows.length === 0) return { text: `There's no stock currently on hand at ${l.name}.`, links: [{ label: "View Locations", href: "/locations" }] };
      const lines = rows.slice(0, 6).map((r) => `${r.materialName}: ${formatQty(r.quantity, r.uom)}`).join("; ");
      return { text: `Stock at ${l.name} — ${lines}${rows.length > 6 ? `, and ${rows.length - 6} more` : ""}.`, links: [{ label: "View Inventory", href: "/inventory" }] };
    },
  },

  // -- Generic (no entity required) intents below --
  {
    key: "materials_needing_attention",
    requiresEntity: false,
    match: (q) => q.includes("need") && q.includes("attention"),
    handle: async () => {
      const { insights, hasConsumptionData } = await getInventoryInsights();
      if (insights.length === 0) {
        return { text: hasConsumptionData ? "No significant inventory risks detected right now." : "There's insufficient consumption history to estimate inventory risk yet." };
      }
      const lines = insights.slice(0, 5).map((i) => `${i.materialName} (${i.typeLabel}): ${i.explanation}`).join("\n\n");
      return { text: `${insights.length} thing${insights.length === 1 ? "" : "s"} need attention:\n\n${lines}`, links: [{ label: "View Inventory", href: "/inventory" }] };
    },
  },
  {
    key: "below_minimum_stock",
    requiresEntity: false,
    match: (q) => q.includes("below minimum") || q.includes("low stock") || (q.includes("approaching minimum")),
    handle: async () => {
      const rows = await getMaterialsByStatus("LOW");
      if (rows.length === 0) return { text: "No materials are currently below their minimum stock level." };
      const lines = rows.map((r) => `${r.material.name}: ${formatQty(r.unrestricted, r.material.uom)} (min ${formatQty(r.material.minStock ?? 0, r.material.uom)})`).join("\n");
      return { text: `${rows.length} material${rows.length === 1 ? "" : "s"} below minimum stock:\n${lines}`, links: [{ label: "View Inventory", href: "/inventory?status=LOW" }] };
    },
  },
  {
    key: "critical_stock",
    requiresEntity: false,
    match: (q) => q.includes("critical"),
    handle: async () => {
      const rows = await getMaterialsByStatus("CRITICAL");
      if (rows.length === 0) return { text: "No materials are currently at critical stock." };
      const lines = rows.map((r) => `${r.material.name}: ${formatQty(r.unrestricted, r.material.uom)} (safety stock ${formatQty(r.material.safetyStock ?? 0, r.material.uom)})`).join("\n");
      return { text: `${rows.length} material${rows.length === 1 ? "" : "s"} at critical stock:\n${lines}`, links: [{ label: "View Inventory", href: "/inventory?status=CRITICAL" }] };
    },
  },
  {
    key: "lowest_days_of_cover",
    requiresEntity: false,
    match: (q) => q.includes("days of cover") || q.includes("days cover"),
    handle: async () => {
      const rows = await getLowestDaysOfCover(5);
      if (rows.length === 0) return { text: "There's insufficient consumption history to estimate Days of Cover for any material yet." };
      const lines = rows.map((r) => `${r.material.name}: ${formatNumber(r.daysCover!, 1)} days`).join("\n");
      return { text: `Lowest Days of Cover:\n${lines}`, links: [{ label: "View Inventory", href: "/inventory" }] };
    },
  },
  {
    key: "unusual_consumption",
    requiresEntity: false,
    match: (q) => q.includes("unusual") && q.includes("consumption"),
    handle: async () => {
      const { insights } = await getInventoryInsights();
      const anomalies = insights.filter((i) => i.type === "CONSUMPTION_ANOMALY");
      if (anomalies.length === 0) return { text: "No unusually high consumption detected recently." };
      const lines = anomalies.map((i) => `${i.materialName}: ${i.explanation}`).join("\n");
      return { text: lines, links: [{ label: "View Consumption Report", href: "/reports?tab=consumption" }] };
    },
  },
  {
    key: "highest_consumption",
    requiresEntity: false,
    match: (q) => q.includes("highest consumption") || (q.includes("consumption") && q.includes("most")),
    handle: async (ctx) => {
      const period = extractPeriod(ctx.question);
      const report = await getConsumptionReport({ from: period.from, to: period.to });
      const top = [...report.aggregateRows].sort((a, b) => b.totalConsumed - a.totalConsumed).slice(0, 3);
      if (top.length === 0) return { text: `No consumption was recorded for ${period.label}.` };
      const lines = top.map((r) => `${r.materialName}: ${formatQty(r.totalConsumed, r.uom)}`).join("\n");
      return { text: `Highest consumption (${period.label}):\n${lines}`, links: [{ label: "View Consumption Report", href: "/reports?tab=consumption" }] };
    },
  },
  {
    key: "consumption_for_period",
    requiresEntity: false,
    match: (q) => q.includes("consum"),
    handle: async (ctx) => {
      const period = extractPeriod(ctx.question);
      const report = await getConsumptionReport({ from: period.from, to: period.to });
      const total = report.aggregateRows.reduce((s, r) => s + r.totalConsumed, 0);
      if (report.aggregateRows.length === 0) return { text: `No consumption was recorded for ${period.label}.` };
      const top = [...report.aggregateRows].sort((a, b) => b.totalConsumed - a.totalConsumed).slice(0, 3);
      const breakdown = top.map((r) => `${r.materialName} ${formatQty(r.totalConsumed, r.uom)}`).join(", ");
      return { text: `For ${period.label}, ${formatNumber(total)} was consumed across ${report.aggregateRows.length} material${report.aggregateRows.length === 1 ? "" : "s"}. ${breakdown}.`, links: [{ label: "View Consumption Report", href: "/reports?tab=consumption" }] };
    },
  },
  {
    key: "in_transit_requests",
    requiresEntity: false,
    match: (q) => q.includes("in transit"),
    handle: async (ctx) => {
      const [scopeUserId, scopeField] = requestScope(ctx.currentUser);
      const { rows } = await getRequestReport({}, scopeUserId, scopeField);
      const inTransit = rows.filter((r) => r.status === "IN_TRANSIT");
      if (inTransit.length === 0) return { text: "No requests are currently in transit." };
      const lines = inTransit.slice(0, 5).map((r) => `${r.requestNumber} — ${formatQty(r.quantityRequested, r.uom)} ${r.materialName}`).join("\n");
      return { text: `${inTransit.length} request${inTransit.length === 1 ? "" : "s"} in transit:\n${lines}`, links: [{ label: "View Requests", href: "/requests" }] };
    },
  },
  {
    key: "issued_this_period",
    requiresEntity: false,
    match: (q) => q.includes("issu"), // "issued"/"issue" — matches Material and Spare Issue requests alike
    handle: async (ctx) => {
      const period = extractPeriod(ctx.question);
      const [scopeUserId, scopeField] = requestScope(ctx.currentUser);
      // Filtered by when the request was raised (getRequestReport's only date axis, same
      // precision level as consumption_for_period below) — deliveredQuantity is what actually
      // left the source via the Issue-purpose CONSUMPTION posting at execution.
      const { rows } = await getRequestReport({ purpose: "ISSUE", from: period.from, to: period.to }, scopeUserId, scopeField);
      const issued = rows.filter((r) => r.deliveredQuantity > 1e-9);
      if (issued.length === 0) return { text: `No Issue requests were completed for ${period.label}.`, links: [{ label: "View Requests", href: "/requests" }] };
      const top = [...issued].sort((a, b) => b.deliveredQuantity - a.deliveredQuantity).slice(0, 5);
      const lines = top.map((r) => `${r.materialName} ${formatQty(r.deliveredQuantity, r.uom)} (${r.requestNumber})`).join("\n");
      return { text: `${issued.length} Issue request${issued.length === 1 ? "" : "s"} for ${period.label}:\n${lines}`, links: [{ label: "View Request Report", href: "/reports?tab=request" }] };
    },
  },
  {
    key: "delayed_oldest_request",
    requiresEntity: false,
    match: (q) => q.includes("delay") || q.includes("longest") || q.includes("oldest"),
    handle: async (ctx) => {
      const [scopeUserId, scopeField] = requestScope(ctx.currentUser);
      const { rows } = await getRequestReport({}, scopeUserId, scopeField);
      const open = rows.filter((r) => (OPEN_REQUEST_STATUSES as readonly string[]).includes(r.status)).sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
      if (open.length === 0) return { text: "There are no pending requests right now." };
      const oldest = open[0];
      return {
        text: `${oldest.requestNumber} has been pending the longest — ${formatQty(oldest.quantityRequested, oldest.uom)} ${oldest.materialName}, status ${oldest.status.replace("_", " ")}, raised ${elapsed(oldest.requestedAt)} ago. This app has no configured delivery SLA, so this is elapsed time, not a violation.`,
        links: [{ label: "View Request", href: `/requests/${oldest.id}` }],
      };
    },
  },
  {
    key: "pending_requests",
    requiresEntity: false,
    match: (q) => q.includes("pending request") || (q.includes("request") && q.includes("pending")),
    handle: async (ctx) => {
      const [scopeUserId, scopeField] = requestScope(ctx.currentUser);
      const { rows } = await getRequestReport({}, scopeUserId, scopeField);
      const open = rows.filter((r) => (OPEN_REQUEST_STATUSES as readonly string[]).includes(r.status));
      if (open.length === 0) return { text: "There are no pending requests right now." };
      const lines = open.slice(0, 5).map((r) => `${r.requestNumber} — ${r.materialName}, ${r.status.replace("_", " ")}`).join("\n");
      return { text: `${open.length} pending request${open.length === 1 ? "" : "s"}:\n${lines}`, links: [{ label: "View Requests", href: "/requests" }] };
    },
  },
  {
    key: "qc_hold_amount",
    requiresEntity: false,
    match: (q) => q.includes("qc hold") || q.includes("quality hold"),
    handle: async () => {
      const rows = await getQualityHeld("QC_HOLD");
      if (rows.length === 0) return { text: "No material is currently on QC Hold." };
      const total = rows.reduce((s, r) => s + r.quantity, 0);
      const lines = rows.slice(0, 5).map((r) => `${r.materialName}: ${formatQty(r.quantity, r.uom)}`).join("\n");
      return { text: `${formatNumber(total)} on QC Hold across ${rows.length} material${rows.length === 1 ? "" : "s"}:\n${lines}`, links: [{ label: "View Quality", href: "/quality" }] };
    },
  },
  {
    key: "blocked_stock",
    requiresEntity: false,
    match: (q) => q.includes("blocked"),
    handle: async () => {
      const rows = await getQualityHeld("BLOCKED");
      if (rows.length === 0) return { text: "No material is currently blocked." };
      const total = rows.reduce((s, r) => s + r.quantity, 0);
      const lines = rows.slice(0, 5).map((r) => `${r.materialName}: ${formatQty(r.quantity, r.uom)}`).join("\n");
      return { text: `${formatNumber(total)} blocked across ${rows.length} material${rows.length === 1 ? "" : "s"}:\n${lines}`, links: [{ label: "View Quality", href: "/quality" }] };
    },
  },
  {
    key: "dispatch_pending",
    requiresEntity: false,
    match: (q) => q.includes("dispatch") && (q.includes("pending") || q.includes("which")),
    handle: async (ctx) => {
      const { rows } = await getDispatchReport({}, scopeToUserId(ctx.currentUser));
      const pending = rows.filter((r) => OPEN_DISPATCH_STATUSES.includes(r.status));
      if (pending.length === 0) return { text: "No dispatches are currently pending." };
      const lines = pending.slice(0, 5).map((r) => `${r.dispatchReference} — ${formatQty(r.quantity, r.uom)} ${r.materialName}, ${r.status}`).join("\n");
      return { text: `${pending.length} pending dispatch${pending.length === 1 ? "" : "es"}:\n${lines}`, links: [{ label: "View Dispatch", href: "/reports?tab=dispatch" }] };
    },
  },
  {
    key: "dispatch_completed_today",
    requiresEntity: false,
    match: (q) => q.includes("dispatch") && (q.includes("completed") || q.includes("today")),
    handle: async (ctx) => {
      const { rows } = await getDispatchReport({}, scopeToUserId(ctx.currentUser));
      const period = extractPeriod("today");
      const today = rows.filter((r) => r.status === "DISPATCHED" && r.dispatchedAt && r.dispatchedAt >= period.from && r.dispatchedAt <= period.to);
      if (today.length === 0) return { text: "No dispatches have completed today." };
      const totalQty = today.reduce((s, r) => s + r.quantity, 0);
      const lines = today.map((r) => `${r.dispatchReference} — ${formatQty(r.quantity, r.uom)} ${r.materialName}`).join("\n");
      return { text: `${today.length} dispatch${today.length === 1 ? "" : "es"} completed today, totaling ${formatNumber(totalQty)}:\n${lines}`, links: [{ label: "View Dispatch", href: "/reports?tab=dispatch" }] };
    },
  },
  {
    key: "dispatch_most_recent",
    requiresEntity: false,
    match: (q) => q.includes("dispatch") && (q.includes("recent") || q.includes("last")),
    handle: async (ctx) => {
      const { rows } = await getDispatchReport({}, scopeToUserId(ctx.currentUser));
      if (rows.length === 0) return { text: "No dispatches recorded yet." };
      const latest = rows[0]; // getDispatchReport orders by createdAt desc
      return { text: `The most recent dispatch is ${latest.dispatchReference} — ${formatQty(latest.quantity, latest.uom)} ${latest.materialName}, status ${latest.status}.`, links: [{ label: "View Dispatch", href: `/movements/dispatches/${latest.id}` }] };
    },
  },
  {
    key: "stock_movements_for_period",
    requiresEntity: false,
    match: (q) => q.includes("moved") || q.includes("received") || q.includes("transferred") || q.includes("adjustment"),
    handle: async (ctx) => {
      const period = extractPeriod(ctx.question);
      const operation = ctx.question.includes("received") ? "RECEIVE" : ctx.question.includes("transferred") ? "TRANSFER" : ctx.question.includes("adjustment") ? "ADJUSTMENT" : undefined;
      const report = await getStockMovementReport({ from: period.from, to: period.to, operation });
      if (report.rows.length === 0) return { text: `No matching stock movements were recorded for ${period.label}.` };
      const lines = report.rows.slice(0, 5).map((r) => `${r.materialName}: ${formatQty(r.quantity, r.uom)} (${r.transactionType.replace("_", " ")})`).join("\n");
      return { text: `${report.totalCount} movement${report.totalCount === 1 ? "" : "s"} for ${period.label}:\n${lines}`, links: [{ label: "View Stock Movement Report", href: "/reports?tab=movement" }] };
    },
  },
  {
    key: "why_inventory_decreased",
    requiresEntity: false,
    match: (q) => q.includes("why") && q.includes("decreas"),
    handle: async (ctx) => {
      const period = extractPeriod(ctx.question.includes("week") ? "this week" : "last 7 days");
      const report = await getInventoryReport({ from: period.from, to: period.to });
      const net = report.summary.closing - report.summary.opening;
      const text = net < 0
        ? `Inventory decreased by ${formatNumber(Math.abs(net))} ${report.summaryUom} over ${period.label} — ${formatNumber(report.summary.consumed)} was consumed and ${formatNumber(report.summary.dispatched)} was dispatched, against ${formatNumber(report.summary.received)} received.`
        : `Inventory actually increased by ${formatNumber(net)} ${report.summaryUom} over ${period.label}, not decreased.`;
      return { text, links: [{ label: "View Inventory Report", href: "/reports?tab=inventory" }] };
    },
  },
];
