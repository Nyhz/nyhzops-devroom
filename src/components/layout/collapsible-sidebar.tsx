"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SidebarContent } from "./sidebar-content";
import type { Battlefield } from "@/types";

const STORAGE_KEY = "devroom-sidebar-collapsed";

const GLOBAL_TOP_ICONS = [
  { href: "/", icon: "\u25C9", label: "HQ", exact: true },
  { href: "/general", icon: "\u25C7", label: "GENERAL", exact: false },
] as const;

const BATTLEFIELD_ICONS = [
  { icon: "\u25A0", label: "MISSIONS", segment: "" },
  { icon: "\u2715", label: "CAMPAIGNS", segment: "campaigns" },
  { icon: "\u25C6", label: "GIT", segment: "git" },
  { icon: "\u25B6", label: "CONSOLE", segment: "console" },
  { icon: "\u23F1", label: "SCHEDULE", segment: "schedule" },
  { icon: "\u2699", label: "CONFIG", segment: "config" },
] as const;

const GLOBAL_BOTTOM_ICONS = [
  { href: "/overseer-log", icon: "\u2693", label: "OVERSEER'S LOG" },
  { href: "/assets", icon: "\u25CE", label: "ASSETS" },
  { href: "/logistics", icon: "\u25C8", label: "LOGISTICS" },
] as const;

interface CollapsibleSidebarProps {
  battlefields: Battlefield[];
  missionCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
  activeAgents: number;
}

export function CollapsibleSidebar({
  battlefields,
  missionCounts,
  campaignCounts,
  activeAgents,
}: CollapsibleSidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();

  // Load persisted expand state on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "expanded") {
        setExpanded(true);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "expanded" : "collapsed");
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  const closeExpanded = useCallback(() => {
    setExpanded(false);
    try {
      localStorage.setItem(STORAGE_KEY, "collapsed");
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Extract battlefield ID for icon-rail nav
  const segments = pathname.split("/");
  const bfIndex = segments.indexOf("battlefields");
  const battlefieldId = bfIndex >= 0 ? segments[bfIndex + 1] : undefined;
  const afterId = bfIndex >= 0 ? segments.slice(bfIndex + 2).join("/") : "";

  function isGlobalActive(href: string, exact: boolean): boolean {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  function isBattlefieldActive(segment: string): boolean {
    if (!battlefieldId) return false;
    if (segment === "") {
      return (
        afterId === "" ||
        afterId === "missions" ||
        afterId.startsWith("missions/")
      );
    }
    return afterId === segment || afterId.startsWith(`${segment}/`);
  }

  return (
    <>
      {/* Icon rail — tablet only (md to lg). Always in grid at 60px. */}
      <aside className="hidden md:flex lg:hidden bg-dr-surface border-r border-dr-border flex-col overflow-y-auto">
        {/* Brand icon */}
        <Link
          href="/"
          className="flex items-center justify-center py-4 hover:bg-dr-elevated transition-colors"
        >
          <div className="w-10 h-10 bg-dr-amber flex items-center justify-center text-dr-bg font-bold text-base shrink-0">
            N
          </div>
        </Link>

        <div className="border-t border-dr-border" />

        {/* Global top nav icons */}
        <div className="py-2 space-y-0.5">
          {GLOBAL_TOP_ICONS.map((link) => {
            const active = isGlobalActive(link.href, link.exact);
            return (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                className={cn(
                  "flex items-center justify-center py-2.5 text-base transition-colors",
                  active
                    ? "bg-dr-elevated text-dr-amber"
                    : "text-dr-muted hover:text-dr-text hover:bg-dr-elevated"
                )}
              >
                {link.icon}
              </Link>
            );
          })}
        </div>

        <div className="border-t border-dr-border" />

        {/* Battlefield nav icons */}
        {battlefieldId && (
          <>
            <div className="py-2 space-y-0.5">
              {BATTLEFIELD_ICONS.map((item) => {
                const active = isBattlefieldActive(item.segment);
                const href =
                  item.segment === ""
                    ? `/battlefields/${battlefieldId}`
                    : `/battlefields/${battlefieldId}/${item.segment}`;
                return (
                  <Link
                    key={item.label}
                    href={href}
                    title={item.label}
                    className={cn(
                      "flex items-center justify-center py-2.5 text-base transition-colors",
                      active
                        ? "bg-dr-elevated text-dr-amber"
                        : "text-dr-muted hover:text-dr-text hover:bg-dr-elevated"
                    )}
                  >
                    {item.icon}
                  </Link>
                );
              })}
            </div>
            <div className="border-t border-dr-border" />
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Global bottom nav icons */}
        <div className="py-2 space-y-0.5">
          {GLOBAL_BOTTOM_ICONS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                className={cn(
                  "flex items-center justify-center py-2.5 text-base transition-colors",
                  active
                    ? "bg-dr-elevated text-dr-amber"
                    : "text-dr-muted hover:text-dr-text hover:bg-dr-elevated"
                )}
              >
                {link.icon}
              </Link>
            );
          })}
        </div>

        {/* Expand/collapse toggle */}
        <div className="border-t border-dr-border">
          <button
            onClick={toggleExpanded}
            title={expanded ? "Collapse sidebar" : "Expand sidebar"}
            className="w-full flex items-center justify-center py-3 text-dr-muted hover:text-dr-text hover:bg-dr-elevated transition-colors"
          >
            <span className="text-base">{expanded ? "\u276E" : "\u276F"}</span>
          </button>
        </div>
      </aside>

      {/* Full sidebar — desktop only (lg+). Always in grid at 300px. */}
      <aside className="hidden lg:flex bg-dr-surface border-r border-dr-border flex-col overflow-y-auto">
        <SidebarContent
          battlefields={battlefields}
          missionCounts={missionCounts}
          campaignCounts={campaignCounts}
          activeAgents={activeAgents}
        />
      </aside>

      {/* Expanded overlay — tablet only, slides out from icon rail */}
      {expanded && (
        <div className="fixed inset-0 z-50 hidden md:block lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 transition-opacity"
            onClick={closeExpanded}
          />
          {/* Expanded sidebar panel — positioned after icon rail */}
          <aside className="absolute top-0 left-[60px] h-full w-[300px] bg-dr-surface border-r border-dr-border flex flex-col overflow-y-auto">
            <SidebarContent
              battlefields={battlefields}
              missionCounts={missionCounts}
              campaignCounts={campaignCounts}
              activeAgents={activeAgents}
              onLinkClick={closeExpanded}
            />
            <div className="border-t border-dr-border">
              <button
                onClick={closeExpanded}
                title="Collapse sidebar"
                className="w-full flex items-center justify-center py-3 text-dr-muted hover:text-dr-text hover:bg-dr-elevated transition-colors"
              >
                <span className="text-base">{"\u276E"}</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
