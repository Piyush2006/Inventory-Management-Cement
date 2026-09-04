"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { ViewIcon } from "@/components/ui";
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

// One entry per existing *_ROLES constant in enums.ts, grouped for display only — the checked
// state below is built by filtering this against each role, so it can never drift from the real
// RBAC matrix. Nothing here is invented: every item maps 1:1 to a constant already enforced
// server-side elsewhere, and there is no save path — these checkboxes are inspection, not editing.
type PermissionItem = { label: string; roles: UserRole[] };
const PERMISSION_GROUPS: { group: string; items: PermissionItem[] }[] = [
  {
    group: "Requests",
    items: [
      { label: "Accept / Reject Requests", roles: ACCEPT_REJECT_ROLES },
      { label: "Route Requests to a Store Supervisor", roles: ROUTE_ROLES },
      { label: "Assign a Store / Delivery Operator", roles: ASSIGN_ROLES },
      { label: "Start Delivery / Mark Delivered (when assigned)", roles: OPERATOR_ROLES },
    ],
  },
  {
    group: "Stock Operations",
    items: [
      { label: "Record Stock Operations (Receive / Consume / Transfer / Adjustment)", roles: STOCK_OPS_ROLES },
      { label: "Approve Stock Adjustments", roles: ADJUSTMENT_ROLES },
    ],
  },
  {
    group: "Master Data",
    items: [{ label: "Manage Materials & Locations", roles: MASTER_DATA_ROLES }],
  },
  {
    group: "Dispatch",
    items: [
      { label: "Create Dispatches", roles: DISPATCH_CREATE_ROLES },
      { label: "Approve Dispatches", roles: DISPATCH_APPROVE_ROLES },
      { label: "Execute Dispatch Loading / Dispatching", roles: DISPATCH_EXECUTE_ROLES },
      { label: "Cancel Dispatches", roles: DISPATCH_CANCEL_ROLES },
    ],
  },
  {
    group: "Administration",
    items: [
      { label: "Configure Notification Rules", roles: NOTIFICATION_CONFIG_ROLES },
      { label: "Manage Users & Roles / Login as User", roles: [ADMIN_ROLE] },
    ],
  },
];
const TOTAL_PERMISSIONS = PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0);

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PermissionGroupSection({
  group,
  items,
  role,
  open,
  onToggle,
  filter,
}: {
  group: string;
  items: PermissionItem[];
  role: UserRole;
  open: boolean;
  onToggle: () => void;
  filter: string;
}) {
  const checkedCount = items.filter((i) => i.roles.includes(role)).length;
  const visibleItems = items.filter((i) => i.label.toLowerCase().includes(filter.toLowerCase()));
  if (filter && visibleItems.length === 0) return null;

  return (
    <div className="rounded-md border border-border-soft">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-raised">
        <span className="text-sm font-medium text-foreground">{group}</span>
        <span className="flex items-center gap-2 text-xs text-muted-soft">
          {checkedCount}/{items.length}
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-2 border-t border-border-soft p-3 sm:grid-cols-2">
          {visibleItems.map((item) => (
            <label key={item.label} className="flex items-start gap-2 text-xs text-foreground">
              <input type="checkbox" checked={item.roles.includes(role)} disabled className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border disabled:opacity-100" />
              {item.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function RolePermissionsModal({ role, onClose }: { role: UserRole | null; onClose: () => void }) {
  const [filter, setFilter] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(PERMISSION_GROUPS.map((g) => g.group)));

  if (!role) return null;
  const checkedTotal = PERMISSION_GROUPS.reduce((n, g) => n + g.items.filter((i) => i.roles.includes(role)).length, 0);

  function toggleGroup(group: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <Modal open={role != null} onClose={onClose} title={`${ROLE_LABELS[role]} — Permissions`}>
      <div className="space-y-3">
        <p className="text-xs text-muted-soft">
          Read-only view of what this role can already do, generated from the same role lists enforced server-side throughout the app. There is no save
          action here — changing which roles can do what requires changing the code, not this page.
        </p>
        <div className="flex items-center justify-between gap-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search permissions…"
            className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent"
          />
          <span className="shrink-0 text-xs text-muted-soft">{checkedTotal} of {TOTAL_PERMISSIONS} selected</span>
        </div>
        <div className="space-y-2">
          {PERMISSION_GROUPS.map((g) => (
            <PermissionGroupSection
              key={g.group}
              group={g.group}
              items={g.items}
              role={role}
              open={openGroups.has(g.group)}
              onToggle={() => toggleGroup(g.group)}
              filter={filter}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function RolesPanel() {
  const [search, setSearch] = useState("");
  const [viewingRole, setViewingRole] = useState<UserRole | null>(null);

  const visibleRoles = useMemo(
    () => USER_ROLES.filter((r) => ROLE_LABELS[r].toLowerCase().includes(search.toLowerCase())),
    [search],
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-soft">
        The existing 5 roles and their real permissions — this is a representation of the current RBAC, not an editor. Select a role to see its full
        permission breakdown.
      </p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by role name…"
        className="w-64 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
      />
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Role</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Permissions</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRoles.map((role) => {
              const count = PERMISSION_GROUPS.reduce((n, g) => n + g.items.filter((i) => i.roles.includes(role)).length, 0);
              return (
                <tr key={role} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                  <td className="px-3 py-2.5 text-sm text-foreground">{ROLE_LABELS[role]}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{count} of {TOTAL_PERMISSIONS}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => setViewingRole(role)}
                      title="View permissions"
                      aria-label={`View permissions for ${ROLE_LABELS[role]}`}
                      className="rounded p-1.5 text-muted hover:bg-surface-raised hover:text-accent"
                    >
                      <ViewIcon />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <RolePermissionsModal role={viewingRole} onClose={() => setViewingRole(null)} />
    </div>
  );
}
