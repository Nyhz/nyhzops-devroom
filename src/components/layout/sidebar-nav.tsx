"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: string;
  label: string;
  segment: string;
  countKey?: "missions" | "campaigns";
}

const NAV_ITEMS: NavItem[] = [
  { icon: "■", label: "MISSIONS", segment: "", countKey: "missions" },
  { icon: "✕", label: "CAMPAIGNS", segment: "campaigns", countKey: "campaigns" },
  { icon: "◆", label: "GIT", segment: "git" },
  { icon: "▶", label: "CONSOLE", segment: "console" },
  { icon: "⏱", label: "SCHEDULE", segment: "schedule" },
  { icon: "⚙", label: "CONFIG", segment: "config" },
];

interface SidebarNavProps {
  missionCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
}

export function SidebarNav({ missionCounts, campaignCounts }: SidebarNavProps) {
  const pathname = usePathname();

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

  return (
    <nav className="flex flex-col px-3 gap-0.5">
      {NAV_ITEMS.map((item) => {
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
              active
                ? "bg-dr-elevated text-dr-amber"
                : "text-dr-muted hover:text-dr-text"
            )}
          >
            <span className="w-6 text-center text-base">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {itemCount !== undefined && itemCount > 0 && (
              <span className="text-dr-dim text-xs">{itemCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
