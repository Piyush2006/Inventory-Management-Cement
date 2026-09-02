// Shared value sets for the string columns SQLite can't natively enforce as enums.
// Keep these as the single source of truth for both server logic and UI labels.

export const LOCATION_TYPES = ["STOCKPILE", "YARD", "BUNKER", "SILO", "STORE", "WAREHOUSE", "PRODUCTION_AREA"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
// Not user-creatable via Locations & Materials — the one system location used to
// represent material moved from a request's source but not yet confirmed received.
export const IN_TRANSIT_LOCATION_TYPE = "IN_TRANSIT";

export const MATERIAL_CATEGORIES = ["RAW_MATERIAL", "FUEL", "ADDITIVE", "INTERMEDIATE", "FINISHED_GOODS", "PACKING"] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export const TRANSACTION_TYPES = [
  "RECEIPT",
  "CONSUMPTION",
  "TRANSFER",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "ADJUSTMENT",
  "OPENING_BALANCE",
  "DISPATCH",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

// Sign convention: every ledger row stores a positive magnitude. Direction is implied
// purely by which of sourceLocationId/destinationLocationId is populated. These lists
// tell postMovement() which side to set for single-sided transaction types.
// TRANSFER_OUT/TRANSFER_IN are two-sided (both fields set on one row, per the
// Start Delivery / Confirm Receipt request flow) and are posted directly, not via postMovement.
export const OUTBOUND_TX_TYPES: TransactionType[] = ["CONSUMPTION", "DISPATCH"];
export const INBOUND_TX_TYPES: TransactionType[] = ["RECEIPT", "OPENING_BALANCE"];

export const STOCK_STATUSES = ["HEALTHY", "LOW", "CRITICAL"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

// Quality Hold / Release. UNRESTRICTED is never stored as a QualityBalance row (it's derived
// as OnHand − QC_HOLD − BLOCKED) but is still a valid fromStatus/toStatus on a QualityStatusEvent.
export const QUALITY_STATUSES = ["UNRESTRICTED", "QC_HOLD", "BLOCKED"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];
export const QUALITY_STATUS_LABELS: Record<QualityStatus, string> = {
  UNRESTRICTED: "Unrestricted",
  QC_HOLD: "QC Hold",
  BLOCKED: "Blocked",
};
// Fallback variance tolerance for Physical Count reconciliation when a material has no
// tolerancePct of its own set.
export const DEFAULT_TOLERANCE_PCT = 3;

// Full lifecycle:
//   NEW_REQUEST -> ACCEPTED -> ASSIGNED -> IN_TRANSIT -> DELIVERED -> COMPLETED
//   NEW_REQUEST -> REJECTED
//   DELIVERED -> NOT_RECEIVED -> (re-assign) -> ASSIGNED -> ... -> DELIVERED -> ...
//   DELIVERED -> (partial confirm) -> PARTIALLY_RECEIVED -> (re-assign) -> ASSIGNED -> ... -> COMPLETED
// The same Request ID and record stays attached through every round.
export const REQUEST_STATUSES = [
  "NEW_REQUEST",
  "ACCEPTED",
  "REJECTED",
  "ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "NOT_RECEIVED",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// Every status short of a terminal one (COMPLETED/REJECTED) — still needs someone's attention
// somewhere in the pipeline. Shared by the Requests page's own tabs and the Dashboard.
export const OPEN_REQUEST_STATUSES: RequestStatus[] = ["NEW_REQUEST", "ACCEPTED", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "NOT_RECEIVED", "PARTIALLY_RECEIVED"];

export const REQUEST_PRIORITIES = ["NORMAL", "URGENT"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

export const RESERVATION_STATUSES = ["ACTIVE", "RELEASED"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const REQUEST_EVENT_ACTIONS = [
  "REQUEST_CREATED",
  "ACCEPTED",
  "REJECTED",
  "ROUTED",
  "ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "NOT_RECEIVED",
  "RECEIVED",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
] as const;
export type RequestEventAction = (typeof REQUEST_EVENT_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Dispatch — finished-goods/customer dispatch, separate from the Request lifecycle above.
// Simple linear lifecycle plus one exception (Cancelled, reachable up to but not including
// Dispatched — once material has actually left the plant it can't be cancelled).
// ---------------------------------------------------------------------------
export const DISPATCH_STATUSES = ["CREATED", "APPROVED", "LOADING", "DISPATCHED", "CANCELLED"] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const DISPATCH_EVENT_ACTIONS = ["CREATED", "APPROVED", "REASSIGNED", "LOADING_STARTED", "DISPATCHED", "CANCELLED"] as const;
export type DispatchEventAction = (typeof DISPATCH_EVENT_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Users & roles — real server-side enforcement (src/lib/auth.ts), not just hidden buttons.
// No single role can perform the entire request workflow end to end.
// ---------------------------------------------------------------------------
export const USER_ROLES = ["REQUESTER", "STORE_SUPERVISOR", "STORE_OPERATOR", "INVENTORY_MANAGER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  REQUESTER: "Requester (Production/Operations)",
  STORE_SUPERVISOR: "Store Supervisor",
  STORE_OPERATOR: "Store / Delivery Operator",
  INVENTORY_MANAGER: "Inventory Manager",
  ADMIN: "Admin",
};

// Per the RBAC matrix: Admin has full access to every module and action, including all of the
// role-gated ones below — it's the one deliberate exception to "no single role can do it all."
export const ADMIN_ROLE: UserRole = "ADMIN";

// Accept / Reject a NEW_REQUEST — the first decision. Store Supervisor does NOT get this —
// its job is narrowed to assignment only; Inventory Manager makes the accept/reject call.
export const ACCEPT_REJECT_ROLES: UserRole[] = ["INVENTORY_MANAGER", "ADMIN"];
// Route an ACCEPTED request to one specific Store Supervisor — the Inventory Manager's second
// step, before anyone picks an operator. Two-hop chain: Inventory Manager routes to a
// Supervisor, then only that Supervisor assigns the Delivery Operator (see ASSIGN_ROLES).
export const ROUTE_ROLES: UserRole[] = ["INVENTORY_MANAGER", "ADMIN"];
// Assign a Store/Delivery Operator once a request has been routed to this specific Supervisor
// (or, for its next round, was already routed earlier). No longer reachable by the Inventory
// Manager directly — routing to a Supervisor is now a required hop first.
export const ASSIGN_ROLES: UserRole[] = ["STORE_SUPERVISOR", "ADMIN"];
// Start Delivery / Mark Delivered — but only by the specific operator this request is assigned to,
// or Admin (checked separately against request.assignedToUserId, not just role membership).
export const OPERATOR_ROLES: UserRole[] = ["STORE_OPERATOR", "ADMIN"];
// Record Stock Operations (Receive Material / Consume / Transfer / Adjustment). Store Supervisor does
// NOT get this — their job is managing the request queue, not touching stock directly.
export const STOCK_OPS_ROLES: UserRole[] = ["STORE_OPERATOR", "INVENTORY_MANAGER", "ADMIN"];
// Only the Inventory Manager (or Admin) approves stock adjustments — not Store Supervisor/Operator.
export const ADJUSTMENT_ROLES: UserRole[] = ["INVENTORY_MANAGER", "ADMIN"];
// Only the Inventory Manager (or Admin) manages the material/location master data.
export const MASTER_DATA_ROLES: UserRole[] = ["INVENTORY_MANAGER", "ADMIN"];

// Dispatch (customer/finished-goods dispatch) — deliberately grants Store Supervisor real
// access here (create/approve/execute-unrestricted/cancel), unlike its bare "no access" on
// the rest of Stock Operations (STOCK_OPS_ROLES above). See restrictStockOperationsFromSupervisor
// in auth.ts and movements/page.tsx for how the Supervisor's path to only this one tab is opened.
export const DISPATCH_CREATE_ROLES: UserRole[] = ["STORE_SUPERVISOR", "INVENTORY_MANAGER", "ADMIN"];
export const DISPATCH_APPROVE_ROLES: UserRole[] = ["STORE_SUPERVISOR", "INVENTORY_MANAGER", "ADMIN"];
// Start Loading / Mark Dispatched. Store Operator is further ownership-checked inline against
// Dispatch.assignedToUserId (src/lib/inventory/dispatch.ts) — Supervisor/Inventory Manager/Admin
// are not, mirroring the existing assignedToUserId-vs-Admin pattern in requests.ts, just
// generalized to two unrestricted roles instead of one.
export const DISPATCH_EXECUTE_ROLES: UserRole[] = ["STORE_OPERATOR", "STORE_SUPERVISOR", "INVENTORY_MANAGER", "ADMIN"];
export const DISPATCH_CANCEL_ROLES: UserRole[] = ["STORE_SUPERVISOR", "INVENTORY_MANAGER", "ADMIN"];
