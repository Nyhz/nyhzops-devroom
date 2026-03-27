import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { notifications } from '@/lib/db/schema';
import { generateId } from '@/lib/utils';
import {
  isEnabled as telegramEnabled,
  sendMessage,
  sendEscalation,
  editMessage,
} from '@/lib/telegram/telegram';
import type { NotificationLevel, NotificationEntityType } from '@/types';

// ---------------------------------------------------------------------------
// escalate — central entry point for all escalations
// ---------------------------------------------------------------------------

export async function escalate(params: {
  level: NotificationLevel;
  title: string;
  detail: string;
  entityType?: NotificationEntityType;
  entityId?: string;
  battlefieldId?: string;
  actions?: Array<{ label: string; handler: string }>;
}): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  const id = generateId();

  // 1. Store notification in DB
  db.insert(notifications).values({
    id,
    level: params.level,
    title: params.title,
    detail: params.detail,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    battlefieldId: params.battlefieldId ?? null,
    read: 0,
    telegramSent: 0,
    createdAt: now,
  }).run();

  // 2. Emit Socket.IO event to HQ
  if (globalThis.io) {
    globalThis.io.to('hq:activity').emit('notification:new', {
      id,
      level: params.level,
      title: params.title,
      detail: params.detail,
      entityType: params.entityType,
      entityId: params.entityId,
      battlefieldId: params.battlefieldId,
      timestamp: now,
    });
  }

  // 3. Send Telegram message for warning/critical levels
  if ((params.level === 'warning' || params.level === 'critical') && telegramEnabled()) {
    try {
      let telegramMsgId: number;

      if (params.actions && params.actions.length > 0 && params.entityType && params.entityId) {
        // Send with inline action buttons
        telegramMsgId = await sendEscalation({
          title: params.title,
          detail: params.detail,
          options: params.actions.map((a) => ({
            label: a.label,
            callbackData: `${a.handler}:${params.entityType}:${params.entityId}`,
          })),
        });
      } else {
        // Send plain text message
        const text = [
          params.level === 'critical'
            ? '\ud83d\udea8 *DEVROOM \u2014 CRITICAL*'
            : '\u26a0\ufe0f *DEVROOM \u2014 WARNING*',
          '',
          `*${params.title}*`,
          '',
          params.detail,
        ].join('\n');

        telegramMsgId = await sendMessage(text);
      }

      // Update notification with Telegram info
      db.update(notifications).set({
        telegramSent: 1,
        telegramMsgId,
      }).where(eq(notifications.id, id)).run();

    } catch (err) {
      console.error('[Escalation] Telegram send failed:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// handleTelegramCallback — routes Telegram button presses to actions
// ---------------------------------------------------------------------------

export async function handleTelegramCallback(
  callbackData: string,
  messageId: number,
): Promise<void> {
  // Parse format: "action:entityType:entityId"
  const parts = callbackData.split(':');
  if (parts.length < 3) {
    console.warn(`[Escalation] Invalid callback data: ${callbackData}`);
    return;
  }

  const [action, entityType, entityId] = parts;

  console.log(`[Escalation] Telegram callback: ${action} ${entityType} ${entityId}`);

  try {
    switch (action) {
      case 'approve': {
        // Acknowledge — no-op, just edit the message
        await editMessage(messageId, '\u2705 *Commander approved.* Proceeding as planned.');
        break;
      }

      case 'retry': {
        if (entityType === 'mission') {
          // Dynamic import to avoid circular deps
          const { redeployMission } = await import('@/actions/mission');
          await redeployMission(entityId);
          await editMessage(messageId, '\ud83d\udd04 *Commander ordered redeployment.* Mission re-queued.');
        }
        break;
      }

      case 'abort': {
        if (entityType === 'mission') {
          const { abandonMission } = await import('@/actions/mission');
          await abandonMission(entityId);
          await editMessage(messageId, '\u274c *Commander ordered abort.* Mission abandoned.');
        } else if (entityType === 'campaign') {
          const { abandonCampaign } = await import('@/actions/campaign');
          await abandonCampaign(entityId);
          await editMessage(messageId, '\u274c *Commander ordered abort.* Campaign abandoned.');
        }
        break;
      }

      case 'resume': {
        if (entityType === 'campaign') {
          const { resumeCampaign } = await import('@/actions/campaign');
          await resumeCampaign(entityId);
          await editMessage(messageId, '\u25b6\ufe0f *Commander ordered resume.* Campaign continuing.');
        }
        break;
      }

      case 'skip': {
        if (entityType === 'campaign') {
          const { skipAndContinueCampaign } = await import('@/actions/campaign');
          await skipAndContinueCampaign(entityId);
          await editMessage(messageId, '\u23e9 *Commander ordered skip & continue.* Advancing to next phase.');
        }
        break;
      }

      default:
        console.warn(`[Escalation] Unknown action: ${action}`);
        await editMessage(messageId, `\u2753 Unknown action: ${action}`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Escalation] Callback handler error:`, err);
    await editMessage(messageId, `\u26a0\ufe0f *Action failed:* ${errMsg}`);
  }
}
