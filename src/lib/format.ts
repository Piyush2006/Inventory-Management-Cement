// Pinned to the plant's own timezone (not left ambient) — without an explicit timeZone, this
// renders in whatever local timezone the runtime happens to be in, which differs between the
// server (always UTC here) and a browser's own local timezone, producing a different wall-clock
// time for the same instant on each side and a React hydration mismatch on every date shown.
const PLANT_TIMEZONE = "Asia/Kolkata";
const auDate = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric", timeZone: PLANT_TIMEZONE });
const auDateTime = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: PLANT_TIMEZONE,
});

export function formatNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString("en-AU", { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits });
}

export function formatQty(value: number, uom: string): string {
  return `${formatNumber(value)} ${uom}`;
}

export function formatDate(value: Date | string): string {
  return auDate.format(new Date(value));
}

export function formatDateTime(value: Date | string): string {
  return auDateTime.format(new Date(value));
}

export function formatPct(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}
