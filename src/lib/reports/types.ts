// Shared filter shape across every report query module — a superset of what any single report
// uses; each module reads only the fields relevant to it (per the spec: "show only filters
// relevant to the selected report").
export interface ReportFilters {
  from?: Date; // inclusive, start of day
  to?: Date; // inclusive, end of day
  materialId?: string;
  locationId?: string;
  operation?: string; // OPERATION_GROUPS key, see operations.ts
  status?: string;
  reference?: string;
  userId?: string;
  purpose?: string; // REQUEST_PURPOSES value, see requestDispatch.ts's getRequestReport
}

export function parseDateRangeParams(from?: string, to?: string): { from?: Date; to?: Date } {
  return {
    from: from ? new Date(`${from}T00:00:00`) : undefined,
    to: to ? new Date(`${to}T23:59:59.999`) : undefined,
  };
}
