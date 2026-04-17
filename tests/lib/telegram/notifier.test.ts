import { describe, it, expect, beforeEach } from 'vitest';
import { desc } from 'drizzle-orm';

import { getDatabase } from '@/lib/db';
import { notifications } from '@/lib/db/schema';
import { notifyAuthPause } from '@/lib/telegram/notifier';

describe('notifyAuthPause', () => {
  beforeEach(() => {
    getDatabase().delete(notifications).run();
  });

  it('persists a critical notification so the alert survives without Telegram', async () => {
    await notifyAuthPause();

    const rows = getDatabase()
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe('critical');
    expect(rows[0].title).toMatch(/AUTH FAILURE/);
    expect(rows[0].detail).toMatch(/authenticate/i);
  });

  it('includes the optional detail snippet in the persisted notification', async () => {
    await notifyAuthPause('Anthropic API error: 401 Unauthorized');

    const [row] = getDatabase()
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .all();

    expect(row.detail).toContain('Anthropic API error: 401 Unauthorized');
  });
});
