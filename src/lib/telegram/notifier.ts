/**
 * Notifier — tier-B notification policy + inline escalation answers.
 *
 * Four public dispatch functions:
 *   notifyMissionCompromised    — loud ping with inline keyboard for escalation options
 *   notifyCampaignCompromised   — loud ping (campaign stalled)
 *   notifyCampaignAccomplished  — quiet ping (campaign done)
 *   notifyAuthPause             — loud ping (claude auth broke)
 *
 * The `telegramBot` singleton handles token lookup and chat-ID resolution.
 * All failures are swallowed — notifier errors must never break CONTROL flow.
 */

import { telegramBot } from './bot';
import { escalate } from '@/lib/notifications/escalate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscalationQuestion {
  question: string;
  options?: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getChatId(): string | null {
  return telegramBot.chatId();
}

// ---------------------------------------------------------------------------
// 1. notifyMissionCompromised
// ---------------------------------------------------------------------------

/**
 * Send a Telegram alert when a mission is compromised awaiting Commander input.
 * If a `question` with options is provided, attaches an inline keyboard so the
 * Commander can answer the escalation directly from Telegram.
 * The returned `message_id` can be stored for future edits.
 */
export async function notifyMissionCompromised(
  missionId: string,
  question?: EscalationQuestion,
): Promise<number | null> {
  const chatId = getChatId();
  if (!chatId) return null;

  const lines = [
    '\u{1F6A8} *MISSION COMPROMISED — COMMANDER INPUT REQUIRED*',
    '',
    `Mission ID: \`${missionId}\``,
  ];

  if (question?.question) {
    lines.push('', `*Overseer question:* ${question.question}`);
  }
  if (!question?.options?.length) {
    lines.push('', '_Awaiting Commander orders._');
  }

  const text = lines.join('\n');

  let replyMarkup: unknown | undefined;
  if (question?.options?.length) {
    replyMarkup = {
      inline_keyboard: [
        question.options.map((opt) => ({
          text: opt,
          callback_data: `answer:${missionId}:${opt}`,
        })),
      ],
    };
  }

  try {
    const sent = await telegramBot.send(chatId, text, replyMarkup);
    return sent?.message_id ?? null;
  } catch (err) {
    console.error('[notifier] notifyMissionCompromised failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. notifyCampaignCompromised
// ---------------------------------------------------------------------------

export async function notifyCampaignCompromised(campaignId: string): Promise<void> {
  const chatId = getChatId();
  if (!chatId) return;

  const text = [
    '\u{1F6A8} *CAMPAIGN COMPROMISED*',
    '',
    `Campaign ID: \`${campaignId}\``,
    '',
    '_Campaign has stalled. Commander intervention required._',
  ].join('\n');

  try {
    await telegramBot.send(chatId, text);
  } catch (err) {
    console.error('[notifier] notifyCampaignCompromised failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 3. notifyCampaignAccomplished
// ---------------------------------------------------------------------------

export async function notifyCampaignAccomplished(campaignId: string): Promise<void> {
  const chatId = getChatId();
  if (!chatId) return;

  const text = [
    '\u2705 *CAMPAIGN ACCOMPLISHED*',
    '',
    `Campaign ID: \`${campaignId}\``,
    '',
    '_All phases secured. Mission complete, Commander._',
  ].join('\n');

  try {
    await telegramBot.send(chatId, text);
  } catch (err) {
    console.error('[notifier] notifyCampaignAccomplished failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 4. notifyAuthPause
// ---------------------------------------------------------------------------

export async function notifyAuthPause(
  triggerSnippet?: string,
  context?: { missionId?: string; battlefieldId?: string },
): Promise<void> {
  const detailLines = [
    'Claude CLI cannot authenticate. All missions halted.',
    'Commander: re-authenticate and restart the service.',
  ];
  if (triggerSnippet) {
    detailLines.push('', `Trigger: ${triggerSnippet}`);
  }

  try {
    await escalate({
      level: 'critical',
      title: 'AUTH FAILURE — ORCHESTRATOR PAUSED',
      detail: detailLines.join('\n'),
      entityType: context?.missionId ? 'mission' : undefined,
      entityId: context?.missionId,
      battlefieldId: context?.battlefieldId,
    });
  } catch (err) {
    console.error('[notifier] notifyAuthPause failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Callback handler — wire once at bot start
// Parses `answer:<missionId>:<option>` and routes to answerEscalation.
// ---------------------------------------------------------------------------

let callbackHandlerAttached = false;

export function attachCallbackHandler(): void {
  if (callbackHandlerAttached) return;
  callbackHandlerAttached = true;

  telegramBot.on('callback_query', async (payload) => {
    const cq = payload as { id: string; data?: string };
    const { id, data } = cq;
    if (!data) return;

    const match = data.match(/^answer:([^:]+):(.+)$/);
    if (!match) return;

    const [, missionId, option] = match;

    try {
      // Dynamic import avoids circular dep: notifier ← actions/mission ← control
      const { answerEscalation } = await import('@/actions/mission');
      await answerEscalation(missionId, option);
      await telegramBot.answerCallbackQuery(id, 'Sending to CONTROL...');
    } catch (err) {
      console.error('[notifier] callback handler failed:', err);
      try {
        await telegramBot.answerCallbackQuery(id, 'Error — check server logs.');
      } catch {
        // swallow
      }
    }
  });
}
