/**
 * Integration tests for TelegramBot (src/lib/telegram/bot.ts).
 *
 * fetch is mocked via vi.spyOn so no real HTTP calls are made.
 * The DB is not touched in these tests — token resolution falls back to the
 * TELEGRAM_BOT_TOKEN env var which we set per-test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// We must import bot AFTER setting up env/mocks so the singleton sees them.
// Use a fresh import per describe block via vi.resetModules() where needed.
// ---------------------------------------------------------------------------

describe('TelegramBot', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Provide a test token via env fallback — the DB lookup will throw in
    // the test environment since there is no settings row, and the catch
    // block falls back to env.
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  // -------------------------------------------------------------------------
  // Token / send
  // -------------------------------------------------------------------------

  it('send() posts correct payload to sendMessage', async () => {
    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    } as Response);

    const result = await bot.send('chat123', 'Hello Commander');

    expect(result).toEqual({ message_id: 42 });
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/bot' + 'test-token-123' + '/sendMessage');
    expect(JSON.parse(init.body as string)).toMatchObject({
      chat_id: 'chat123',
      text: 'Hello Commander',
      parse_mode: 'Markdown',
    });
  });

  it('send() passes replyMarkup when provided', async () => {
    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 99 } }),
    } as Response);

    const markup = { inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }]] };
    await bot.send('chat1', 'Pick one', markup);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.reply_markup).toEqual(markup);
  });

  it('send() returns null when token is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.DEVROOM_TELEGRAM_BOT_TOKEN;

    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();
    const result = await bot.send('chat1', 'text');
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // answerCallbackQuery
  // -------------------------------------------------------------------------

  it('answerCallbackQuery() posts correct payload', async () => {
    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    } as Response);

    await bot.answerCallbackQuery('cq-id-456', 'Sending to CONTROL...');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/answerCallbackQuery');
    expect(JSON.parse(init.body as string)).toMatchObject({
      callback_query_id: 'cq-id-456',
      text: 'Sending to CONTROL...',
    });
  });

  it('answerCallbackQuery() short-circuits when token missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.DEVROOM_TELEGRAM_BOT_TOKEN;

    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();
    await bot.answerCallbackQuery('cq-1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Polling loop — offset advancement
  // -------------------------------------------------------------------------

  it('polling loop advances offset when updates arrive', async () => {
    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();

    // First poll: two updates with update_id 10 and 15.
    // Second poll: no updates — triggers stop.
    let callCount = 0;
    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = url as string;
      if (urlStr.includes('getUpdates')) {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              result: [
                { update_id: 10, message: { text: 'hello' } },
                { update_id: 15, message: { text: 'world' } },
              ],
            }),
          } as Response;
        }
        // Stop the bot after the second poll.
        bot.stop();
        return {
          ok: true,
          json: async () => ({ ok: true, result: [] }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    });

    await bot.start();

    // offset should be 16 (last update_id 15 + 1).
    // Verify by checking the URL of the second getUpdates call.
    const urls = (fetchSpy.mock.calls as [string, RequestInit?][])
      .map(([url]) => url)
      .filter((u) => u.includes('getUpdates'));

    expect(urls.length).toBeGreaterThanOrEqual(2);
    // The second getUpdates call must carry offset=16.
    expect(urls[1]).toContain('offset=16');
  });

  // -------------------------------------------------------------------------
  // Event handlers — callback_query dispatched
  // -------------------------------------------------------------------------

  it('dispatches callback_query handler', async () => {
    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();

    const received: unknown[] = [];
    bot.on('callback_query', (payload) => { received.push(payload); });

    let callCount = 0;
    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = url as string;
      if (urlStr.includes('getUpdates')) {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              result: [{ update_id: 1, callback_query: { id: 'cq1', data: 'answer:m1:retry' } }],
            }),
          } as Response;
        }
        bot.stop();
        return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    });

    await bot.start();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: 'cq1', data: 'answer:m1:retry' });
  });

  // -------------------------------------------------------------------------
  // Event handlers — message dispatched
  // -------------------------------------------------------------------------

  it('dispatches message handler', async () => {
    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();

    const received: unknown[] = [];
    bot.on('message', (payload) => { received.push(payload); });

    let callCount = 0;
    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = url as string;
      if (urlStr.includes('getUpdates')) {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              result: [{ update_id: 5, message: { text: 'ping', from: { id: 999 } } }],
            }),
          } as Response;
        }
        bot.stop();
        return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    });

    await bot.start();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ text: 'ping' });
  });

  // -------------------------------------------------------------------------
  // Polling error resilience
  // -------------------------------------------------------------------------

  it('polling loop recovers after a fetch error', async () => {
    const { TelegramBot } = await import('@/lib/telegram/bot');
    const bot = new TelegramBot();

    let callCount = 0;
    fetchSpy.mockImplementation(async (url: unknown) => {
      const urlStr = url as string;
      if (urlStr.includes('getUpdates')) {
        callCount += 1;
        if (callCount === 1) throw new Error('network error');
        bot.stop();
        return { ok: true, json: async () => ({ ok: true, result: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    });

    // Replace the sleep inside the error handler with a no-op.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      (fn as () => void)();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    await bot.start();
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
