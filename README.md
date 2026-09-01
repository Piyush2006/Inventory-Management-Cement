# Berrima Cement Plant — Inventory Management System (Demo v1)

A working, interactive **single-site** cement plant inventory management system built for a client
demo. Every action here creates a persistent record and updates inventory immediately — this is not
a static dashboard or a clickable mockup.

> Know what stock we have, where it is, how it moved, and whether action is needed.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **Prisma + SQLite** for the demo (swap `provider` to `postgresql` in `prisma/schema.prisma` for
  production — the app code is otherwise database-agnostic)
- **Tailwind CSS v4**, **Recharts**, **Vitest**

## Getting started

```bash
npm install
npm run db:seed      # wipes + reseeds ~45 days of plant history + demo scenarios
npm run dev           # http://localhost:3000 (or pass -p to change the port)
```

**Important:** if you reseed the database (`npm run db:seed`) while `next dev` is already running,
restart the dev server afterwards — it holds an open SQLite connection to the previous database file
and won't see the new data otherwise.

Run the test suite (uses its own throwaway SQLite file, safe to run alongside the dev server):

```bash
npm run test
```

## The 7 screens

| Screen | Route | What it does |
|---|---|---|
| Dashboard | `/` | KPI cards, exceptions, silo quick-view, inventory table, recent movements, 2 trend charts — the landing page |
| Inventory | `/inventory`, `/inventory/[materialId]` | What do we have, where — search/filter, drill into a material |
| Record Movement | `/movements` | Receive / Consume / Transfer / Dispatch, plus Physical Count and Adjustment |
| Ledger | `/ledger` | Filterable movement history — the source of truth |
| Production | `/production` | Record Raw Meal / Clinker / Cement production — auto-consumes configured recipe inputs |
| Stock Requests | `/requests` | Raise, edit, cancel, decline, and (partially) fulfil requests |
| Materials & Locations | `/master-data` | Add/edit/deactivate materials and locations — real CRUD |

Transfers are handled inside Record Movement rather than a separate screen, per spec.

### Procurement enhancement: Material Receipt / GRN

On top of the 7 screens, incoming material now flows through a proper receipt workflow rather than a
simple stock bump:

**Stock Request → Purchase/Source Reference (PO) → Material Receipt/GRN → Accepted Quantity → Inventory**

- `/receipts` — Purchase References + Receipt History (not in the sidebar by design — reachable via
  "+ Receive Material" on `/inventory`, and via "Receive Material (GRN)" as a third fulfilment method
  on `/requests`, per spec).
- `/receipts/new` — create a GRN against an existing PO or directly with no PO. Rejected quantity is
  always auto-derived (`received − accepted`), never hand-entered. Two submit actions: **Save as
  Draft** (never touches stock) and **Post GRN** (posts a RECEIPT for the *accepted* quantity only —
  never ordered or received — and, if linked, rolls the PO and Stock Request forward).
- `/receipts/[id]` — full GRN detail, with **Post** (for drafts) and **Cancel** (posts an audited
  reversal ADJUSTMENT rather than deleting history) actions.
- Suppliers are intentionally minimal (`src/lib/inventory/procurement.ts` → `resolveSupplier`) — pick
  an existing one or type a new name inline; no separate supplier management screen.

See `tests/procurement.test.ts` for the invariants this enforces (accepted-only stock increase,
draft-never-touches-stock, partial receipts rolling PO status forward, over-receipt guard,
cancel-reverses-not-deletes).

## How the ledger works

`Stock = receipts + production + transfers in − consumption − transfers out − dispatch ± adjustments`

Every stock change is a row in `InventoryTransaction`; `InventoryBalance` is a materialized cache kept
in sync on every write. Stock is **never** edited directly — corrections always go through
`postAdjustment` with a mandatory reason, and historical rows are never mutated. See
`src/lib/inventory/ledger.ts`.

Production posting (`src/lib/inventory/production.ts`) reads `ConsumptionCoefficient` rows to
automatically post the matching CONSUMPTION movements for its inputs — e.g. producing Clinker
consumes Raw Meal + Coal + Alternative Fuel from their configured default locations. Recipes are
configurable demo data, not hard-coded.

Packing (bulk → bagged cement) is the same material moved to the Bagged Warehouse; bag count is
always derived from `tonnage / bagWeightKg` at read time rather than stored, so it can never drift
from tonnage.

### Seeded demo scenarios (`prisma/seed.ts`)

- **Low coal condition**: Coal below minimum stock (LOW status).
- **One critical material**: Alternative Fuel below safety stock (CRITICAL status).
- **One physical stock adjustment**: a Limestone Stockpile A survey (38,800 MT vs 40,000 MT book,
  −3.0%) recorded and pending an adjustment on `/movements`.
- **Stock requests** spanning the full lifecycle: partially fulfilled, fully fulfilled, declined
  (with reason), and one still open and urgent.
- **Procurement/GRN scenario**: Stock Request for 2,500 MT Gypsum → PO-xxxx (ABC Minerals) → GRN
  received 2,000 MT, accepted 1,980 MT / rejected 20 MT, invoice INV-4587, posted — inventory +1,980
  MT, PO and the linked Stock Request both roll to PARTIALLY_RECEIVED/PARTIALLY_FULFILLED. Plus a
  direct no-PO coal receipt, and one DRAFT receipt left unposted to show drafts don't touch stock.
- ~45 days of daily receipts / production / consumption / transfers / packing / dispatch history for
  realistic trend charts.

### The 3-minute demo script

1. Add **Silica Sand** as a new material (`/master-data`).
2. Receive 2,000 MT (`/movements`).
3. Consume 200 MT (`/movements`).
4. Raise a stock request for 1,000 MT (`/requests`).
5. Fulfil the request.
6. Open the Ledger and show every movement.
7. Return to the Dashboard and show all values changed automatically.

## Known scope (per spec — not gaps)

No multi-site/network model, no forecasting or auto-reorder, no full accounts-payable/invoice
processing or payment tracking (invoice fields are reference-only), no real integrations
(SAP/SCADA/weighbridge/sensors), no complex RBAC or approval chains, no full supplier management
module (suppliers are a name + optional reference, created inline) — all explicitly out of scope.
Days-of-cover is a single informational number (30-day trailing consumption average), not a full
planning engine.
