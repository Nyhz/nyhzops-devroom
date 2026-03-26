import Link from "next/link";
import { getDatabase } from "@/lib/db/index";
import { battlefields, assets, missions, campaigns } from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { BattlefieldSelector } from "./battlefield-selector";
import { SidebarNav } from "./sidebar-nav";
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
      {/* Brand block */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-dr-amber flex items-center justify-center text-dr-bg font-bold text-sm shrink-0">
            N
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-dr-text text-sm font-bold tracking-wide">
                NYHZ OPS
              </span>
              <span className="text-dr-green text-[8px]">●</span>
            </div>
            <span className="text-dr-muted text-xs">DEVROOM</span>
          </div>
        </div>
      </div>

      {/* Separator */}
      <div className="border-t border-dr-border" />

      {/* Battlefield selector */}
      <div className="px-3 py-3">
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

      {/* Logistics link */}
      <div className="px-2 mb-1">
        <Link
          href="/logistics"
          className="flex items-center gap-2.5 px-2 py-1.5 text-xs text-dr-muted hover:text-dr-text transition-colors"
        >
          <span className="w-4 text-center text-[10px]">◈</span>
          <span className="flex-1">LOGISTICS</span>
        </Link>
      </div>

      {/* Intel Briefing */}
      <div className="border-t border-dr-border px-4 py-3">
        <span className="text-dr-dim text-[10px] tracking-widest uppercase">
          Intel Briefing
        </span>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-dr-green text-[8px]">●</span>
          <span className="text-dr-muted text-xs">All systems operational</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-dr-dim text-[8px]">●</span>
          <span className="text-dr-dim text-xs">
            0/{config.maxAgents} assets deployed
          </span>
        </div>
      </div>
    </aside>
  );
}
