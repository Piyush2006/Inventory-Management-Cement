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
- Full light/dark theming via CSS custom properties (`src/app/globals.css`) — every color in the app
  goes through this token system (verified by a full-codebase audit; no raw Tailwind palette classes
  or unguarded hex colors anywhere)
- No external AI/LLM service, no email provider — both "AI" features (Insights, Bruce AI) are
  deterministic calculations/intent-matching over existing data, and email notifications are a
  simulated (logged, not sent) transport — see **Bruce AI** and **Notifications** below

## Navigation

| Screen | Route | Who sees it |
|---|---|---|
| Dashboard (+ Bruce AI) | `/` | Everyone |
| Locations | `/locations` | Everyone (edit requires Inventory Manager) |
| Materials | `/materials` | Everyone (edit requires Inventory Manager) |
| Inventory | `/inventory`, `/inventory/[materialId]` | Everyone |
| Requests | `/requests`, `/requests/[id]` | Everyone |
| Stock Operations | `/movements` | Everyone except Indentor (recording requires Store Operator / Inventory Manager; Store Supervisor is Dispatch-only here) |
| Dispatch detail | `/movements/dispatches/[id]` | Everyone except Indentor |
| Reports | `/reports` | Everyone (Request tab is scoped to the viewer's own requests for Indentor/Store Operator) |
| Notifications | `/notifications` | Everyone (Rules tab requires Inventory Manager/Admin) |
| Ledger | `/ledger` | Everyone |
| Receipts (GRN) | `/receipts/new`, `/receipts/[id]` | Everyone except Indentor |

An **Indentor**'s only write surface is Requests (raise, view own, confirm/not-received) — but they
have full *read* access everywhere else (Dashboard, Inventory, Locations, Materials, Reports, Ledger),
same as every other non-write-privileged role. Only the genuinely write-heavy screens — Stock
Operations, GRN receiving, the Dispatch detail page — stay redirected server-side for this role, not
just hidden from the sidebar.

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Indentor** (internal role key: `REQUESTER` — unchanged in code/DB, only the display label is "Indentor", the standard industry term for production/operations staff who raise a material indent) | Create a request, view their own, confirm receipt or report not-received; full read access to Dashboard/Inventory/Locations/Materials/Reports/Ledger, including Bruce AI | Accept/reject, route, assign, start delivery, mark delivered, touch inventory directly, reach Stock Operations/GRN/Dispatch |
| **Store Supervisor** | Assign a Delivery Operator — but only for a request **routed to them specifically** by the Inventory Manager, not just any accepted request; create/approve/manage-loading/cancel a Dispatch; view Inventory & Stock Operations | Accept/reject, route a request, record Consume/Transfer/Receive Material/Adjustment, act as the delivery operator |
| **Store/Delivery Operator** | Start delivery and mark delivered — but only for requests *assigned to them specifically*; record Stock Operations (Consume/Transfer/Receive Material); start loading and mark a Dispatch dispatched — but only one *assigned to them specifically* | Accept/reject, route, assign, confirm receipt, approve/create/cancel a Dispatch |
| **Inventory Manager** | Accept/reject new requests, route an accepted request to a Store Supervisor, manage Materials & Locations, approve stock adjustments & Quality Release/Hold/Block, create/approve/cancel a Dispatch, configure Notification Rules, everything Store Operator can do | Assign a Delivery Operator directly (must route to a Supervisor first — see below) |
| **Admin** | Everything, unconditionally — the one deliberate exception to "no single role does it all"; bypasses every ownership check (e.g. can start delivery on a request assigned to someone else) | — |

No single non-Admin role can carry a request through its entire lifecycle alone — this is enforced in
the backend (`src/lib/auth.ts` `requireRole`, plus per-row ownership checks in `src/lib/inventory/requests.ts`),
not just by hiding buttons. The full role→action matrix lives in `src/lib/domain/enums.ts`
(`ACCEPT_REJECT_ROLES`, `ROUTE_ROLES`, `ASSIGN_ROLES`, `OPERATOR_ROLES`, `STOCK_OPS_ROLES`,
`ADJUSTMENT_ROLES`, `MASTER_DATA_ROLES`, `DISPATCH_*_ROLES`, `NOTIFICATION_CONFIG_ROLES`).

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
per-role scoping — an Indentor's export can only ever contain their own requests).

## Dispatch

A second, independent lifecycle alongside Requests — finished-goods material leaving the plant for a
customer, not internal stock movement. Lives inside Stock Operations (`/movements`, Dispatch tab) and
its own detail page (`/movements/dispatches/[id]`); no separate top-level nav item.

```
CREATED → APPROVED → LOADING → DISPATCHED
CREATED / APPROVED / LOADING → CANCELLED (reason required; never once DISPATCHED — material has left)
```

- **`createDispatch`** (Store Supervisor/Inventory Manager/Admin) — basic sanity only, no stock check.
- **`approveDispatch`** — assigns a Store/Delivery Operator and is the first Unrestricted-stock
  sufficiency gate (`getUnrestrictedAvailable`, `src/lib/inventory/quality.ts`).
- **`startDispatchLoading`** / **`markDispatched`** — only the assigned operator (or Admin) can act;
  the sufficiency check re-runs at each step, immediately before the final ledger write at
  `markDispatched` — the smallest possible check-then-act window.
- Inventory only decreases once, at `markDispatched`, via `postMovement({ transactionType:
  "DISPATCH", allowNegative: false })` — the **one deliberate exception** to this app's otherwise
  fully permissive stock-quantity policy (see below); every other ledger caller still allows negative/
  over-capacity postings.

`DispatchEvent` mirrors `RequestEvent` — one append-only row per lifecycle action, the source for the
detail page's timeline.

## Quality Hold / Release

Stock at a location can be **Unrestricted**, **QC Hold**, or **Blocked**. Unrestricted is never stored
as its own row — it's always derived as `On Hand − QC Hold − Blocked` (`getUnrestrictedAvailable` in
`src/lib/inventory/quality.ts`). A GRN receipt can flag its accepted quantity QC Hold/Blocked at
posting time; an Inventory Manager or Admin can Release, Hold, or Block any quantity from the Material
Detail page's per-location Quality panel, with a mandatory reason and a full audit trail
(`QualityStatusEvent`). Days of Cover, the Dashboard's HEALTHY/LOW/CRITICAL classification, the
Inventory list, Reports, and Bruce AI all use Unrestricted stock, not raw On Hand, so QC Hold/Blocked
material can't make something look falsely healthy.

## Physical Count / Reconciliation

Record what you physically count against a location; the system shows book stock and the variance
automatically. Each material has a tolerance band (`Material.tolerancePct`, default ±3%) — a variance
inside it is flagged "Within Tolerance", outside it "Investigation Required". Posting the resulting
adjustment (via the existing ledgered `postAdjustment`, never a direct edit) requires Inventory
Manager/Admin; anyone else can still **record** a count with a variance — it just sits in the
"Pending Physical Counts" panel (`/movements`, Adjustment tab) until an Inventory Manager approves and
posts it.

## Consumption History + Days of Cover

The Material Detail page shows a 30-day consumption log, a 30-day total, and an average daily rate,
alongside **Days of Cover** = Unrestricted stock ÷ average daily consumption (never divides by zero —
shows N/A instead, `src/lib/inventory/daysOfCover.ts`). Reused directly by both the AI Insights engine
and Bruce AI rather than re-implemented.

## Dashboard + AI Inventory Insights

A compact KPI strip (Critical Stock / Low Stock / In Transit / Open Requests / Exceptions, each
linking to a filtered view), a two-column layout on wide screens with the **Bruce AI** card + chat in
a sticky right rail, then the 14-day inventory/consumption trend charts, Silo Quick View, a unified
**Needs Attention** feed (critical/low-stock materials + NOT_RECEIVED exceptions), Request Status
breakdown, the Days-of-Cover watchlist, the full Inventory table, and Recent Movements. Every number
traces back to a live query — nothing is hard-coded.

The insight card (`getInventoryInsights()`, `src/lib/inventory/insights.ts`) is deterministic risk
scoring + templated explanation over existing data (no external model call) — four insight types in
priority order per material: **High Inventory Risk** (at/below or approaching safety stock — fires
even with zero consumption history, purely off the threshold), **Usable Stock Risk** (QC Hold/Blocked
materially reducing what's usable), **Medium Risk** (low Days of Cover with no safety-stock threshold
to compare to), **Unusual Consumption** (recent rate well above its own trailing average). Shows the
top 5 by severity; supplements the rule-based Critical/Low alerts, never replaces them.

## Bruce AI — Inventory Copilot

A conversational panel on the Dashboard (right rail) answering natural-language inventory questions —
"which materials are below minimum stock?", "why is OPC 43 critical?", "what did we consume
yesterday?", "which requests are pending?" — via **deterministic intent-matching**, not a real LLM
call (this environment has no LLM API credentials; keyword/entity matching maps a question to one of
~20 handlers, each calling straight into an existing calculation function — `getInventoryInsights`,
`computeDaysOfCover`, `getTotalUnrestrictedAvailable`, and the whole Reports module — no second data
source or duplicated business logic, `src/lib/bruce/`). RBAC-aware: a Store Operator or Indentor
asking about "pending requests" gets the same ownership-scoped answer Reports/the Requests page would
give them, never wider. Never writes anything — pure advisory read layer; a failure resolves to "Bruce
AI is temporarily unavailable" rather than breaking the Dashboard.

## Reports

`/reports` — four read-only tabs reusing existing data, no second reporting source
(`src/lib/reports/`): **Inventory** (Opening/Received/Consumed/Transfer In-Out/Dispatched/Adjustments/
Closing per material, reconstructed live from the ledger — no snapshot table — with the identity
`Opening + Received + TransferIn − Consumed − TransferOut − Dispatched + Adjustments = Closing`
holding exactly by construction), **Consumption** (detail + per-material average), **Stock Movement**
(paged, with a separate unpaginated query backing CSV export so "Export" always means every matching
row, not just the current page), **Request** and **Dispatch** (each independently scoped to the
viewer's own records for Store Operator/Indentor, unscoped for everyone else — same rule the rest of
the app already applies). Common filter bar (Date Range/Material/Location/Operation/Status/Reference/
User, only the fields relevant to the active tab) and CSV export throughout.

## Notification & Alert Management

A header bell (unread badge + dropdown) and `/notifications` (All/Unread feed + a Rules tab gated to
Inventory Manager/Admin) — sits on top of the existing workflows via hooks in `src/app/actions.ts`
only (the Server Action layer), never inside `requests.ts`/`dispatch.ts`/`quality.ts`/`ledger.ts`
themselves (`src/lib/notifications/`). A controlled event list (Request lifecycle, Dispatch lifecycle,
Stock Low/Critical, QC Hold released) maps to configurable rules — Recipients (Role / Specific User /
"Relevant User", resolved from the record's own foreign keys), Channel (In-App / Email / Both),
Status (Enabled/Disabled), templated Title/Message. Email is a **simulated transport** (logged, marked
Sent — no real SMTP/API credentials exist in this environment; the whole pipeline through rule →
recipient → template → persisted record is real and swappable for a live provider later). Stock
Low/Critical fires only on a *worsening* transition (`MaterialAlertState`), not on every balance-
changing action while already critical. Disabling a rule only stops notifications from it — never the
underlying business workflow.

## Stock Operations

`/movements` — tabbed: **Receive Material** (GRN workflow below), **Consume**, **Transfer**,
**Adjustment** (with its own Pending Physical Counts panel), **Dispatch** (see above) — each tab shows
only its own history, not a shared movement list. Every action posts a row to `InventoryTransaction`;
`InventoryBalance` is a materialized cache kept in sync on every write. Stock is never edited directly
— corrections always go through `postAdjustment` with a mandatory reason, and historical rows are
never mutated.

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

## Stock-quantity validation — permissive everywhere except Dispatch, by explicit design

No action in this app is ever blocked because of insufficient stock, a location's nominal capacity, or
a purchase order's ordered quantity. Consuming/transferring more than is on hand, receiving more than a
location's capacity or a PO's ordered quantity, confirming receipt of more than was delivered,
releasing more QC Hold than is recorded — all of it posts, and the resulting number (even negative,
even over 100% of capacity) is shown honestly rather than hidden. **Dispatch is the one deliberate
exception** (see above) — a real business requirement (you should not ship QC-held cement to a
customer), scoped narrowly to that one code path via `allowNegative: false`, called out with comments
at both ends so it doesn't read as an inconsistency. RBAC (who's allowed to do what) and the request/
dispatch lifecycles' state-machine guards (e.g. can't accept an already-rejected request, can't assign
before routing) are **not** part of this — those still apply everywhere. See `applyBalanceDelta` in
`src/lib/inventory/ledger.ts` for the single point where the default is enforced.

## Data model highlights

- `StockRequest` — the request record itself: quantities, status, from/to locations, and denormalized
  actor columns (`acceptedByUserId`, `routedToUserId`, `assignedToUserId`, `deliveredByUserId`, etc.)
  for fast display.
- `RequestEvent` — append-only audit trail / timeline source (includes `ROUTED`).
- `StockReservation` — soft lock backing the On Hand / Reserved / Available split.
- `Dispatch` / `DispatchEvent` — the customer-dispatch lifecycle and its audit trail, structurally
  parallel to `StockRequest`/`RequestEvent`.
- `InventoryTransaction` / `InventoryBalance` — the ledger and its materialized cache. Every ledger row
  stores a **positive magnitude**; direction is implied purely by which of `sourceLocationId` /
  `destinationLocationId` is populated — holds uniformly across every transaction type, which is what
  makes the Inventory Report's ledger reconstruction (see Reports) valid with no per-type branching.
- `QualityBalance` / `QualityStatusEvent` — QC Hold/Blocked quantities per (material, location) and
  their audit trail; mirrors the `InventoryTransaction`/`InventoryBalance` split for the same reason
  (materialized cache + append-only log).
- `PhysicalCount` — one row per count, linked to its posted `ADJUSTMENT` transaction (if any) via
  `adjustmentTransactionId`; null means still pending approval.
- `Supplier` / `PurchaseReference` / `MaterialReceipt` — the lightweight GRN subsystem, independent of
  `StockRequest`.
- `NotificationRule` / `Notification` / `MaterialAlertState` — the notification system's rules,
  persisted notifications, and per-material stock-status transition cache; `User` gained an optional
  `email` column (nullable — only needed for the Email channel).

## Seeded demo data (`prisma/seed.ts`)

Six users covering every role (Rahul/Priya = Indentor, Amit = Store Supervisor, Suresh = Store/
Delivery Operator, Neha = Inventory Manager, Admin). Twelve+ requests spanning every lifecycle status
(including a live NOT_RECEIVED exception, a live PARTIALLY_RECEIVED round, and one sitting in the
ROUTED-but-not-yet-assigned state), four Dispatches spanning CREATED/APPROVED/DISPATCHED/CANCELLED,
Quality Hold and Blocked examples across several materials plus a full hold-then-release cycle, a
posted physical-count adjustment and one left pending approval, six GRN receipts across six suppliers
(mixing posted and draft), roughly 18 days of realistic consumption history per material, default
Notification Rules covering the trigger library, and ~11 example Notifications so the bell/centre
isn't empty on first look. Opening balances are backdated ~25 days so the 14-day trend charts show a
real curve instead of a flat line with a cliff on day one.

```bash
npm install
npm run db:seed      # wipes + reseeds all demo data
npm run dev -- -p 3033
npm run test          # separate throwaway SQLite file, safe alongside the dev server; 103 tests
```

**Important:** if you reseed the database while `next dev` is already running, restart the dev server
— it holds an open SQLite connection to the previous database file.

## Deployment

The live deployment is a **separate checkout** managed by PM2 (not the workspace you edit in), pulling
from `main` on push. After any `prisma/schema.prisma` change, that checkout's database needs to be
brought up to date too — `npx prisma db push --accept-data-loss` (safe here since every schema change
so far has been additive) followed by `pm2 restart <app-name>` to pick up the regenerated Prisma
Client, which is cached in the running process's memory and won't update on its own. The deployed
database's actual *data* is separate from its schema — after a schema sync, also re-run
`npm run db:seed` there if the deployed demo data has drifted from what `prisma/seed.ts` currently
produces (new users, new example records, etc.) — a schema sync alone doesn't refresh seeded rows.

## Explicitly out of scope

Multi-site/network model, production/BOM/consumption-coefficient engine, packing, forecasting or
auto-reorder, full accounts-payable/invoice processing (invoice fields are reference-only), real
integrations (SAP/SCADA/weighbridge/sensors), full supplier management (a supplier is a name +
optional reference, created inline), real authentication (the cookie-based user switcher is a demo
convenience only), a real LLM/AI service (both "AI" features are deterministic — see above), a real
email provider (simulated/logged transport only), SMS/WhatsApp/push notifications, an automation
builder or arbitrary conditions in Notification Rules, cost/valuation (Reports' Valuation tab was
explicitly deferred and removed rather than shown with fabricated numbers).
