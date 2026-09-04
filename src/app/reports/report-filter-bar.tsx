import Link from "next/link";
import { Panel } from "@/components/ui";

export type FilterField = "dateRange" | "material" | "location" | "operation" | "status" | "reference" | "user" | "purpose";

type Option = { value: string; label: string };
type StatusOption = Option & { group?: string };

const inputClass = "mt-1 block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent";

/**
 * One filter bar shape shared by every report tab — only the fields a given report actually
 * uses are rendered, per the spec's "show only filters relevant to the selected report." Plain
 * GET form, no client JS, matching the existing /ledger and /inventory precedent: the whole page
 * re-renders from the URL's search params, so Apply/Reset/tab-switch are all just navigation.
 */
export function ReportFilterBar({
  tab,
  fields,
  params,
  materials,
  locations,
  operationOptions,
  statusOptions,
  users,
}: {
  tab: string;
  fields: FilterField[];
  params: Record<string, string | undefined>;
  materials: Option[];
  locations: Option[];
  operationOptions?: Option[];
  statusOptions?: StatusOption[];
  users?: Option[];
}) {
  const groupedStatusOptions = statusOptions
    ? statusOptions.reduce<Record<string, StatusOption[]>>((acc, o) => {
        const key = o.group ?? "";
        (acc[key] ??= []).push(o);
        return acc;
      }, {})
    : null;

  return (
    <Panel>
      <form className="grid grid-cols-2 gap-3 sm:grid-cols-4" method="GET">
        <input type="hidden" name="tab" value={tab} />
        {fields.includes("dateRange") && (
          <>
            <label className="text-xs text-muted">
              From
              <input type="date" name="from" defaultValue={params.from ?? ""} className={inputClass} />
            </label>
            <label className="text-xs text-muted">
              To
              <input type="date" name="to" defaultValue={params.to ?? ""} className={inputClass} />
            </label>
          </>
        )}
        {fields.includes("material") && (
          <label className="text-xs text-muted">
            Material
            <select name="materialId" defaultValue={params.materialId ?? ""} className={inputClass}>
              <option value="">All Materials</option>
              {materials.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
        )}
        {fields.includes("location") && (
          <label className="text-xs text-muted">
            Location
            <select name="locationId" defaultValue={params.locationId ?? ""} className={inputClass}>
              <option value="">All Locations</option>
              {locations.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>
        )}
        {fields.includes("operation") && operationOptions && (
          <label className="text-xs text-muted">
            Operation
            <select name="operation" defaultValue={params.operation ?? ""} className={inputClass}>
              <option value="">All Operations</option>
              {operationOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
        {fields.includes("purpose") && (
          <label className="text-xs text-muted">
            Purpose
            <select name="purpose" defaultValue={params.purpose ?? ""} className={inputClass}>
              <option value="">All Purposes</option>
              <option value="TRANSFER">Transfer</option>
              <option value="ISSUE">Issue</option>
            </select>
          </label>
        )}
        {fields.includes("status") && groupedStatusOptions && (
          <label className="text-xs text-muted">
            Status
            <select name="status" defaultValue={params.status ?? ""} className={inputClass}>
              <option value="">All Status</option>
              {Object.keys(groupedStatusOptions).length === 1 && Object.keys(groupedStatusOptions)[0] === ""
                ? groupedStatusOptions[""].map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))
                : Object.entries(groupedStatusOptions).map(([group, opts]) => (
                    <optgroup key={group} label={group}>
                      {opts.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                  ))}
            </select>
          </label>
        )}
        {fields.includes("reference") && (
          <label className="text-xs text-muted">
            Reference
            <input name="reference" defaultValue={params.reference ?? ""} placeholder="Search reference…" className={inputClass} />
          </label>
        )}
        {fields.includes("user") && users && (
          <label className="text-xs text-muted">
            User
            <select name="userId" defaultValue={params.userId ?? ""} className={inputClass}>
              <option value="">All Users</option>
              {users.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </label>
        )}
        <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
          <button type="submit" className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground">Apply</button>
          <Link href={`/reports?tab=${tab}`} className="rounded-md border border-border px-4 py-1.5 text-sm text-muted hover:text-foreground">Reset</Link>
        </div>
      </form>
    </Panel>
  );
}
