import { getDatabase } from "@/lib/db/index";
import { battlefields, missions, campaigns } from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";
import { CollapsibleSidebar } from "./collapsible-sidebar";
import type { Battlefield } from "@/types";

export function Sidebar() {
  const db = getDatabase();

  const allBattlefields = db.select().from(battlefields).all() as Battlefield[];

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
    <CollapsibleSidebar
      battlefields={allBattlefields}
      missionCounts={missionCounts}
      campaignCounts={campaignCounts}
    />
  );
}
