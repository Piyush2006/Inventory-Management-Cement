/** Escapes one CSV field per RFC 4180: wrap in quotes and double any embedded quote whenever the value contains a comma, quote, or newline. */
function escapeCsvField(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Builds a CSV string (with header row) from plain arrays — no library needed at this data size. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvField).join(","), ...rows.map((row) => row.map(escapeCsvField).join(","))];
  return lines.join("\r\n");
}
