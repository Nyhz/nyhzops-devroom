import { config } from '@/lib/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

interface TelegramResponse {
  ok: boolean;
  result?: {
    message_id?: number;
    update_id?: number;
    callback_query?: {
      id: string;
      data: string;
      message?: { message_id: number };
    };
  };
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data: string;
    message?: { message_id: number };
  };
}

interface TelegramUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let lastUpdateOffset = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
}

/**
 * Check if Telegram integration is properly configured and enabled.
 */
export function isEnabled(): boolean {
  return !!(config.telegramEnabled && config.telegramBotToken && config.telegramChatId);
}

// ---------------------------------------------------------------------------
// Core API methods
// ---------------------------------------------------------------------------

/**
 * Send a text message to the Commander's chat.
 * Returns the message_id for future edits.
 */
export async function sendMessage(
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<number> {
  const body: Record<string, unknown> = {
    chat_id: config.telegramChatId,
    text,
    parse_mode: 'Markdown',
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const res = await fetch(apiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as TelegramResponse;

  if (!data.ok) {
    throw new Error(`Telegram sendMessage failed: ${data.description || 'unknown error'}`);
  }

  return data.result?.message_id ?? 0;
}

/**
 * Send a formatted escalation message with inline keyboard action buttons.
 */
export async function sendEscalation(params: {
  title: string;
  detail: string;
  options: Array<{ label: string; callbackData: string }>;
}): Promise<number> {
  const text = [
    '\u26a0\ufe0f *DEVROOM \u2014 ESCALATION*',
    '',
    `*${params.title}*`,
    '',
    params.detail,
    '',
    '_Awaiting Commander orders._',
  ].join('\n');

  const inlineKeyboard: InlineKeyboard = {
    inline_keyboard: [
      params.options.map((opt) => ({
        text: opt.label,
        callback_data: opt.callbackData,
      })),
    ],
  };

  return sendMessage(text, inlineKeyboard);
}

/**
 * Edit an existing message (e.g., to mark an escalation as resolved).
 */
export async function editMessage(messageId: number, text: string): Promise<void> {
  const res = await fetch(apiUrl('editMessageText'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
    }),
  });

  const data = (await res.json()) as TelegramResponse;

  if (!data.ok) {
    // Telegram returns error if message content hasn't changed — not critical
    console.warn(`[Telegram] editMessage warning: ${data.description}`);
  }
}

/**
 * Answer a callback query (removes the "loading" spinner on the button).
 */
async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  await fetch(apiUrl('answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * Start polling for Telegram updates (callback_query from inline buttons).
 * Calls handler with (callbackData, messageId) for each button press.
 */
export function startPolling(
  handler: (callbackData: string, messageId: number) => void,
): void {
  if (pollingInterval) {
    console.warn('[Telegram] Polling already active.');
    return;
  }

  console.log('[Telegram] Starting callback polling (5s interval)...');

  pollingInterval = setInterval(async () => {
    try {
      const url = `${apiUrl('getUpdates')}?offset=${lastUpdateOffset}&timeout=0&allowed_updates=["callback_query"]`;
      const res = await fetch(url);
      const data = (await res.json()) as TelegramUpdatesResponse;

      if (!data.ok || !data.result?.length) return;

      for (const update of data.result) {
        lastUpdateOffset = update.update_id + 1;

        if (update.callback_query) {
          const { id, data: callbackData, message } = update.callback_query;
          const messageId = message?.message_id ?? 0;

          // Acknowledge the button press
          await answerCallbackQuery(id);

          // Route to handler
          if (callbackData) {
            handler(callbackData, messageId);
          }
        }
      }
    } catch (err) {
      console.error('[Telegram] Polling error:', err);
    }
  }, 5_000);
}

/**
 * Stop polling for Telegram updates.
 */
export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[Telegram] Polling stopped.');
  }
}
