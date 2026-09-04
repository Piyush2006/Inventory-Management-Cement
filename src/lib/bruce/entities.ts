export interface MaterialRef { id: string; name: string; materialCode: string; uom: string }
export interface LocationRef { id: string; name: string }

/** Case-insensitive substring match against a small already-fetched list — longest name wins when more than one appears in the text (e.g. "Cement" vs "Cement GP" both matching "cement gp"). */
export function extractMaterial(question: string, materials: MaterialRef[]): MaterialRef | null {
  const q = question.toLowerCase();
  let best: MaterialRef | null = null;
  for (const m of materials) {
    const hits = [m.name, m.materialCode].filter((s) => s && q.includes(s.toLowerCase()));
    if (hits.length === 0) continue;
    if (!best || m.name.length > best.name.length) best = m;
  }
  return best;
}

export function extractLocation(question: string, locations: LocationRef[]): LocationRef | null {
  const q = question.toLowerCase();
  let best: LocationRef | null = null;
  for (const l of locations) {
    if (!q.includes(l.name.toLowerCase())) continue;
    if (!best || l.name.length > best.name.length) best = l;
  }
  return best;
}

export interface Period { from: Date; to: Date; label: string }

/** "today" / "yesterday" / "this week" / "last 7 days" / "last week" -> a concrete day range. Defaults to "today" when no period phrase is present, for callers that need one either way. */
export function extractPeriod(question: string): Period {
  const q = question.toLowerCase();
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const now = new Date();

  if (q.includes("yesterday")) {
    const y = new Date(now.getTime() - 86400000);
    return { from: startOfDay(y), to: endOfDay(y), label: "yesterday" };
  }
  if (q.includes("last week")) {
    const to = new Date(now.getTime() - 7 * 86400000);
    const from = new Date(to.getTime() - 6 * 86400000);
    return { from: startOfDay(from), to: endOfDay(to), label: "last week" };
  }
  if (q.includes("this week") || q.includes("last 7 days")) {
    const from = new Date(now.getTime() - 6 * 86400000);
    return { from: startOfDay(from), to: endOfDay(now), label: "the last 7 days" };
  }
  return { from: startOfDay(now), to: endOfDay(now), label: "today" };
}
