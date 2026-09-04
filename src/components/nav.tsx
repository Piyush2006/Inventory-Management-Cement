"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DashboardIcon,
  LocationsIcon,
  MaterialsIcon,
  InventoryIcon,
  RequestsIcon,
  StockOpsIcon,
  ReportsIcon,
  NotificationsIcon,
  UsersIcon,
  CompanyLogo,
} from "@/components/nav-icons";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/locations", label: "Locations", icon: LocationsIcon },
  { href: "/materials", label: "Materials", icon: MaterialsIcon },
  { href: "/inventory", label: "Inventory", icon: InventoryIcon },
  { href: "/requests", label: "Transfer & Issue", icon: RequestsIcon },
  { href: "/movements", label: "Stock Operations", icon: StockOpsIcon },
  { href: "/reports", label: "Reports", icon: ReportsIcon },
  { href: "/notifications", label: "Notifications", icon: NotificationsIcon },
  { href: "/users", label: "Users & Roles", icon: UsersIcon },
];

function CollapseToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform ${collapsed ? "rotate-180" : ""}`}
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  // Starts collapsed (icon-only rail) — hovering it opens the full menu, moving the mouse away
  // closes it back. The toggle button below still lets a user pin it open persistently; that
  // preference resets on a full page reload, an acceptable tradeoff for not needing a
  // pre-hydration script like the theme toggle's.
  const [collapsed, setCollapsed] = useState(true);
  // Transient — while collapsed, hovering the rail temporarily expands it (labels + full width)
  // without touching the persisted `collapsed` preference, so moving the mouse away always
  // returns to the icon-only rail.
  const [hovering, setHovering] = useState(false);
  const expanded = !collapsed || hovering;
  // Indentor (Requester) now has full read access to every informational screen (Dashboard,
  // Locations, Materials, Inventory, Requests, Reports) — only Stock Operations stays hidden,
  // since that page is almost entirely write actions (Receive/Consume/Transfer/Adjustment/
  // Dispatch) this role never performs; the Request lifecycle covers everything they raise or
  // receive. Store Supervisor reaches Stock Operations too — solely for the Dispatch tab (see
  // movements/page.tsx); the Receive Material/Consume/Transfer/Adjustment tabs stay just as
  // inaccessible to them there as before, this only affects whether the menu item shows at all.
  const items = NAV_ITEMS.filter((i) => {
    if (i.href === "/movements" && role === "REQUESTER") return false;
    if (i.href === "/users" && role !== "ADMIN") return false;
    return true;
  });

  return (
    <nav
      onMouseEnter={() => collapsed && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`shadow-panel relative z-10 flex h-full shrink-0 flex-col overflow-y-auto border-r border-border bg-surface py-4 scrollbar-thin transition-[width] duration-200 ${
        expanded ? "w-56 px-3" : "w-16 px-2"
      }`}
    >
      <div className={`mb-3 flex items-center px-2 ${expanded ? "justify-between" : "justify-center"}`}>
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <CompanyLogo size={28} />
          {expanded && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-foreground">Boral Cement Plant</div>
              <div className="truncate text-[10px] uppercase tracking-wide text-muted-soft">Inventory Management</div>
            </div>
          )}
        </Link>
      </div>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "Expand menu" : "Collapse menu"}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        className={`mb-3 flex items-center justify-center rounded-md border border-border p-1.5 text-muted hover:bg-surface-raised hover:text-foreground ${expanded ? "self-end" : "self-center"}`}
      >
        <CollapseToggleIcon collapsed={collapsed} />
      </button>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={expanded ? undefined : item.label}
                className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-raised hover:text-foreground"
                } ${expanded ? "" : "justify-center"}`}
              >
                {active && <span className="absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
                <Icon />
                {expanded && <span className="truncate">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
