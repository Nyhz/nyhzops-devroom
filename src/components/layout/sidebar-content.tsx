"use client";

import Link from "next/link";
import { GlobalNavTop, GlobalNavBottom } from "./global-nav";
import { BattlefieldSelector } from "./battlefield-selector";
import { SidebarNav } from "./sidebar-nav";
import type { Battlefield } from "@/types";

interface SidebarContentProps {
  battlefields: Battlefield[];
  missionCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
  onLinkClick?: () => void;
}

export function SidebarContent({
  battlefields,
  missionCounts,
  campaignCounts,
  onLinkClick,
}: SidebarContentProps) {
  return (
    <>
      {/* Brand block — clickable, goes to War Room */}
      <Link
        href="/"
        className="block px-5 pt-5 pb-4 hover:bg-dr-elevated transition-colors"
        onClick={onLinkClick}
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-dr-amber flex items-center justify-center text-dr-bg font-bold text-base shrink-0">
            N
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-dr-text text-base font-bold tracking-wide">
                NYHZ OPS
              </span>
              <span className="text-dr-green text-sm">●</span>
            </div>
            <span className="text-dr-muted text-sm">DEVROOM</span>
          </div>
        </div>
      </Link>

      {/* Separator */}
      <div className="border-t border-dr-border" />

      {/* Global nav — always visible, highlights active route */}
      <GlobalNavTop />

      {/* Separator */}
      <div className="border-t border-dr-border" />

      {/* Battlefield selector */}
      <div className="px-3 py-3">
        <BattlefieldSelector battlefields={battlefields} />
      </div>

      {/* Nav links */}
      <SidebarNav
        missionCounts={missionCounts}
        campaignCounts={campaignCounts}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Global links — highlights active route */}
      <GlobalNavBottom />
    </>
  );
}
