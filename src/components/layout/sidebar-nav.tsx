"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: string;
  label: string;
  segment: string;
  countKey?: "missions" | "campaigns";
}

const TOP_ITEMS: NavItem[] = [
  { icon: "■", label: "MISSIONS", segment: "", countKey: "missions" },
  { icon: "✕", label: "CAMPAIGNS", segment: "campaigns", countKey: "campaigns" },
  { icon: "⊞", label: "INTEL BOARD", segment: "board" },
];

const OPS_TOOLS_ITEMS: NavItem[] = [
  { icon: "◆", label: "GIT", segment: "git" },
  { icon: "▶", label: "CONSOLE", segment: "console" },
  { icon: "◇", label: "ENV", segment: "env" },
  { icon: "◎", label: "DEPS", segment: "deps" },
  { icon: "▸", label: "TESTS", segment: "tests" },
  { icon: "⏱", label: "SCHEDULE", segment: "schedule" },
];

const STORAGE_KEY = "sidebar-ops-tools-collapsed";

function subscribeToStorage(callback: () => void) {
  function handler(e: StorageEvent) {
    if (e.key === STORAGE_KEY) callback();
  }
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function getCollapsedSnapshot(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return true;
  return stored === "true";
}

function getCollapsedServerSnapshot(): boolean {
  return true;
}

interface SidebarNavProps {
  missionCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
}

export function SidebarNav({ missionCounts, campaignCounts }: SidebarNavProps) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeToStorage,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );

  const toggleCollapsed = useCallback(() => {
    const next = !getCollapsedSnapshot();
    localStorage.setItem(STORAGE_KEY, String(next));
    // Dispatch storage event so useSyncExternalStore picks up the change
    window.dispatchEvent(
      new StorageEvent("storage", { key: STORAGE_KEY, newValue: String(next) }),
    );
  }, []);

  // Extract battlefield ID from URL
  const segments = pathname.split("/");
  const bfIndex = segments.indexOf("battlefields");
  const battlefieldId = bfIndex >= 0 ? segments[bfIndex + 1] : undefined;

  if (!battlefieldId) {
    return null;
  }

  // Determine active section from pathname
  const afterId = segments.slice(bfIndex + 2).join("/");

  function getCount(item: NavItem): number | undefined {
    if (!item.countKey) return undefined;
    if (item.countKey === "missions") return missionCounts[battlefieldId!] ?? 0;
    if (item.countKey === "campaigns") return campaignCounts[battlefieldId!] ?? 0;
    return undefined;
  }

  function isActive(item: NavItem): boolean {
    if (item.segment === "") {
      return afterId === "" || afterId === "missions" || afterId.startsWith("missions/");
    }
    return afterId === item.segment || afterId.startsWith(`${item.segment}/`);
  }

  function renderItem(item: NavItem, indent = false) {
    const active = isActive(item);
    const href = item.segment === ""
      ? `/battlefields/${battlefieldId}`
      : `/battlefields/${battlefieldId}/${item.segment}`;
    const itemCount = getCount(item);

    return (
      <Link
        key={item.label}
        href={href}
        className={cn(
          "flex items-center gap-3 px-3 py-3 text-sm transition-colors",
          indent && "pl-5",
          active
            ? "bg-dr-elevated text-dr-amber"
            : "text-dr-muted hover:text-dr-text"
        )}
      >
        <span className="w-6 text-center text-base">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        {itemCount !== undefined && itemCount > 0 && (
          <span className="text-dr-dim text-sm">{itemCount}</span>
        )}
      </Link>
    );
  }

  const opsChildActive = OPS_TOOLS_ITEMS.some((item) => isActive(item));
  const isOpen = opsChildActive || !collapsed;

  return (
    <nav className="flex flex-col px-3 gap-0.5">
      {TOP_ITEMS.map((item) => renderItem(item))}

      <button
        type="button"
        onClick={toggleCollapsed}
        className="flex items-center gap-2 px-3 py-2 mt-2 text-xs tracking-widest text-dr-dim hover:text-dr-muted transition-colors"
      >
        <span className={cn(
          "text-[10px] transition-transform duration-150",
          isOpen ? "rotate-90" : "rotate-0"
        )}>
          ▶
        </span>
        <span>OPS TOOLS</span>
      </button>

      {isOpen && OPS_TOOLS_ITEMS.map((item) => renderItem(item, true))}
    </nav>
  );
}
