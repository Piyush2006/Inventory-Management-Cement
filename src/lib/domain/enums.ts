// Shared value sets for the string columns SQLite can't natively enforce as enums.
// Keep these as the single source of truth for both server logic and UI labels.

export const LOCATION_TYPES = ["STOCKPILE", "YARD", "BUNKER", "SILO", "STORE", "WAREHOUSE", "PRODUCTION_AREA"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
// Not user-creatable via Locations & Materials — the one system location used to
// represent material moved from a request's source but not yet confirmed received.
export const IN_TRANSIT_LOCATION_TYPE = "IN_TRANSIT";

export const MATERIAL_CATEGORIES = ["RAW_MATERIAL", "FUEL", "ADDITIVE", "INTERMEDIATE", "FINISHED_GOODS", "PACKING", "SPARE"] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Spare Management — a spare is a Material (category = SPARE); a spare request is a
// StockRequest (requestType = SPARE). See src/lib/inventory/spareReturn.ts.
// ---------------------------------------------------------------------------
export const SPARE_CRITICALITIES = ["CRITICAL", "IMPORTANT", "NORMAL"] as const;
export type SpareCriticality = (typeof SPARE_CRITICALITIES)[number];

export const REQUEST_TYPES = ["MATERIAL", "SPARE"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

// A returned spare's condition maps onto the existing quality statuses — no new state system.
// UNUSED/SERVICEABLE -> Unrestricted (plain stock-in). FOR_INSPECTION -> QC_HOLD. DAMAGED -> BLOCKED.
export const RETURN_CONDITIONS = ["UNUSED", "SERVICEABLE", "DAMAGED", "FOR_INSPECTION"] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

// A Spare Return is reported (no inventory effect) before it's completed (posts the ledger
// entry) — see src/lib/inventory/spareReturn.ts.
export const SPARE_RETURN_STATUSES = ["REPORTED", "COMPLETED"] as const;
export type SpareReturnStatus = (typeof SPARE_RETURN_STATUSES)[number];

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

export const STOCK_STATUSES = ["HEALTHY", "CRITICAL"] as const;
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

// Request Purpose — TRANSFER (move stock between two locations, the original behavior) or ISSUE
// (stock leaves the source for use/consumption; no destination location). Orthogonal to
// requestType (Material/Spare) above — four combinations, one request mechanism.
export const REQUEST_PURPOSES = ["TRANSFER", "ISSUE"] as const;
export type RequestPurpose = (typeof REQUEST_PURPOSES)[number];

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

// The internal role key stays "REQUESTER" everywhere in code/DB (no migration, no risk to the
// dozens of existing role checks) — only the user-facing label changes. "Indentor" is the
// standard industry term for production/operations staff who raise a material indent against
// the store, matching this app's own "REQ-"/request terminology and its Indian-plant setting.
export const ROLE_LABELS: Record<UserRole, string> = {
  REQUESTER: "Indentor",
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
// Record Stock Operations (Receive Material). Store Supervisor does NOT get this — their job
// is managing the request queue, not touching stock directly. The Adjustment tab's
// physical-count step is broader — see PHYSICAL_COUNT_ROLES below — because the Adjustment
// workflow spec explicitly gives Store Supervisor a recording/reviewing role there, unlike
// Receive Material which stays exactly as before. Manual Consume/Transfer entry was removed
// from Stock Operations — stock now only moves via Receive, Adjustment, Dispatch, Spare
// Return, or the Requests (Transfer & Issue) lifecycle itself.
export const STOCK_OPS_ROLES: UserRole[] = ["STORE_OPERATOR", "INVENTORY_MANAGER", "ADMIN"];
// Record a physical count and submit any discrepancy for review (Adjustment workflow, step 1).
// Store Supervisor gets this even though it doesn't get STOCK_OPS_ROLES — recording/reviewing a
// count is explicitly part of its job in the Adjustment workflow, submitting stock movements
// directly is not.
export const PHYSICAL_COUNT_ROLES: UserRole[] = ["STORE_OPERATOR", "STORE_SUPERVISOR", "INVENTORY_MANAGER", "ADMIN"];
// Only the Inventory Manager (or Admin) approves/rejects and posts stock adjustments — not
// Store Supervisor/Operator, who can only get a count to this point, not past it.
export const ADJUSTMENT_ROLES: UserRole[] = ["INVENTORY_MANAGER", "ADMIN"];
// Only the Inventory Manager (or Admin) manages the material/location master data.
export const MASTER_DATA_ROLES: UserRole[] = ["INVENTORY_MANAGER", "ADMIN"];

// Spare Return — a Requester/Maintenance user reports a return (no inventory effect); a Store
// Operator then completes it (chooses the receiving location + verified condition, which is
// what actually posts the ledger entry). Inventory Manager/Store Supervisor can only view —
// per spec neither approves or completes a normal return, so they're deliberately absent from
// both role lists below, unlike the Adjustment/Receive/Dispatch workflows where they can act.
export const SPARE_RETURN_REPORT_ROLES: UserRole[] = ["REQUESTER", "STORE_OPERATOR", "ADMIN"];
export const SPARE_RETURN_COMPLETE_ROLES: UserRole[] = ["STORE_OPERATOR", "ADMIN"];
// Everyone who can see the Spare Return tab in Stock Operations at all (recording or just
// monitoring) — Store Supervisor/Inventory Manager are view-only there (no report/complete access).
export const SPARE_RETURN_VIEW_ROLES: UserRole[] = ["STORE_OPERATOR", "STORE_SUPERVISOR", "INVENTORY_MANAGER", "ADMIN"];

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

// ---------------------------------------------------------------------------
// Notifications — additive, sits on top of the workflows above. See src/lib/notifications/.
// ---------------------------------------------------------------------------
export const NOTIFICATION_RECIPIENT_TYPES = ["ROLE", "SPECIFIC_USER", "RELEVANT_USER"] as const;
export type NotificationRecipientType = (typeof NOTIFICATION_RECIPIENT_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL", "BOTH"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_RULE_STATUSES = ["ENABLED", "DISABLED"] as const;
export type NotificationRuleStatus = (typeof NOTIFICATION_RULE_STATUSES)[number];

export const NOTIFICATION_TYPES = ["ACTION_REQUIRED", "INFORMATION"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Configuring notification rules reuses the same role set that already manages material/
// location master data — no new notification-specific role.
export const NOTIFICATION_CONFIG_ROLES: UserRole[] = MASTER_DATA_ROLES;

// ---------------------------------------------------------------------------
// Report Scheduling — a persisted delivery preference for an existing /reports tab, not a
// real cron job (no background job runner in this sandboxed app). "Run Now" is the only way
// a schedule is ever executed; frequency is a stored label describing intended cadence only.
// See src/app/reports/schedules-panel.tsx.
// ---------------------------------------------------------------------------
export const REPORT_TYPES = ["inventory", "consumption", "movement", "request", "dispatch"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  inventory: "Inventory",
  consumption: "Consumption",
  movement: "Stock Movement",
  request: "Request",
  dispatch: "Dispatch",
};

export const REPORT_SCHEDULE_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type ReportScheduleFrequency = (typeof REPORT_SCHEDULE_FREQUENCIES)[number];

export const REPORT_SCHEDULE_STATUSES = ["ENABLED", "DISABLED"] as const;
export type ReportScheduleStatus = (typeof REPORT_SCHEDULE_STATUSES)[number];

// Deliberately excludes RELEVANT_USER (NOTIFICATION_RECIPIENT_TYPES' third option) — that only
// makes sense resolved off a live workflow record, which a time-based schedule doesn't have.
export const REPORT_SCHEDULE_RECIPIENT_TYPES = ["ROLE", "SPECIFIC_USER"] as const;
export type ReportScheduleRecipientType = (typeof REPORT_SCHEDULE_RECIPIENT_TYPES)[number];

// Day of week for a WEEKLY schedule — dayOfMonth (MONTHLY) is a plain 1-31 Int, no enum needed.
export const DAYS_OF_WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];
export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday", THURSDAY: "Thursday", FRIDAY: "Friday", SATURDAY: "Saturday", SUNDAY: "Sunday",
};
