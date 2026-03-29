"use client";

import { useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { IntelBar } from "./intel-bar";
import { CollapsibleSidebar } from "./collapsible-sidebar";
import { MobileTopBar } from "./mobile-top-bar";
import { MobileDrawer } from "./mobile-drawer";
import { StatusFooter } from "./status-footer";
import type { Battlefield } from "@/types";

interface AppShellClientProps {
  children: React.ReactNode;
  battlefields: Battlefield[];
  missionCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
  activeAgents: number;
}

export function AppShellClient({
  children,
  battlefields,
  missionCounts,
  campaignCounts,
  activeAgents,
}: AppShellClientProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  const toggleDrawer = useCallback(() => {
    setDrawerOpen((prev) => !prev);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  // Extract current battlefield name from URL
  const battlefieldName = useMemo(() => {
    const segments = pathname.split("/");
    const bfIndex = segments.indexOf("battlefields");
    if (bfIndex < 0) return undefined;
    const bfId = segments[bfIndex + 1];
    if (!bfId) return undefined;
    const bf = battlefields.find((b) => b.id === bfId);
    return bf?.codename ?? bf?.name;
  }, [pathname, battlefields]);

  return (
    <div className="h-screen grid grid-rows-[auto_1fr_auto] bg-dr-bg">
      {/* Mobile top bar — phones only */}
      <MobileTopBar
        onMenuToggle={toggleDrawer}
        battlefieldName={battlefieldName}
      />

      {/* Intel Bar — tablet and desktop */}
      <div className="hidden md:block">
        <IntelBar />
      </div>

      {/* Middle row: sidebar + content */}
      <div className="grid grid-cols-1 md:grid-cols-[60px_1fr] lg:grid-cols-[300px_1fr] min-h-0">
        {/* CollapsibleSidebar handles tablet (icon-rail) and desktop (full) */}
        <CollapsibleSidebar
          battlefields={battlefields}
          missionCounts={missionCounts}
          campaignCounts={campaignCounts}
          activeAgents={activeAgents}
        />
        <main className="overflow-y-auto overflow-x-hidden">{children}</main>
      </div>

      {/* Status Footer */}
      <StatusFooter />

      {/* Mobile drawer overlay — phones only */}
      <MobileDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        battlefields={battlefields}
        missionCounts={missionCounts}
        campaignCounts={campaignCounts}
        activeAgents={activeAgents}
      />
    </div>
  );
}
