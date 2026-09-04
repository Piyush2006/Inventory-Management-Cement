"use client";

import { toCsv } from "@/lib/csv";

/**
 * Exports exactly what's already rendered on the page — the rows are passed in as props from
 * a Server Component that already applied its filters and RBAC scoping, so this can never
 * download more than the viewer was already allowed to see. Pure client-side blob download,
 * no new server round-trip or route.
 */
export function ExportCsvButton({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}) {
  function handleExport() {
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={rows.length === 0}
      className="btn btn-secondary btn-xs"
    >
      Export CSV
    </button>
  );
}
