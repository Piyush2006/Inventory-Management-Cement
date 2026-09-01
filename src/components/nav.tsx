"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/locations", label: "Locations" },
  { href: "/materials", label: "Materials" },
  { href: "/inventory", label: "Inventory" },
  { href: "/requests", label: "Requests" },
  { href: "/movements", label: "Stock Operations" },
];

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  // A Requester's whole surface is Requests — raise, view own, confirm/not-received.
  // No Dashboard, Inventory, Locations, Materials, or Stock Operations menu at all.
  // Store Supervisor manages the request queue, not stock directly — no Stock Operations menu either.
  const items =
    role === "REQUESTER"
      ? NAV_ITEMS.filter((i) => i.href === "/requests")
      : role === "STORE_SUPERVISOR"
        ? NAV_ITEMS.filter((i) => i.href !== "/movements")
        : NAV_ITEMS;
  return (
    <nav className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-3 py-4 scrollbar-thin">
      <Link href={role === "REQUESTER" ? "/requests" : "/"} className="mb-5 flex items-center gap-2 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-accent-soft text-sm font-bold text-accent">B</span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-foreground">Berrima Cement Plant</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-soft">Inventory Management</div>
        </div>
      </Link>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`relative block rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-raised hover:text-foreground"
                }`}
              >
                {active && <span className="absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto rounded-md border border-border-soft bg-surface-raised px-2.5 py-2 text-[10px] leading-relaxed text-muted-soft">
        Simulated demo data for Berrima Cement Plant.
      </div>
    </nav>
  );
}
