// Everything a hook site in src/app/actions.ts already has in scope after its lib call succeeds
// (scalar ids/values off the returned record) — no extra queries needed at the call site. Name
// resolution (material/location -> display name) happens lazily inside engine.ts, once per
// trigger call, only when at least one ENABLED rule for the event actually needs it.
export interface NotificationContext {
  recordId?: string; // StockRequest.id / Dispatch.id / Material.id this event is about
  materialId?: string; // when set, engine.ts fetches it once and derives {material} and its uom
  locationId?: string;
  quantity?: number;
  reference?: string; // requestNumber / dispatchReference, for display only
  link?: string; // concrete existing route, e.g. `/requests/${id}`
  currentStock?: number;
  minimumStock?: number;
  // FK ids for RELEVANT_USER recipient resolution — whichever apply to this event.
  requestedByUserId?: string;
  assignedToUserId?: string;
  routedToUserId?: string;
  createdByUserId?: string;
}
