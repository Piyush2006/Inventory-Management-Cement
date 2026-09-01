"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionSetCurrentUser } from "@/app/actions";
import { ROLE_LABELS, type UserRole } from "@/lib/domain/enums";

type User = { id: string; name: string; role: string };

export function UserSwitcher({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={currentUserId}
      disabled={pending}
      onChange={(e) => {
        const fd = new FormData();
        fd.set("userId", e.target.value);
        startTransition(async () => {
          await actionSetCurrentUser(fd);
          router.refresh();
        });
      }}
      className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
    >
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} — {ROLE_LABELS[u.role as UserRole]}
        </option>
      ))}
    </select>
  );
}
