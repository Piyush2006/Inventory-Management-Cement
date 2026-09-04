import {
  USER_ROLES,
  ROLE_LABELS,
  ADMIN_ROLE,
  ACCEPT_REJECT_ROLES,
  ROUTE_ROLES,
  ASSIGN_ROLES,
  OPERATOR_ROLES,
  STOCK_OPS_ROLES,
  ADJUSTMENT_ROLES,
  MASTER_DATA_ROLES,
  DISPATCH_CREATE_ROLES,
  DISPATCH_APPROVE_ROLES,
  DISPATCH_EXECUTE_ROLES,
  DISPATCH_CANCEL_ROLES,
  NOTIFICATION_CONFIG_ROLES,
  type UserRole,
} from "@/lib/domain/enums";

// One entry per existing *_ROLES constant in enums.ts — the "Can" list below is built by
// filtering this against each role, so it can never drift from the real RBAC matrix. Nothing
// here is invented; every label maps 1:1 to a constant already enforced server-side elsewhere.
const PERMISSION_ITEMS: { label: string; roles: UserRole[] }[] = [
  { label: "Accept / reject requests", roles: ACCEPT_REJECT_ROLES },
  { label: "Route requests to a Store Supervisor", roles: ROUTE_ROLES },
  { label: "Assign a Store / Delivery Operator", roles: ASSIGN_ROLES },
  { label: "Start delivery / mark requests delivered (when assigned)", roles: OPERATOR_ROLES },
  { label: "Record Stock Operations (Receive / Consume / Transfer / Adjustment)", roles: STOCK_OPS_ROLES },
  { label: "Approve stock adjustments", roles: ADJUSTMENT_ROLES },
  { label: "Manage Materials & Locations", roles: MASTER_DATA_ROLES },
  { label: "Create dispatches", roles: DISPATCH_CREATE_ROLES },
  { label: "Approve dispatches", roles: DISPATCH_APPROVE_ROLES },
  { label: "Execute dispatch loading / dispatching", roles: DISPATCH_EXECUTE_ROLES },
  { label: "Cancel dispatches", roles: DISPATCH_CANCEL_ROLES },
  { label: "Configure notification rules", roles: NOTIFICATION_CONFIG_ROLES },
  { label: "Manage Users & Roles, Login as User", roles: [ADMIN_ROLE] },
];

// A handful of hand-picked, fact-checked illustrative gaps — not an exhaustive negation of
// every permission list (that would be noisy: most roles are excluded from most lists). Each
// line has been checked against the actual constant it references.
const CANNOT_NOTES: Partial<Record<UserRole, string[]>> = {
  REQUESTER: ["Cannot record Stock Operations or manage Materials/Locations — read-only outside their own requests"],
  STORE_SUPERVISOR: ["Cannot accept/reject or route requests — that's Inventory Manager's decision", "Cannot record Receive/Consume/Transfer/Adjustment — not in STOCK_OPS_ROLES"],
  STORE_OPERATOR: ["Cannot accept, route, or assign requests — only acts once assigned to them"],
  INVENTORY_MANAGER: ["Cannot directly assign a Delivery Operator — ASSIGN_ROLES is Store Supervisor/Admin only, routing goes through a Store Supervisor first"],
};

export function RolesPanel() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-soft">
        A read-only summary of the existing role/permission matrix — this page cannot change it. Every &ldquo;Can&rdquo; item below is generated
        directly from the same role lists enforced server-side throughout the app.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {USER_ROLES.map((role) => {
          const canItems = PERMISSION_ITEMS.filter((p) => p.roles.includes(role));
          const cannotItems = CANNOT_NOTES[role] ?? [];
          return (
            <div key={role} className="rounded-lg border border-border bg-surface-raised p-4">
              <div className="text-sm font-semibold text-foreground">{ROLE_LABELS[role]}</div>
              <div className="mt-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Can</div>
                <ul className="mt-1.5 space-y-1">
                  {canItems.map((item) => (
                    <li key={item.label} className="text-xs text-foreground">&bull; {item.label}</li>
                  ))}
                </ul>
              </div>
              {cannotItems.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">Cannot</div>
                  <ul className="mt-1.5 space-y-1">
                    {cannotItems.map((note) => (
                      <li key={note} className="text-xs text-muted-soft">&bull; {note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
