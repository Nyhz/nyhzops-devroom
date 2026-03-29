import { getDatabase } from "@/lib/db/index";
import { battlefields, missions, campaigns } from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";
import { AppShellClient } from "./app-shell-client";
import type { Battlefield } from "@/types";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const db = getDatabase();

  const allBattlefields = db.select().from(battlefields).all() as Battlefield[];

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

  const activeAgents = globalThis.orchestrator?.getActiveCount() ?? 0;

  return (
    <AppShellClient
      battlefields={allBattlefields}
      missionCounts={missionCounts}
      campaignCounts={campaignCounts}
      activeAgents={activeAgents}
    >
      {children}
    </AppShellClient>
  );
}
