"use client";

import { useState, useTransition } from "react";
import { Th, Td, EmptyState } from "@/components/ui";
import { Modal } from "@/components/modal";
import {
  actionCreateReportSchedule,
  actionUpdateReportSchedule,
  actionToggleReportSchedule,
  actionDeleteReportSchedule,
  actionRunReportSchedule,
} from "@/app/actions";
import { formatDateTime } from "@/lib/format";
import { REPORT_TYPES, REPORT_TYPE_LABELS, REPORT_SCHEDULE_FREQUENCIES, REPORT_SCHEDULE_RECIPIENT_TYPES, DAYS_OF_WEEK, DAY_OF_WEEK_LABELS, USER_ROLES, ROLE_LABELS } from "@/lib/domain/enums";

export type ScheduleRow = {
  id: string;
  reportType: string;
  frequency: string;
  timeOfDay: string;
  dayOfWeek: string | null;
  dayOfMonth: number | null;
  recipientType: string;
  recipientRole: string | null;
  recipientUserId: string | null;
  recipientUserName: string | null;
  status: string;
  lastRunAt: Date | null;
  lastRunEmailStatus: string | null;
};

const FREQUENCY_LABEL: Record<string, string> = { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly" };
const RECIPIENT_TYPE_LABEL: Record<string, string> = { ROLE: "Role", SPECIFIC_USER: "Specific User" };

function recipientLabel(schedule: ScheduleRow) {
  if (schedule.recipientType === "ROLE") return schedule.recipientRole ? ROLE_LABELS[schedule.recipientRole as keyof typeof ROLE_LABELS] ?? schedule.recipientRole : "—";
  return schedule.recipientUserName ?? "—";
}

function ordinal(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
  return `${n}th`;
}

function whenLabel(schedule: ScheduleRow) {
  const time = schedule.timeOfDay;
  if (schedule.frequency === "WEEKLY") return `Weekly on ${schedule.dayOfWeek ? DAY_OF_WEEK_LABELS[schedule.dayOfWeek as keyof typeof DAY_OF_WEEK_LABELS] ?? schedule.dayOfWeek : "—"} at ${time}`;
  if (schedule.frequency === "MONTHLY") return `Monthly on the ${schedule.dayOfMonth ? ordinal(schedule.dayOfMonth) : "—"} at ${time}`;
  return `Daily at ${time}`;
}

const inputClass = "mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent";

function ScheduleForm({ schedule, users, onDone }: { schedule: Partial<ScheduleRow> | null; users: { id: string; name: string }[]; onDone: () => void }) {
  const [frequency, setFrequency] = useState(schedule?.frequency ?? REPORT_SCHEDULE_FREQUENCIES[0]);
  const [recipientType, setRecipientType] = useState(schedule?.recipientType ?? "ROLE");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      // No box styling in the create case — that instance now sits inside a Modal, which
      // already provides the border/background; the inline edit-row case still needs it since
      // its own <td> wrapper has none.
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${schedule ? "rounded-md border border-border-soft bg-surface-raised p-3" : ""}`}
      action={(fd) => {
        setError(null);
        if (schedule?.id) fd.set("id", schedule.id);
        startTransition(async () => {
          const res = schedule?.id ? await actionUpdateReportSchedule(fd) : await actionCreateReportSchedule(fd);
          if (!res.ok) setError(res.error);
          else onDone();
        });
      }}
    >
      <label className="text-xs text-muted">
        Report
        <select name="reportType" defaultValue={schedule?.reportType ?? REPORT_TYPES[0]} className={inputClass}>
          {REPORT_TYPES.map((t) => (
            <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        Frequency
        <select name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputClass}>
          {REPORT_SCHEDULE_FREQUENCIES.map((f) => (
            <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
          ))}
        </select>
      </label>

      {frequency === "WEEKLY" && (
        <label className="text-xs text-muted">
          Day of Week
          <select name="dayOfWeek" defaultValue={schedule?.dayOfWeek ?? DAYS_OF_WEEK[0]} className={inputClass}>
            {DAYS_OF_WEEK.map((d) => (
              <option key={d} value={d}>{DAY_OF_WEEK_LABELS[d]}</option>
            ))}
          </select>
        </label>
      )}
      {frequency === "MONTHLY" && (
        <label className="text-xs text-muted">
          Day of Month
          <input name="dayOfMonth" type="number" min="1" max="31" defaultValue={schedule?.dayOfMonth ?? 1} required className={inputClass} />
        </label>
      )}
      <label className="text-xs text-muted">
        Time
        <input name="timeOfDay" type="time" defaultValue={schedule?.timeOfDay ?? "09:00"} required className={inputClass} />
      </label>

      <label className="text-xs text-muted">
        Recipients
        <select name="recipientType" value={recipientType} onChange={(e) => setRecipientType(e.target.value)} className={inputClass}>
          {REPORT_SCHEDULE_RECIPIENT_TYPES.map((rt) => (
            <option key={rt} value={rt}>{RECIPIENT_TYPE_LABEL[rt]}</option>
          ))}
        </select>
      </label>
      {recipientType === "ROLE" && (
        <label className="text-xs text-muted">
          Role
          <select name="recipientRole" defaultValue={schedule?.recipientRole ?? USER_ROLES[0]} className={inputClass}>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
      )}
      {recipientType === "SPECIFIC_USER" && (
        <label className="text-xs text-muted">
          User
          <select name="recipientUserId" defaultValue={schedule?.recipientUserId ?? users[0]?.id} className={inputClass}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
      )}

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

export function SchedulesPanel({ schedules, users }: { schedules: ScheduleRow[]; users: { id: string; name: string }[] }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [, startTransition] = useTransition();

  function toggle(schedule: ScheduleRow) {
    const fd = new FormData();
    fd.set("id", schedule.id);
    fd.set("status", schedule.status === "ENABLED" ? "DISABLED" : "ENABLED");
    startTransition(async () => { await actionToggleReportSchedule(fd); });
  }
  function remove(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => { await actionDeleteReportSchedule(fd); });
  }
  function runNow(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    setRunResult(null);
    setRunningId(id);
    startTransition(async () => {
      const res = await actionRunReportSchedule(fd);
      setRunningId(null);
      setRunResult({
        id,
        ok: res.ok,
        text: res.ok ? `Sent to ${res.recipientCount} recipient${res.recipientCount === 1 ? "" : "s"}` : res.error,
      });
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-soft">
        Frequency, day, and time describe the intended cadence only. Nothing runs automatically; use &ldquo;Run Now&rdquo; to send a delivery immediately.
      </p>
      <div className="flex justify-end">
        <button type="button" onClick={() => setCreating(true)} className="btn btn-secondary btn-sm">
          + New Schedule
        </button>
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New Report Schedule">
        <ScheduleForm schedule={null} users={users} onDone={() => setCreating(false)} />
      </Modal>

      {schedules.length === 0 ? (
        <EmptyState title="No schedules yet" />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-soft">
                <Th>Report</Th>
                <Th>Schedule</Th>
                <Th>Recipients</Th>
                <Th>Status</Th>
                <Th>Last Run</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) =>
                editingId === schedule.id ? (
                  <tr key={schedule.id}>
                    <td colSpan={6} className="p-2">
                      <ScheduleForm schedule={schedule} users={users} onDone={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={schedule.id} className="border-b border-border-soft last:border-0 transition-colors hover:bg-surface-raised">
                    <Td>{REPORT_TYPE_LABELS[schedule.reportType as keyof typeof REPORT_TYPE_LABELS] ?? schedule.reportType}</Td>
                    <Td className="text-xs text-muted">{whenLabel(schedule)}</Td>
                    <Td className="text-xs text-muted">{recipientLabel(schedule)}</Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => toggle(schedule)}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${schedule.status === "ENABLED" ? "text-[var(--status-healthy)] bg-[var(--status-healthy-bg)]" : "text-muted bg-surface-raised"}`}
                      >
                        {schedule.status === "ENABLED" ? "Enabled" : "Disabled"}
                      </button>
                    </Td>
                    <Td className="text-xs text-muted-soft">
                      {schedule.lastRunAt ? formatDateTime(schedule.lastRunAt) : "Never run"}
                      {runResult?.id === schedule.id && (
                        <div className={runResult.ok ? "text-[var(--status-healthy)]" : "text-[var(--status-critical)]"}>{runResult.text}</div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => runNow(schedule.id)} disabled={runningId === schedule.id} className="text-xs text-accent hover:underline disabled:opacity-40">
                          {runningId === schedule.id ? "Running…" : "Run Now"}
                        </button>
                        <button type="button" onClick={() => setEditingId(schedule.id)} className="text-xs text-accent hover:underline">Edit</button>
                        <button type="button" onClick={() => remove(schedule.id)} className="text-xs text-[var(--status-critical)] hover:underline">Delete</button>
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
