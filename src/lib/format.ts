const auDate = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric" });
const auDateTime = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
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
