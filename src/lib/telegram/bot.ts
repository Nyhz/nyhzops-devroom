/**
 * TelegramBot — long-polling bot with callback_query support.
 *
 * Reads the bot token from the `settings` table (key: `telegram_bot_token`)
 * or falls back to the `TELEGRAM_BOT_TOKEN` / `DEVROOM_TELEGRAM_BOT_TOKEN`
 * environment variables.
 *
 * Chat ID is resolved the same way: `settings` table key `telegram_chat_id`
 * or `DEVROOM_TELEGRAM_CHAT_ID` env var.
 */

import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db';
import { settings } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventName = 'callback_query' | 'message';
type Handler = (payload: unknown) => void | Promise<void>;

// ---------------------------------------------------------------------------
// TelegramBot class
// ---------------------------------------------------------------------------

export class TelegramBot {
  private offset = 0;
  private running = false;
  private handlers: Record<string, Handler[]> = {};

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the long-polling loop. Never resolves while running.
   * Fire-and-forget: call without `await` from server.ts.
   */
  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const u of updates) await this.handleUpdate(u);
      } catch (err) {
        console.error('[TelegramBot] poll error:', err);
        // Back off before retrying to avoid hammering the API on transient errors.
        await new Promise<void>((r) => setTimeout(r, 5_000));
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  // -------------------------------------------------------------------------
  // Event emitter
  // -------------------------------------------------------------------------

  on(event: EventName, fn: Handler): void {
    (this.handlers[event] ??= []).push(fn);
  }

  // -------------------------------------------------------------------------
  // API methods
  // -------------------------------------------------------------------------

  async send(
    chatId: number | string,
    text: string,
    replyMarkup?: unknown,
  ): Promise<{ message_id: number } | null> {
    const token = this.token();
    if (!token) return null;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: replyMarkup,
        parse_mode: 'Markdown',
      }),
    });
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    return data.ok ? { message_id: data.result!.message_id } : null;
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    const token = this.token();
    if (!token) return;

    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
  }

  /** Resolve chat ID for broadcasting notifications. */
  chatId(): string | null {
    try {
      const db = getDatabase();
      const row = db.select().from(settings).where(eq(settings.key, 'telegram_chat_id')).get();
      return (
        row?.value ??
        process.env.DEVROOM_TELEGRAM_CHAT_ID ??
        null
      );
    } catch {
      return process.env.DEVROOM_TELEGRAM_CHAT_ID ?? null;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private token(): string | null {
    try {
      const db = getDatabase();
      const row = db.select().from(settings).where(eq(settings.key, 'telegram_bot_token')).get();
      return (
        row?.value ??
        process.env.TELEGRAM_BOT_TOKEN ??
        process.env.DEVROOM_TELEGRAM_BOT_TOKEN ??
        null
      );
    } catch {
      return (
        process.env.TELEGRAM_BOT_TOKEN ??
        process.env.DEVROOM_TELEGRAM_BOT_TOKEN ??
        null
      );
    }
  }

  private async getUpdates(): Promise<unknown[]> {
    const token = this.token();
    if (!token) return [];

    const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${this.offset}`;
    const res = await fetch(url);
    const data = (await res.json()) as { ok: boolean; result: Array<{ update_id: number }> };
    if (!data.ok) return [];

    for (const u of data.result) {
      if (u.update_id >= this.offset) this.offset = u.update_id + 1;
    }
    return data.result;
  }

  private async handleUpdate(update: unknown): Promise<void> {
    const u = update as Record<string, unknown>;
    if (u.callback_query) {
      for (const fn of this.handlers.callback_query ?? []) await fn(u.callback_query);
    } else if (u.message) {
      for (const fn of this.handlers.message ?? []) await fn(u.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const telegramBot = new TelegramBot();
