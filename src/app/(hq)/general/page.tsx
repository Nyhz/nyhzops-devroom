import { getActiveSessions, getSessionMessages } from '@/actions/general';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { GeneralChat } from '@/components/general/general-chat';

export default async function GeneralPage({
  searchParams,
}: {
  searchParams: Promise<{ battlefield?: string }>;
}) {
  const params = await searchParams;
  const sessions = await getActiveSessions();
  const db = getDatabase();

  // Load battlefields for the session modal dropdown
  const allBattlefields = db
    .select({ id: battlefields.id, codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.status, 'active'))
    .all();

  // Determine initial active session
  let activeSessionId: string | null = null;
  let initialMessages: { id: string; role: string; content: string; timestamp: number }[] = [];

  if (sessions.length > 0) {
    // If battlefield param, try to find a session linked to it
    if (params.battlefield) {
      const linked = sessions.find((s) => s.battlefieldId === params.battlefield);
      activeSessionId = linked?.id ?? sessions[sessions.length - 1].id;
    } else {
      activeSessionId = sessions[sessions.length - 1].id;
    }

    initialMessages = await getSessionMessages(activeSessionId);
  }

  return (
    <div className="h-full flex flex-col">
      <GeneralChat
        initialSessions={sessions}
        initialMessages={initialMessages}
        initialActiveSessionId={activeSessionId}
        battlefields={allBattlefields}
      />
    </div>
  );
}
