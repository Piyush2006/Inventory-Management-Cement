# Berrima Cement Plant — Inventory Management System

A working, single-site cement plant inventory management system. Every action creates a persisted
record and updates inventory immediately — there is no mock data layer and no static dashboard.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **Prisma + SQLite** (swap the `provider` in `prisma/schema.prisma` to `postgresql` for production —
  the app code is otherwise database-agnostic)
- **Tailwind CSS v4**, **Recharts**, **Vitest**
- Cookie-backed "current user" switcher (no real login) — every privileged action still re-derives the
  user server-side and checks their role independently, not just via hidden UI buttons
- Icon badges on the dashboard are genuine Icons8 icons, proxied through `next/image` (see
  `images.remotePatterns` in `next.config.ts`)

## Navigation

| Screen | Route | Who sees it |
|---|---|---|
| Dashboard | `/` | Everyone except Requester |
| Locations | `/locations` | Everyone except Requester (edit requires Inventory Manager) |
| Materials | `/materials` | Everyone except Requester (edit requires Inventory Manager) |
| Inventory | `/inventory`, `/inventory/[materialId]` | Everyone except Requester |
| Requests | `/requests`, `/requests/[id]` | Everyone |
| Stock Operations | `/movements` | Everyone except Requester (recording requires Store Operator / Inventory Manager; Store Supervisor is view-only here) |

A **Requester**'s entire surface is Requests — raise a request, see their own, act on their own. Every
other route redirects them back to `/requests` server-side, not just via a hidden sidebar link.

`/ledger` and `/receipts/[id]` still exist as deep-linkable detail routes (not in the sidebar) for
full transaction history and GRN detail respectively.

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Requester** (Production/Operations) | Create a request, view their own, confirm receipt or report not-received | Accept/reject, route, assign, start delivery, mark delivered, touch inventory directly |
| **Store Supervisor** | Assign a Delivery Operator — but only for a request **routed to them specifically** by the Inventory Manager, not just any accepted request; view Inventory & Stock Operations | Accept/reject, route a request, record Stock Operations, act as the delivery operator |
| **Store/Delivery Operator** | Start delivery and mark delivered — but only for requests *assigned to them specifically*; record Stock Operations (Consume/Transfer/Receive Material) | Accept/reject, route, assign, confirm receipt |
| **Inventory Manager** | Accept/reject new requests, route an accepted request to a Store Supervisor, manage Materials & Locations, approve stock adjustments & Quality Release/Hold/Block, everything Store Operator can do | Assign a Delivery Operator directly (must route to a Supervisor first — see below) |
| **Admin** | Everything, unconditionally — the one deliberate exception to "no single role does it all"; bypasses every ownership check (e.g. can start delivery on a request assigned to someone else) | — |

No single non-Admin role can carry a request through its entire lifecycle alone — this is enforced in
the backend (`src/lib/auth.ts` `requireRole`, plus per-row ownership checks in `src/lib/inventory/requests.ts`),
not just by hiding buttons. The full role→action matrix lives in `src/lib/domain/enums.ts`
(`ACCEPT_REJECT_ROLES`, `ROUTE_ROLES`, `ASSIGN_ROLES`, `OPERATOR_ROLES`, `STOCK_OPS_ROLES`,
`ADJUSTMENT_ROLES`, `MASTER_DATA_ROLES`).

## The Request lifecycle

```
NEW_REQUEST → ACCEPTED → (routed to a Store Supervisor) → ASSIGNED → IN_TRANSIT → DELIVERED → COMPLETED
NEW_REQUEST → REJECTED (reason required)
DELIVERED → NOT_RECEIVED (reason required) → re-assign → ASSIGNED → ... → DELIVERED → ...
DELIVERED → PARTIALLY_RECEIVED (partial confirm) → re-assign → ASSIGNED → ... → COMPLETED
```

It's a **two-hop assignment chain**: the Inventory Manager accepts a request, then routes it to one
specific Store Supervisor (`routeToSupervisor`) — only that Supervisor can then assign a Delivery
Operator (`assignOperator`), which is checked against `StockRequest.routedToUserId`, not just role
membership. Routing persists across re-assignment rounds (NOT_RECEIVED / PARTIALLY_RECEIVED) unless
the Inventory Manager explicitly re-routes to someone else.

The same Request ID and record stays attached through every round — a partial receipt or a
not-received exception never spins up a new request. Every event (including `ROUTED`) is persisted to
`RequestEvent` (action, user, role, quantity, reason, timestamp) and rendered as the request's
timeline — never hard-coded.

**Inventory mechanics per stage** (`src/lib/inventory/requests.ts`):
- `NEW_REQUEST` / `ACCEPTED` — no stock impact.
- `ASSIGNED` — reserves stock at the source location (`StockReservation`); On Hand is unchanged, but
  Available (On Hand − Reserved) drops so nothing else can double-book it.
- `IN_TRANSIT` (Start Delivery) — physically moves stock out of the source into a shared virtual
  "In Transit (Internal)" location (`TRANSFER_OUT`); the reservation is released.
- `DELIVERED` (Mark Delivered) — a status/record change only, no stock movement (material is already
  sitting in the in-transit bucket).
- `COMPLETED` / `PARTIALLY_RECEIVED` (Confirm Receipt) — moves stock from the in-transit bucket into
  the destination's On Hand (`TRANSFER_IN`).

The Request Detail page (`/requests/[id]`) shows Request Information, People (Requested/Accepted/
Routed/Assigned/Delivered By), Quantities (Requested/Delivered/Received/Remaining), the full Timeline,
and every related stock movement (matched by ledger `reference` = the request number) — one page, no
digging across screens.

The Requests list (`/requests`) is tabbed — the role-specific action queue, Open Requests, Request
History, and + New Request — and every row can Route/Assign/Start Delivery/Mark Delivered/Confirm
Receipt inline via an expandable row, without leaving the list. Each row also has an **Export CSV**
button that exports exactly the rows currently visible in that tab (so it automatically respects
per-role scoping — a Requester's export can only ever contain their own requests).

## Quality Hold / Release

Stock at a location can be **Unrestricted**, **QC Hold**, or **Blocked**. Unrestricted is never stored
as its own row — it's always derived as `On Hand − QC Hold − Blocked` (`getUnrestrictedAvailable` in
`src/lib/inventory/quality.ts`). A GRN receipt can flag its accepted quantity QC Hold/Blocked at
posting time; an Inventory Manager or Admin can Release, Hold, or Block any quantity from the Material
Detail page's per-location Quality panel, with a mandatory reason and a full audit trail
(`QualityStatusEvent`). Days of Cover, the Dashboard's HEALTHY/LOW/CRITICAL classification, and the
Inventory list all use Unrestricted stock, not raw On Hand, so QC Hold/Blocked material can't make
something look falsely healthy.

## Physical Count / Reconciliation

Record what you physically count against a location; the system shows book stock and the variance
automatically. Each material has a tolerance band (`Material.tolerancePct`, default ±3%) — a variance
inside it is flagged "Within Tolerance", outside it "Investigation Required". Posting the resulting
adjustment (via the existing ledgered `postAdjustment`, never a direct edit) requires Inventory
Manager/Admin; anyone else can still **record** a count with a variance — it just sits in the
"Pending Physical Counts" panel (`/movements`) until an Inventory Manager approves and posts it.

## Consumption History + Days of Cover

The Material Detail page shows a 30-day consumption log, a 30-day total, and an average daily rate,
alongside **Days of Cover** = Unrestricted stock ÷ average daily consumption (never divides by zero —
shows N/A instead). The Dashboard's "Stock Requiring Attention" watchlist sorts every material by Days
of Cover ascending, so a currently-healthy material that's burning down fast surfaces before it
becomes a problem, not just materials already below threshold.

## Dashboard

Five icon stat cards (Critical Stock / Low Stock / In Transit / Open Requests / Exceptions, each
linking to a filtered view), a unified **Needs Attention** feed combining critical/low-stock materials
and NOT_RECEIVED request exceptions into one list, a **Request Status** breakdown by lifecycle stage,
the Days-of-Cover **watchlist**, 14-day inventory/consumption trend charts, Silo Quick View, the full
Inventory table, and Recent Movements. Every number traces back to a live query in
`src/lib/inventory/dashboard.ts` — nothing is hard-coded.

## Stock Operations

`/movements` — tabbed: **Receive Material** (GRN workflow below), **Consume**, **Transfer**,
**Adjustment**, plus the Pending Physical Counts panel for approvers. Every action posts a row to
`InventoryTransaction`; `InventoryBalance` is a materialized cache kept in sync on every write. Stock
is never edited directly — corrections always go through `postAdjustment` with a mandatory reason, and
historical rows are never mutated.

### Receive Material (GRN)

**Supplier → Purchase/Source Reference (optional) → Material Receipt/GRN → Accepted Quantity + Quality Status → Inventory**

- Inventory increases by the **accepted** quantity only — never ordered or received.
- Rejected quantity is always auto-derived (`received − accepted`).
- Two submit actions: **Save as Draft** (never touches stock) and **Post GRN** (posts the movement and
  rolls the linked PO's status forward).
- Cancelling a posted receipt reverses it with an audited `ADJUSTMENT`, never deletes the original
  transaction.
- This is intentionally separate from the internal Request lifecycle above — it's how material enters
  the plant from outside, not how it moves between internal locations.

## No stock-quantity validation, anywhere — by explicit design

This is deliberate, not a bug: no action in this app is ever blocked because of insufficient stock, a
location's nominal capacity, or a purchase order's ordered quantity. Consuming/transferring more than
is on hand, receiving more than a location's capacity or a PO's ordered quantity, confirming receipt
of more than was delivered, releasing more QC Hold than is recorded — all of it posts, and the
resulting number (even negative, even over 100% of capacity) is shown honestly rather than hidden.
RBAC (who's allowed to do what) and the request lifecycle's state-machine guards (e.g. can't accept an
already-rejected request, can't assign before routing) are **not** part of this — those still apply.
See `applyBalanceDelta` in `src/lib/inventory/ledger.ts` for the single point where this is enforced.

## Data model highlights

- `StockRequest` — the request record itself: quantities, status, from/to locations, and denormalized
  actor columns (`acceptedByUserId`, `routedToUserId`, `assignedToUserId`, `deliveredByUserId`, etc.)
  for fast display.
- `RequestEvent` — append-only audit trail / timeline source (includes `ROUTED`).
- `StockReservation` — soft lock backing the On Hand / Reserved / Available split.
- `InventoryTransaction` / `InventoryBalance` — the ledger and its materialized cache. Every ledger row
  stores a **positive magnitude**; direction is implied purely by which of `sourceLocationId` /
  `destinationLocationId` is populated.
- `QualityBalance` / `QualityStatusEvent` — QC Hold/Blocked quantities per (material, location) and
  their audit trail; mirrors the `InventoryTransaction`/`InventoryBalance` split for the same reason
  (materialized cache + append-only log).
- `PhysicalCount` — one row per count, linked to its posted `ADJUSTMENT` transaction (if any) via
  `adjustmentTransactionId`; null means still pending approval.
- `Supplier` / `PurchaseReference` / `MaterialReceipt` — the lightweight GRN subsystem, independent of
  `StockRequest`.

## Seeded demo data (`prisma/seed.ts`)

Twelve+ requests spanning every lifecycle status (including a live NOT_RECEIVED exception, a live
PARTIALLY_RECEIVED round, and one sitting in the ROUTED-but-not-yet-assigned state), Quality Hold and
Blocked examples across several materials plus a full hold-then-release cycle, a posted physical-count
adjustment and one left pending approval, six GRN receipts across six suppliers (mixing posted and
draft), and roughly 18 days of realistic consumption history per material. Opening balances are
backdated ~25 days so the 14-day trend charts show a real curve instead of a flat line with a cliff on
day one.

```bash
npm install
npm run db:seed      # wipes + reseeds all demo data
npm run dev -- -p 3033
npm run test          # separate throwaway SQLite file, safe alongside the dev server; 49 tests
```

**Important:** if you reseed the database while `next dev` is already running, restart the dev server
— it holds an open SQLite connection to the previous database file.

## Deployment

The live deployment is a **separate checkout** managed by PM2 (not the workspace you edit in), pulling
from `main` on push. After any `prisma/schema.prisma` change, that checkout's database needs to be
brought up to date too — `npx prisma db push` (safe here since every schema change so far has been
additive) followed by `pm2 restart <app-name>` to pick up the regenerated Prisma Client, which is
cached in the running process's memory and won't update on its own.

## Explicitly out of scope

Multi-site/network model, production/BOM/consumption-coefficient engine, packing, forecasting or
auto-reorder, full accounts-payable/invoice processing (invoice fields are reference-only), real
integrations (SAP/SCADA/weighbridge/sensors), full supplier management (a supplier is a name +
optional reference, created inline), real authentication (the cookie-based user switcher is a demo
convenience only).
