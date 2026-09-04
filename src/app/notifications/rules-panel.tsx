"use client";

import { useState, useTransition } from "react";
import { Th, Td, EmptyState } from "@/components/ui";
import { Modal } from "@/components/modal";
import {
  actionCreateNotificationRule,
  actionUpdateNotificationRule,
  actionToggleNotificationRule,
  actionDeleteNotificationRule,
} from "@/app/actions";
import { NOTIFICATION_EVENTS, NOTIFICATION_EVENT_META } from "@/lib/notifications/events";
import { NOTIFICATION_RECIPIENT_TYPES, NOTIFICATION_CHANNELS, NOTIFICATION_TYPES, USER_ROLES, ROLE_LABELS } from "@/lib/domain/enums";

export type RuleRow = {
  id: string;
  event: string;
  recipientType: string;
  recipientRole: string | null;
  recipientUserId: string | null;
  recipientUserName: string | null;
  channel: string;
  status: string;
  notificationType: string;
  title: string;
  message: string;
};

const CHANNEL_LABEL: Record<string, string> = { IN_APP: "In-App", EMAIL: "Email", BOTH: "In-App + Email" };
const RECIPIENT_TYPE_LABEL: Record<string, string> = { ROLE: "Role", SPECIFIC_USER: "Specific User", RELEVANT_USER: "Relevant User" };

function recipientLabel(rule: RuleRow) {
  if (rule.recipientType === "ROLE") return rule.recipientRole ? ROLE_LABELS[rule.recipientRole as keyof typeof ROLE_LABELS] ?? rule.recipientRole : "—";
  if (rule.recipientType === "SPECIFIC_USER") return rule.recipientUserName ?? "—";
  return "Relevant User";
}

const inputClass = "mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent";

function RuleForm({ rule, users, onDone }: { rule: Partial<RuleRow> | null; users: { id: string; name: string }[]; onDone: () => void }) {
  const [event, setEvent] = useState(rule?.event ?? NOTIFICATION_EVENTS[0]);
  const [recipientType, setRecipientType] = useState(rule?.recipientType ?? "ROLE");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const meta = NOTIFICATION_EVENT_META[event as keyof typeof NOTIFICATION_EVENT_META];

  return (
    <form
      // No box styling in the create case — that instance now sits inside a Modal, which
      // already provides the border/background; the inline edit-row case still needs it since
      // its own <td> wrapper has none.
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${rule ? "rounded-md border border-border-soft bg-surface-raised p-3" : ""}`}
      action={(fd) => {
        setError(null);
        if (rule?.id) fd.set("id", rule.id);
        startTransition(async () => {
          const res = rule?.id ? await actionUpdateNotificationRule(fd) : await actionCreateNotificationRule(fd);
          if (!res.ok) setError(res.error);
          else onDone();
        });
      }}
    >
      <label className="text-xs text-muted">
        Event
        <select name="event" value={event} onChange={(e) => setEvent(e.target.value)} className={inputClass}>
          {NOTIFICATION_EVENTS.map((ev) => (
            <option key={ev} value={ev}>{NOTIFICATION_EVENT_META[ev].label}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        Notification Type
        <select name="notificationType" defaultValue={rule?.notificationType ?? meta.notificationType} className={inputClass}>
          {NOTIFICATION_TYPES.map((t) => (
            <option key={t} value={t}>{t === "ACTION_REQUIRED" ? "Action Required" : "Information"}</option>
          ))}
        </select>
      </label>

      <label className="text-xs text-muted">
        Recipients
        <select name="recipientType" value={recipientType} onChange={(e) => setRecipientType(e.target.value)} className={inputClass}>
          {NOTIFICATION_RECIPIENT_TYPES.map((rt) => (
            <option key={rt} value={rt}>{RECIPIENT_TYPE_LABEL[rt]}</option>
          ))}
        </select>
      </label>
      {recipientType === "ROLE" && (
        <label className="text-xs text-muted">
          Role
          <select name="recipientRole" defaultValue={rule?.recipientRole ?? USER_ROLES[0]} className={inputClass}>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
      )}
      {recipientType === "SPECIFIC_USER" && (
        <label className="text-xs text-muted">
          User
          <select name="recipientUserId" defaultValue={rule?.recipientUserId ?? users[0]?.id} className={inputClass}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
      )}
      {recipientType === "RELEVANT_USER" && (
        <div className="text-xs text-muted-soft self-end pb-1.5">Resolved automatically from the record (e.g. the assigned operator) — not every event supports this.</div>
      )}

      <label className="text-xs text-muted">
        Channel
        <select name="channel" defaultValue={rule?.channel ?? "IN_APP"} className={inputClass}>
          {NOTIFICATION_CHANNELS.map((c) => (
            <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        Status
        <select name="status" defaultValue={rule?.status ?? "ENABLED"} className={inputClass}>
          <option value="ENABLED">Enabled</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </label>

      <label className="text-xs text-muted sm:col-span-2">
        Title
        <input name="title" defaultValue={rule?.title ?? meta.defaultTitle} required className={inputClass} />
      </label>
      <label className="text-xs text-muted sm:col-span-2">
        Message
        <textarea name="message" defaultValue={rule?.message ?? meta.defaultMessage} required rows={3} className={inputClass} />
        <span className="mt-1 block text-[11px] text-muted-soft">Available variables for this event: {meta.availableVariables.map((v) => `{${v}}`).join(", ")}</span>
      </label>

      {error && <div className="text-sm text-[var(--status-critical)] sm:col-span-2">{error}</div>}

      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="btn btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function RulesPanel({ rules, users }: { rules: RuleRow[]; users: { id: string; name: string }[] }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(rule: RuleRow) {
    const fd = new FormData();
    fd.set("id", rule.id);
    fd.set("status", rule.status === "ENABLED" ? "DISABLED" : "ENABLED");
    startTransition(async () => { await actionToggleNotificationRule(fd); });
  }
  function remove(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => { await actionDeleteNotificationRule(fd); });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setCreating(true)} className="btn btn-secondary btn-sm">
          + New Rule
        </button>
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New Notification Rule">
        <RuleForm rule={null} users={users} onDone={() => setCreating(false)} />
      </Modal>

      {rules.length === 0 ? (
        <EmptyState title="No notification rules yet" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Event</Th>
                <Th>Recipients</Th>
                <Th>Channel</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) =>
                editingId === rule.id ? (
                  <tr key={rule.id}>
                    <td colSpan={5} className="p-2">
                      <RuleForm rule={rule} users={users} onDone={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={rule.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                    <Td>{NOTIFICATION_EVENT_META[rule.event as keyof typeof NOTIFICATION_EVENT_META]?.label ?? rule.event}</Td>
                    <Td className="text-xs text-muted">{recipientLabel(rule)}</Td>
                    <Td className="text-xs text-muted">{CHANNEL_LABEL[rule.channel] ?? rule.channel}</Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => toggle(rule)}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${rule.status === "ENABLED" ? "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]" : "text-muted bg-surface-raised"}`}
                      >
                        {rule.status === "ENABLED" ? "Enabled" : "Disabled"}
                      </button>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setEditingId(rule.id)} className="text-xs text-accent hover:underline">Edit</button>
                        <button type="button" onClick={() => remove(rule.id)} className="text-xs text-[var(--status-critical)] hover:underline">Delete</button>
                      </div>
                    </Td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
