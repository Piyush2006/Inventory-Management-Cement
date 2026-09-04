"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionUpdateUser, actionLoginAsUser } from "@/app/actions";
import { USER_ROLES, ROLE_LABELS, type UserRole } from "@/lib/domain/enums";
import { EditIcon } from "@/components/ui";

type User = { id: string; name: string; role: string; email: string | null; active: boolean };

const inputClass = "mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent";

function UserFields({ user }: { user?: User }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="text-xs text-muted">
        Name
        <input name="name" defaultValue={user?.name} required className={inputClass} />
      </label>
      <label className="text-xs text-muted">
        Role
        <select name="role" defaultValue={user?.role ?? USER_ROLES[0]} required className={inputClass}>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        Email
        <input name="email" type="email" defaultValue={user?.email ?? ""} placeholder="optional" className={inputClass} />
      </label>
    </div>
  );
}

export function UsersManager({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loggingInAsId, setLoggingInAsId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const visibleUsers = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (search && !u.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [users, search, roleFilter]);

  function submitEdit(fd: FormData, onDone: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await actionUpdateUser(fd);
      if (!res.ok) setError(res.error ?? "Failed to save");
      else onDone();
    });
  }

  function loginAs(userId: string) {
    const fd = new FormData();
    fd.set("userId", userId);
    setError(null);
    setLoggingInAsId(userId);
    startTransition(async () => {
      const res = await actionLoginAsUser(fd);
      if (!res.ok) {
        setError(res.error ?? "Failed to switch user");
        setLoggingInAsId(null);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users…"
          className="w-48 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
        >
          <option value="">All roles</option>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <div className="text-xs text-muted-soft">{visibleUsers.length} users</div>
      </div>

      {error && <div className="text-sm text-[var(--status-critical)]">{error}</div>}

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Name</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Role</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Email</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u) => (
              <Fragment key={u.id}>
                <tr className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                  <td className="px-3 py-2.5 text-sm text-foreground">
                    {u.name}
                    {u.id === currentUserId && <span className="ml-1.5 text-xs text-muted-soft">(You)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted">{ROLE_LABELS[u.role as UserRole] ?? u.role}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-soft">{u.email ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${u.active ? "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]" : "text-muted bg-surface-raised"}`}>
                      {u.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingId(editingId === u.id ? null : u.id)}
                        title={editingId === u.id ? "Close" : "Edit"}
                        aria-label={editingId === u.id ? "Close edit form" : "Edit user"}
                        className="rounded p-1.5 text-muted hover:bg-surface-raised hover:text-accent"
                      >
                        <EditIcon />
                      </button>
                      <button
                        onClick={() => loginAs(u.id)}
                        disabled={pending || u.id === currentUserId}
                        title="Login as User"
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent/50 hover:text-accent disabled:opacity-40"
                      >
                        {loggingInAsId === u.id && pending ? "Switching…" : "Login as User"}
                      </button>
                    </div>
                  </td>
                </tr>
                {editingId === u.id && (
                  <tr className="border-b border-border-soft">
                    <td colSpan={5} className="bg-surface-raised px-3 py-3">
                      <form className="space-y-3" action={(fd) => { fd.set("id", u.id); submitEdit(fd, () => setEditingId(null)); }}>
                        <UserFields user={u} />
                        <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-40">
                          {pending ? "Saving…" : "Save Changes"}
                        </button>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
