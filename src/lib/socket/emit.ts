import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/lib/db/index';
import { missions, phases, campaigns } from '@/lib/db/schema';

type Entity = 'mission' | 'phase' | 'campaign' | 'battlefield';

interface ResolvedIds {
  battlefieldId: string | null;
  campaignId: string | null;
}

/**
 * Resolve the related IDs needed to determine socket room topology for an entity.
 * Returns null-filled fields gracefully when the entity is not found.
 */
function resolveIds(entity: Entity, id: string): ResolvedIds {
  const db = getDatabase();

  try {
    if (entity === 'mission') {
      const row = db
        .select({
          battlefieldId: missions.battlefieldId,
          campaignId: missions.campaignId,
        })
        .from(missions)
        .where(eq(missions.id, id))
        .get();
      return {
        battlefieldId: row?.battlefieldId ?? null,
        campaignId: row?.campaignId ?? null,
      };
    }

    if (entity === 'phase') {
      const row = db
        .select({
          campaignId: phases.campaignId,
        })
        .from(phases)
        .where(eq(phases.id, id))
        .get();

      if (!row) return { battlefieldId: null, campaignId: null };

      const campaignRow = db
        .select({ battlefieldId: campaigns.battlefieldId })
        .from(campaigns)
        .where(eq(campaigns.id, row.campaignId))
        .get();

      return {
        battlefieldId: campaignRow?.battlefieldId ?? null,
        campaignId: row.campaignId,
      };
    }

    if (entity === 'campaign') {
      const row = db
        .select({ battlefieldId: campaigns.battlefieldId })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .get();
      return {
        battlefieldId: row?.battlefieldId ?? null,
        campaignId: null, // not needed separately for campaign routing
      };
    }

    // battlefield — no related IDs needed
    return { battlefieldId: null, campaignId: null };
  } catch {
    return { battlefieldId: null, campaignId: null };
  }
}

/**
 * Centralized socket status emitter.
 *
 * Resolves room topology from DB, invalidates Next.js cache paths, then
 * emits the status event to all relevant Socket.IO rooms.
 *
 * Safe to call from server actions, executors, and route handlers alike.
 * No-ops gracefully when `globalThis.io` is not yet initialised.
 */
export function emitStatusChange(
  entity: Entity,
  id: string,
  status: string,
  extra?: Record<string, unknown>,
): void {
  const { battlefieldId, campaignId } = resolveIds(entity, id);

  // --- Cache invalidation (wrap: throws outside Next.js request context) ---
  try {
    if (entity === 'mission') {
      revalidatePath(`/missions/${id}`);
      if (battlefieldId) revalidatePath(`/battlefields/${battlefieldId}`);
      if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
    } else if (entity === 'phase') {
      if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
    } else if (entity === 'campaign') {
      revalidatePath(`/campaigns/${id}`);
      if (battlefieldId) revalidatePath(`/battlefields/${battlefieldId}`);
    } else if (entity === 'battlefield') {
      revalidatePath(`/battlefields/${id}`);
    }
    revalidatePath('/');
  } catch {
    // Outside request context — skip silently
  }

  // --- Socket.IO emissions ---
  const io = globalThis.io;
  if (!io) return;

  const timestamp = Date.now();
  const basePayload: Record<string, unknown> = { status, timestamp, ...extra };

  if (entity === 'mission') {
    const payload = { missionId: id, ...basePayload };
    io.to(`mission:${id}`).emit('mission:status', payload);
    if (battlefieldId) io.to(`battlefield:${battlefieldId}`).emit('mission:status', payload);
    if (campaignId) io.to(`campaign:${campaignId}`).emit('mission:status', payload);
    io.to('hq:activity').emit('mission:status', payload);
  } else if (entity === 'phase') {
    const payload = { phaseId: id, ...basePayload };
    if (campaignId) io.to(`campaign:${campaignId}`).emit('phase:status', payload);
    if (battlefieldId) io.to(`battlefield:${battlefieldId}`).emit('phase:status', payload);
    io.to('hq:activity').emit('phase:status', payload);
  } else if (entity === 'campaign') {
    const payload = { campaignId: id, ...basePayload };
    io.to(`campaign:${id}`).emit('campaign:status', payload);
    if (battlefieldId) io.to(`battlefield:${battlefieldId}`).emit('campaign:status', payload);
    io.to('hq:activity').emit('campaign:status', payload);
  } else if (entity === 'battlefield') {
    const payload = { battlefieldId: id, ...basePayload };
    io.to(`battlefield:${id}`).emit('battlefield:status', payload);
    io.to('hq:activity').emit('battlefield:status', payload);
  }
}
