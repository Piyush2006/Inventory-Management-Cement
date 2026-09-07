# Boral Cement Plant — Inventory Management System

A working, single-site cement plant inventory management system. Every action creates a persisted
record and updates inventory immediately — there is no mock data layer and no static dashboard.
"Boral" is a placeholder company name only (no real affiliation) — the sidebar logo is an original
mark, not any real company's trademark.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **Prisma + SQLite** (swap the `provider` in `prisma/schema.prisma` to `postgresql` for production —
  the app code is otherwise database-agnostic)
- **Tailwind CSS v4**, **Recharts**, **Vitest**, **date-fns**
- Cookie-backed "current user" switcher (no real login) — every privileged action still re-derives the
  user server-side and checks their role independently, not just via hidden UI buttons. Switching user
  ("Login as User") is itself Admin-only and enforced server-side, from `/users`.
- Full light/dark theming via CSS custom properties (`src/app/globals.css`) — every color in the app
  goes through this token system, including a dedicated `--stage-*` categorical palette (11 distinct
  hues) for the Lifecycle Gantt chart, separate from the `--status-*` semantic tokens
- A shared `.btn` class system (`globals.css`) and a shared `Modal` component
  (`src/components/modal.tsx`) — every "+Add/+New" form in the app opens as a popup rather than
  expanding inline, and every button shares one hover/disabled/press style instead of ad-hoc classes
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
| Transfer & Issue (requests) | `/requests`, `/requests/[id]` | Everyone |
| Stock Operations | `/movements` | Everyone except Indentor (recording requires Store Operator / Inventory Manager; Store Supervisor reaches Dispatch + the Adjustment tab's physical-count step only) |
| Dispatch detail | `/movements/dispatches/[id]` | Everyone except Indentor |
| Reports (+ Schedules) | `/reports` | Everyone (Request tab scoped to the viewer's own requests for Indentor/Store Operator; Schedules tab requires Inventory Manager/Admin) |
| Notifications | `/notifications` | Everyone (Rules tab requires Inventory Manager/Admin) |
| Users & Roles | `/users` | Admin only |
| Ledger | `/ledger` | Everyone |
| Receipts (GRN) | `/receipts/new`, `/receipts/[id]` | Everyone except Indentor |

An **Indentor**'s only write surface is Transfer & Issue (raise a request, view own, confirm/
not-received, report a Spare Return against their own spare issue) — but they have full *read* access
everywhere else (Dashboard, Inventory, Locations, Materials, Reports, Ledger), same as every other
non-write-privileged role. Only the genuinely write-heavy screens — Stock Operations, GRN receiving,
the Dispatch detail page, Users & Roles — stay redirected server-side for this role, not just hidden
from the sidebar. The sidebar itself is collapsible (icon-only rail by default, expands on hover or a
pinned toggle).

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Indentor** (internal role key: `REQUESTER`) | Create a request, view their own, confirm receipt or report not-received, report a Spare Return against their own spare issue; full read access to Dashboard/Inventory/Locations/Materials/Reports/Ledger, including Bruce AI | Accept/reject, route, assign, start delivery, mark delivered, touch inventory directly, complete a Spare Return, reach Stock Operations/GRN/Dispatch/Users & Roles |
| **Store Supervisor** | Assign a Delivery Operator — but only for a request **routed to them specifically**; create/approve/manage-loading/cancel a Dispatch; record/review a physical count on the Adjustment tab (view pending counts, can't approve/reject/post); view-only on Spare Return | Accept/reject, route a request, record Receive Material, approve/reject/post an adjustment, complete a Spare Return |
| **Store/Delivery Operator** | Start delivery and mark delivered for requests assigned to them; record Receive Material; record a physical count; complete a reported Spare Return (the only role besides Admin that can); start loading/mark dispatched for a Dispatch assigned to them | Accept/reject, route, assign, confirm receipt, approve/create/cancel a Dispatch, approve/reject/post an adjustment |
| **Inventory Manager** | Accept/reject new requests, route to a Store Supervisor, manage Materials & Locations, approve/reject a pending physical-count adjustment, approve/create/cancel a Dispatch, configure Notification Rules & Report Schedules, everything Store Operator can do **except** completing a Spare Return (view-only there, by design) | Assign a Delivery Operator directly (must route to a Supervisor first), complete a Spare Return |
| **Admin** | Everything, unconditionally, incl. editing any user and "Login as User" from `/users` | — |

No single non-Admin role can carry a request through its entire lifecycle alone — enforced in the
backend (`src/lib/auth.ts` `requireRole`, plus per-row ownership checks), not just by hiding buttons.
The full role→action matrix lives in `src/lib/domain/enums.ts` (`ACCEPT_REJECT_ROLES`, `ROUTE_ROLES`,
`ASSIGN_ROLES`, `OPERATOR_ROLES`, `STOCK_OPS_ROLES`, `PHYSICAL_COUNT_ROLES`, `ADJUSTMENT_ROLES`,
`SPARE_RETURN_REPORT_ROLES`, `SPARE_RETURN_COMPLETE_ROLES`, `SPARE_RETURN_VIEW_ROLES`,
`MASTER_DATA_ROLES`, `DISPATCH_*_ROLES`, `NOTIFICATION_CONFIG_ROLES`). `/users` (Roles tab) renders a
read-only, mechanically-generated view of this same matrix — never hand-authored prose that could
drift from it.

## The Transfer & Issue (request) lifecycle

```
NEW_REQUEST → ACCEPTED → (routed to a Store Supervisor) → ASSIGNED → IN_TRANSIT → DELIVERED → COMPLETED
NEW_REQUEST → REJECTED (reason required)
DELIVERED → NOT_RECEIVED (reason required) → re-assign → ASSIGNED → ... → DELIVERED → ...
DELIVERED → PARTIALLY_RECEIVED (partial confirm) → re-assign → ASSIGNED → ... → COMPLETED
```

Two-hop assignment chain (Inventory Manager routes → that specific Store Supervisor assigns an
operator), checked against `StockRequest.routedToUserId`, not just role membership. Routing persists
across re-assignment rounds unless explicitly re-routed. The same Request ID stays attached through
every round — a partial receipt or not-received exception never spins up a new request.

The Request Detail page (`/requests/[id]`) shows Request Information, People, Quantities, a
**Lifecycle Gantt chart**, a Spare Return panel (Indentor-only, when applicable — see below), and
every related stock movement — one page, no digging across screens.

**Lifecycle Gantt** (`src/components/charts/lifecycle-gantt.tsx`) — built from the exact same
`RequestEvent` log the old plain-text Timeline used (which it replaced): expanded view is one
horizontal bar per stage on a real calendar-time axis, each stage its own distinct color
(`--stage-*` tokens); collapsed view condenses the same data into a single segmented bar with a
color-swatch legend, each segment individually hoverable for the same detail (who, when, quantity,
reason) via Recharts' per-segment tooltip trick. Handles a re-assignment loop by de-duplicating
repeated stage labels ("Assigned (2)") rather than merging them, and renders an "in progress" (dashed)
style for a stage that hasn't resolved yet — including `NOT_RECEIVED`/`PARTIALLY_RECEIVED`, which can
still loop back through re-assignment and so are never treated as terminal.

The Transfer & Issue list (`/requests`) is tabbed (Open / History), a **+ New Request** button opens
the create form in a popup, and every row has an eye-icon link to its detail page plus an **Export
CSV** button that respects the same per-role row scoping the list itself uses.

## Dispatch

A second, independent lifecycle alongside Transfer & Issue — finished-goods material leaving the
plant for a customer. Lives inside Stock Operations (`/movements`, Dispatch tab) and its own detail
page (`/movements/dispatches/[id]`).

```
CREATED → APPROVED → LOADING → DISPATCHED
CREATED / APPROVED / LOADING → CANCELLED (reason required; never once DISPATCHED)
```

Inventory only decreases once, at `markDispatched`, via `postMovement({ transactionType: "DISPATCH",
allowNegative: false })` — the one deliberate exception to this app's otherwise fully permissive
stock-quantity policy (see below). `DispatchEvent` mirrors `RequestEvent` as its audit trail.

## Quality Hold / Release

Stock at a location can be **Unrestricted**, **QC Hold**, or **Blocked** — Unrestricted is always
derived as `On Hand − QC Hold − Blocked` (`getUnrestrictedAvailable`, `src/lib/inventory/quality.ts`),
never its own stored row. An Inventory Manager or Admin can Release/Hold/Block from the Material
Detail page's Quality panel, with a mandatory reason and a full audit trail (`QualityStatusEvent`).
Days of Supply, the Dashboard's HEALTHY/CRITICAL classification, the Inventory list, Reports, and
Bruce AI all read Unrestricted stock, never raw On Hand.

## Adjustment (physical count / reconciliation)

Record what you physically count against a location; the system shows book stock and the variance
automatically (tolerance band on `Material.tolerancePct`, default ±3%). **Store Operator or Store
Supervisor** can record a count and submit a discrepancy for review; only **Inventory Manager/Admin**
can act on it — either **approve & post** (via the existing ledgered `postAdjustment`, never a direct
edit) or **reject** it (ends the workflow, marks `PhysicalCount.rejectedAt`/`rejectionReason`, posts
nothing — Stock Rule: only an *approved* variance ever changes inventory). Pending counts sit in the
"Pending Physical Counts" panel (`/movements`, Adjustment tab), visible read-only to whoever can
record one, with Approve/Reject controls shown only to whoever can act.

## Spare Return

A two-stage workflow (`src/lib/inventory/spareReturn.ts`) for a spare returned against a previously
issued spare request — deliberately not a single step, so a Requester can hand something back without
needing Stock Operations access:

1. **Report** (`reportSpareReturn`) — the Indentor who raised the original spare issue (from that
   request's own detail page — Indentors never reach `/movements`), or a Store Operator/Admin on a
   walk-in fast path, declares a return. No inventory effect yet; the record sits at `status:
   "REPORTED"`.
2. **Complete** (`completeSpareReturn`) — only a **Store Operator or Admin** (Inventory Manager and
   Store Supervisor are view-only here, by explicit design) picks the receiving location and records
   the verified condition. This is the only step that posts to the ledger: a stock-in (`RECEIPT`),
   then the existing quality mechanism if the condition isn't immediately usable
   (`FOR_INSPECTION`→QC Hold, `DAMAGED`→Blocked) — on-hand always increases, only *usable* stock is
   gated by condition. No separate approval level sits on top of a normal completion.

`getIssuedRemainingForRequest` sums **every** SpareReturn against a request regardless of status, so a
reported-but-not-yet-completed return already counts against what's still eligible — the same physical
item can't be reported twice before the Store processes the first report. `postSpareReturn` remains as
a convenience wrapper (report + complete in one call) for the Store Operator's walk-in fast path.

## Consumption History + Days of Supply

The Material Detail page shows a 30-day consumption log, a 30-day total, and **Days of Supply** =
Unrestricted stock ÷ average daily consumption (never divides by zero — shows N/A instead,
`src/lib/inventory/daysOfSupply.ts`, renamed from "Days of Cover" — same calculation, new name
everywhere including Bruce AI). Reused directly by the AI Insights engine and Bruce AI rather than
re-implemented. "Recent Movements" on this page excludes `CONSUMPTION` rows so it never duplicates the
Consumption History table above it.

## Dashboard

Every number traces to a live query — no dashboard-only calculation, no hardcoded figures. Went
through several iterations this project (an interim "Your Actions" role-scoped queue + AI Insights
panel, then a pasted reference image the user asked to match exactly, then further simplification
per direct feedback). Current shipped layout:

1. **KPI strip** — 4 colored icon-badge cards: **Critical Stock** (`classifyStockStatus`, never from
   silo fill %; sublabel "Below minimum stock" — matches the real `minStock` field name used
   everywhere else, not invented "safe level" phrasing), **Open Requests** (`OPEN_REQUEST_STATUSES`
   count), **In Transit** (MT balance at the virtual in-transit location), **Dispatched Today** (MT
   total of today's `Dispatch` rows with `status: DISPATCHED` — actually left the plant, not just
   approved/loading).
2. **Inventory Movement** (`src/components/dashboard/material-flow-chart.tsx`) — a single combined
   panel replacing the old separate Inventory/Consumption trend charts, and the most-iterated piece
   of this whole redesign (went through a hover-tooltip version, an always-visible-day-card version,
   a 4/5-stage zigzag, a grouped-bar version, and settled on this one after the user's own suggestion
   to try a step chart). One material's flow renders as a single continuous stepped line+area
   (Recharts `type="stepAfter"`, not diagonal slopes — flat plateaus with sharp vertical jumps), built
   by flattening the day-by-day series into one walk (opening → a point per non-zero
   Received/Consumed/Dispatched/Transferred/Adjusted category, in that fixed order → closing, where
   each day's closing point IS the next day's opening point) so the whole window is one unbroken path;
   a day with zero movement still gets a flat neutral-colored connector so there's never a visual gap.
   Blue boundary markers (drawn via the `dot` render-prop, not `label` — proven far more reliable for
   sparse multi-segment Lines) tag every day transition "Opening"/"Closing"/both. Hovering any point
   shows a custom tooltip with that day's full Opening/Received/Consumed/Dispatched/Transferred/
   Adjusted/Closing breakdown, looked up by x-position rather than Recharts' own per-series payload —
   no always-visible day-card row or summary-tile row below the chart (both tried, then explicitly
   removed). Fully configurable date range via two native `<input type="date">` pickers (not a fixed
   7/14/30-day dropdown) syncing `?from=`/`?to=` query params; `getDashboardData(startDate?, endDate?)`
   always walks backward from *today's* real current stock through the full requested lookback
   (capped at 366 days) then slices to the requested window, floored at 0 (on-hand stock is never
   negative, however far back a custom range reaches). The material dropdown is sorted by a
   "heartbeat score" (days with a genuine up-then-down movement, not just raw volume) so richly-
   populated materials sort to the top and thin/spare-part materials sink to the bottom. All of it
   comes from `InventoryTransaction` rows, categorized purely by the ledger's existing signed
   convention (RECEIPT/TRANSFER_IN/OPENING_BALANCE inward; CONSUMPTION/DISPATCH/TRANSFER_OUT outward;
   ADJUSTMENT signed by which side is set); the same-material, same-plant `TRANSFER` type is
   deliberately excluded since it nets to zero for total on-hand. Dispatch only ever appears for
   genuine finished/packaged goods (Cement GP/GB/HE, 20kg Cement Bag) — raw materials/fuel/additives/
   intermediates only show Received/Consumed, matching real plant operations.
3. **Silo Quick View** (`src/components/dashboard/silo-quick-view.tsx`) — strictly the cement silos
   (`Location.type === "SILO"`, which in this plant's data is exactly the 3 cement silos — filtered on
   the type field, not hardcoded names), each rendered as a drawn silo vessel (cylinder + hopper +
   legs) plus a horizontal progress bar, both always green. Fill percentage is a physical/book reading
   only — it never feeds `classifyStockStatus` or renders a HEALTHY/CRITICAL badge; an 18%-full silo
   is not "critical" just because it's a small number.
4. **Needs Attention** / **Request Status** — two panels side by side. Needs Attention lists CRITICAL
   materials (top 5, "View all →" to `/inventory?status=CRITICAL`). Request Status is a horizontal
   bar graph (one bar per open `StockRequest` status, colored per status, length proportional to
   count) — a third panel duplicating this as a table ("Stock Requiring Attention") was removed once
   the user pointed out the overlap.

No Inventory table or Recent Movements panel on the Dashboard — both were tried and then explicitly
removed ("Inventory and Movement is not needed in dashboard"); `/inventory` and `/ledger` remain the
one source for each.

The right rail is the **Bruce AI** chat panel alone (`src/components/bruce-chat.tsx`) — unchanged
logic/intent-matching/RBAC throughout this whole redesign. An earlier iteration added a separate
role-scoped "Your Actions" queue (`src/lib/inventory/actionQueue.ts`) and an "AI Inventory Insights"
panel reusing `getInventoryInsights()`; both were removed once the user asked to match the reference
image exactly instead — `getInventoryInsights()` itself is untouched and still backs Bruce AI's own
"what needs attention" chat answers (`src/lib/bruce/intents.ts`).

`getInventoryInsights()` (`src/lib/inventory/insights.ts`) is deterministic risk scoring + templated
explanation — four insight types in priority order: **High Inventory Risk**, **Usable Stock Risk**
(QC Hold/Blocked reducing usable stock), **Medium Risk** (low Days of Supply, no safety-stock
threshold to compare to), **Unusual Consumption**.

## Bruce AI — Inventory Copilot

A conversational panel on the Dashboard answering natural-language inventory questions via
**deterministic intent-matching**, not a real LLM call — keyword/entity matching maps a question to
one of ~20 handlers calling straight into existing calculation functions (`getInventoryInsights`,
`computeDaysOfSupply`, `getTotalUnrestrictedAvailable`, the Reports module — `src/lib/bruce/`). The
Days-of-Supply intent still recognizes the older "days of cover" phrasing too, even though the app
itself only ever displays "Days of Supply" now. RBAC-aware; never writes anything; a failure resolves
to "Bruce AI is temporarily unavailable" rather than breaking the Dashboard.

## Reports

`/reports` — five read-only tabs reusing existing data, no second reporting source
(`src/lib/reports/`): **Inventory** (Opening/Received/Consumed/Transfer In-Out/Dispatched/Adjustments/
Closing, reconstructed live from the ledger), **Consumption**, **Stock Movement** (paged, with a
separate unpaginated query backing CSV export), **Request** and **Dispatch** (each scoped to the
viewer's own records for Store Operator/Indentor). Common filter bar (only the fields relevant to the
active tab — the Request Type filter (Material/Spare) is intentionally separate from Materials' own
7-way Category filter, never merged) and CSV export throughout.

A sixth tab, **Schedules** (Inventory Manager/Admin only) — `ReportSchedule`/`ReportScheduleRun`
models — lets someone define an intended cadence (report type, Daily/Weekly/Monthly, time of day,
Role or Specific User recipient) and hit **Run Now** to send an on-demand delivery through the same
simulated-email transport Notifications uses. Frequency/day/time describe intent only; nothing fires
on a timer by itself.

## Notification & Alert Management

A header bell (unread badge + dropdown) and `/notifications` (All/Unread feed + a Rules tab gated to
Inventory Manager/Admin) — sits on top of existing workflows via hooks in `src/app/actions.ts` only,
never inside the domain logic modules themselves (`src/lib/notifications/`). Recipients (Role /
Specific User / "Relevant User"), Channel (In-App / Email / Both), Status (Enabled/Disabled), templated
Title/Message. Email is a simulated transport (logged, marked Sent). Stock Low/Critical fires only on
a *worsening* transition (`MaterialAlertState`). Disabling a rule only stops notifications from it —
never the underlying business workflow.

## Stock Operations

`/movements` — tabbed: **Receive Material** (GRN workflow below), **Adjustment**, **Dispatch**,
**Spare Return** — each tab shows only its own history. Manual Consume/Transfer entry (a standalone
form unrelated to any request) was **removed**; stock now only moves via Receive, Adjustment,
Dispatch, Spare Return, or the Transfer & Issue request lifecycle itself, which already posts the
equivalent `CONSUMPTION`/`TRANSFER` ledger entries internally. Every recording action still posts a
row to `InventoryTransaction`; `InventoryBalance` is a materialized cache kept in sync on every write.
Stock is never edited directly — corrections always go through `postAdjustment` with a mandatory
reason.

### Receive Material (GRN)

**Supplier → Purchase/Source Reference (optional) → Material Receipt/GRN → Accepted Quantity + Quality Status → Inventory**

- Inventory increases by the **accepted** quantity only — never ordered or received.
- Two submit actions: **Save as Draft** (never touches stock) and **Post GRN**.
- Cancelling a posted receipt reverses it with an audited `ADJUSTMENT`, never deletes the original.
- Intentionally separate from the Transfer & Issue lifecycle — this is material entering the plant
  from outside, not moving between internal locations. **Unchanged** by any of the work above.

## Stock-quantity validation — permissive everywhere except Dispatch, by explicit design

No action in this app is ever blocked because of insufficient stock, a location's nominal capacity, or
a purchase order's ordered quantity — the resulting number (even negative, even over capacity) posts
and is shown honestly. **Dispatch is the one deliberate exception** (`allowNegative: false` at
`markDispatched` only — see `applyBalanceDelta` in `src/lib/inventory/ledger.ts`). RBAC and the
lifecycle state-machine guards are **not** part of this relaxed policy — those still apply everywhere.

## Data model highlights

- `StockRequest` / `RequestEvent` — the request record and its append-only audit trail/timeline
  source (feeds both the Lifecycle Gantt and — historically — the plain-text Timeline it replaced).
- `StockReservation` — soft lock backing On Hand / Reserved / Available.
- `Dispatch` / `DispatchEvent` — the customer-dispatch lifecycle, structurally parallel to
  `StockRequest`/`RequestEvent`.
- `InventoryTransaction` / `InventoryBalance` — the ledger and its materialized cache; every row
  stores a **positive magnitude**, direction implied by which of `sourceLocationId`/
  `destinationLocationId` is populated.
- `QualityBalance` / `QualityStatusEvent` — QC Hold/Blocked quantities and their audit trail.
- `PhysicalCount` — one row per count; `adjustmentTransactionId` set once approved & posted,
  `rejectedAt`/`rejectionReason` set once rejected — mutually exclusive, a count is pending, posted,
  or rejected, never more than one of those.
- `SpareReturn` — `status` (`REPORTED`/`COMPLETED`), `reportedByUserId` (nullable — who reported it)
  vs `processedByUserId` (nullable — who completed it), `locationId`/`condition`/
  `inventoryTransactionId` all nullable until completed.
- `Supplier` / `PurchaseReference` / `MaterialReceipt` — the lightweight GRN subsystem.
- `NotificationRule` / `Notification` / `MaterialAlertState` — notification rules, persisted
  notifications, per-material stock-status transition cache.
- `ReportSchedule` / `ReportScheduleRun` — Report Scheduling's intended-cadence definitions and a row
  per "Run Now" click.
- `User.email` — optional, only needed for the Email notification/report-schedule channel; all six
  seeded demo users now have one (`@boralcement.com`).

## Seeded demo data (`prisma/seed.ts`)

Six users covering every role (Rahul/Priya = Indentor, Amit = Store Supervisor, Suresh = Store/
Delivery Operator, Neha = Inventory Manager, John = Admin), each with an email. Requests spanning
every lifecycle status, including a live NOT_RECEIVED and PARTIALLY_RECEIVED round, one sitting
ROUTED-but-unassigned, and four fully-`COMPLETED` requests deliberately **backdated to realistic
1-2 day spans** (`backdateLifecycle` helper in `seed.ts`) — quick admin approvals near the start, most
of the elapsed time in the actual transit gap, quick receipt after — so the Lifecycle Gantt chart has
real multi-day data to show instead of every stage landing within milliseconds of each other. Five
Dispatches spanning every status including `LOADING`. Two physical counts left pending (one to
approve, one to reject demo-able side by side) plus one already-posted example. A reported-but-not-
completed Spare Return alongside a completed `DAMAGED` one on the same request (a partial-return-over-
multiple-visits story). Quality Hold/Blocked examples, GRN receipts across six suppliers, default
Notification Rules, and example Notifications.

**Daily movement heartbeat** — every raw material/fuel/additive/intermediate/finished-good material
(13 in total; excludes spares and the two catalog-only materials with no location, Raw Meal/Shale)
gets a real Receipt+Consumption(+Dispatch, finished goods only) transaction *every single day* from
just after its `OPENING_BALANCE` timestamp through today, sized as a fixed fraction of a target
balance (never re-read from a draining live balance mid-generation — an earlier version that did
compounded into near-zero/negative balances across a 32-day window, since fixed). Dispatch only ever
applies to genuine finished/packaged goods (Cement GP/GB/HE, 20kg Cement Bag) — raw materials don't
get dispatched to a customer. ~30 of the Issue-purpose Consumption entries are additionally backed by
real `StockRequest` records run through the actual request lifecycle (not raw ledger inserts), so
Consumption is traceable from both the Dashboard chart and the Requests page. Every synthetic
RECEIPT/DISPATCH transaction has a matching `MaterialReceipt`/`Dispatch` entity row (linked via
`inventoryTransactionId`) — the Movements page's Receive/Dispatch tabs read those entity tables, not
the raw ledger, so a transaction without one would be invisible there despite showing on the Dashboard
chart (a real bug caught mid-session and fixed with a backfill). The Receive Material tab's row cap
was removed (previously hard-capped at 15, silently hiding all but the newest ~1 day of GRNs) and
given the same status/material/supplier/date filter UI the Dispatch tab already had; Request History's
cap was raised 30 → 100 for the same reason.

```bash
npm install
npm run db:seed      # wipes + reseeds all demo data
npm run dev -- -p 3033
npm run test          # separate throwaway SQLite file, safe alongside the dev server; 128 tests
```

**Important:** if you reseed the database while `next dev` is already running, restart the dev server
— it holds an open SQLite connection to the previous database file.

## Deployment

The public URL is **`https://ims-cement.iocompute.ai`**, served by nginx
(`/etc/nginx/sites-enabled/ims-cement.iocompute.ai.conf`) reverse-proxying straight to
`localhost:3033` — which is a plain `next dev` process run **directly in this same workspace
checkout** (not a separate clone, not a production build, not PM2-managed). There is no
build-and-deploy step for this URL to go live: it reflects whatever is on disk here the moment the dev
server is (re)started. **Any code change requires manually restarting that dev server** (kill
whatever's on port 3033, `setsid nohup npx next dev -p 3033 > /tmp/nextdev.log 2>&1 < /dev/null &
disown`) for the public URL to pick it up.

Note: `pm2 list` on this host also shows an unrelated process literally named
`6e28f9ee-4b52-40c6-97e6-e76ba571b0d9` running `npm start` from a **separate** checkout
(`/home/ubuntu/apps/aistudiomanager/backend/repos/...`) on port 9004 — that port is not referenced by
any nginx config and is not what the public URL serves. Treat it as an unrelated platform-level
artifact, not this app's deployment, unless proven otherwise.

## Explicitly out of scope

Multi-site/network model, production/BOM/consumption-coefficient engine, packing, forecasting or
auto-reorder, full accounts-payable/invoice processing, real integrations (SAP/SCADA/weighbridge/
sensors), full supplier management, real authentication, a real LLM/AI service, a real email provider,
SMS/WhatsApp/push notifications, an automation builder or arbitrary conditions in Notification Rules,
cost/valuation, an automatically-firing report schedule (Report Scheduling is intent + manual "Run
Now" only).
