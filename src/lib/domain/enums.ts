// Shared value sets for the string columns SQLite can't natively enforce as enums.
// Keep these as the single source of truth for both server logic and UI labels.

export const LOCATION_TYPES = ["STOCKPILE", "YARD", "BUNKER", "SILO", "STORE", "WAREHOUSE", "PRODUCTION_AREA"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
// Not user-creatable via Master Data — the one system location used to represent
// material issued from a request but not yet received at its destination.
export const IN_TRANSIT_LOCATION_TYPE = "IN_TRANSIT";

export const MATERIAL_CATEGORIES = ["RAW_MATERIAL", "FUEL", "ADDITIVE", "INTERMEDIATE", "FINISHED_GOODS", "PACKING"] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export const TRANSACTION_TYPES = [
  "RECEIPT",
  "CONSUMPTION",
  "PRODUCTION",
  "TRANSFER",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "DISPATCH",
  "ADJUSTMENT",
  "PACKING",
  "OPENING_BALANCE",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

// Sign convention: every ledger row stores a positive magnitude. Direction is implied
// purely by which of sourceLocationId/destinationLocationId is populated. These lists
// tell postMovement() which side to set for single-sided transaction types.
// TRANSFER_OUT/TRANSFER_IN are two-sided (both fields set on one row, per the request
// issue/receive flow in requests.ts) and are posted directly, not via postMovement.
export const OUTBOUND_TX_TYPES: TransactionType[] = ["CONSUMPTION", "DISPATCH"];
export const INBOUND_TX_TYPES: TransactionType[] = ["RECEIPT", "PRODUCTION", "OPENING_BALANCE"];

export const STOCK_STATUSES = ["HEALTHY", "LOW", "CRITICAL"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

// Full lifecycle: PENDING -> ACCEPTED -> ALLOCATED -> IN_TRANSIT -> (PARTIALLY_RECEIVED <-> ALLOCATED/IN_TRANSIT)* -> COMPLETED
// or PENDING -> REJECTED, or PENDING -> CANCELLED (requester, while still pending).
export const REQUEST_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "ALLOCATED",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_PRIORITIES = ["NORMAL", "URGENT"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

export const RESERVATION_STATUSES = ["ACTIVE", "RELEASED"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const REQUEST_EVENT_ACTIONS = [
  "REQUEST_RAISED",
  "ACCEPTED",
  "REJECTED",
  "ALLOCATED",
  "ISSUED",
  "RECEIVED",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RequestEventAction = (typeof REQUEST_EVENT_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Users & roles — real server-side enforcement (src/lib/auth.ts), not just hidden buttons.
// ---------------------------------------------------------------------------
export const USER_ROLES = ["REQUESTER", "STORE_OPERATOR", "INVENTORY_MANAGER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  REQUESTER: "Requester (Production/Operations)",
  STORE_OPERATOR: "Store / Inventory Operator",
  INVENTORY_MANAGER: "Inventory Manager",
  ADMIN: "Admin",
};

// Roles allowed to accept/reject/allocate/issue a request, record physical stock
// movements (Receipt/Consumption/Dispatch/Transfer/Packing/Production), and run procurement/GRN.
export const FULFILMENT_ROLES: UserRole[] = ["STORE_OPERATOR", "INVENTORY_MANAGER"];
// Only the Inventory Manager approves stock adjustments — not Store Operator, not Admin.
export const ADJUSTMENT_ROLES: UserRole[] = ["INVENTORY_MANAGER"];
// Only the Inventory Manager manages the material/location master data — not Store Operator, not Admin.
export const MASTER_DATA_ROLES: UserRole[] = ["INVENTORY_MANAGER"];
