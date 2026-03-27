import Link from "next/link";
import { getDatabase } from "@/lib/db/index";
import { battlefields, assets, missions, campaigns } from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { BattlefieldSelector } from "./battlefield-selector";
import { SidebarNav } from "./sidebar-nav";
import { GlobalNavTop, GlobalNavBottom } from "./global-nav";
import type { Battlefield } from "@/types";

export function Sidebar() {
  const db = getDatabase();

  const allBattlefields = db.select().from(battlefields).all() as Battlefield[];

  const assetCountResult = db
    .select({ value: count() })
    .from(assets)
    .all();
  const assetCount = assetCountResult[0]?.value ?? 0;

  // Get per-battlefield counts — we'll pass all of them and let the client pick
  const missionCounts: Record<string, number> = {};
  const campaignCounts: Record<string, number> = {};

  for (const bf of allBattlefields) {
    const mResult = db
      .select({ value: count() })
      .from(missions)
      .where(eq(missions.battlefieldId, bf.id))
      .all();
    missionCounts[bf.id] = mResult[0]?.value ?? 0;

    const cResult = db
      .select({ value: count() })
      .from(campaigns)
      .where(eq(campaigns.battlefieldId, bf.id))
      .all();
    campaignCounts[bf.id] = cResult[0]?.value ?? 0;
  }

  return (
    <aside className="bg-dr-surface border-r border-dr-border flex flex-col overflow-y-auto">
      {/* Brand block — clickable, goes to War Room */}
      <Link href="/" className="block px-5 pt-5 pb-4 hover:bg-dr-elevated transition-colors">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-dr-amber flex items-center justify-center text-dr-bg font-bold text-base shrink-0">
            N
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-dr-text text-base font-bold tracking-wide">
                NYHZ OPS
              </span>
              <span className="text-dr-green text-[10px]">●</span>
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
      <div className="px-4 py-4">
        <BattlefieldSelector battlefields={allBattlefields} />
      </div>

      {/* Nav links */}
      <SidebarNav
        assetCount={assetCount}
        missionCounts={missionCounts}
        campaignCounts={campaignCounts}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Global links — highlights active route */}
      <GlobalNavBottom />

      {/* Intel Briefing */}
      <div className="border-t border-dr-border px-5 py-4">
        <span className="text-dr-dim text-xs tracking-widest uppercase">
          Intel Briefing
        </span>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-dr-green text-[10px]">●</span>
          <span className="text-dr-muted text-sm">All systems operational</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-dr-dim text-[10px]">●</span>
          <span className="text-dr-dim text-sm">
            0/{config.maxAgents} assets deployed
          </span>
        </div>
      </div>
    </aside>
  );
}
