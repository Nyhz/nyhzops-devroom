# Git, Workflows & Operations

## Git / Worktree

- Branch naming: `devroom/{codename-lower}/{mission-id-short}`.
- Phase branches: `devroom/{codename-lower}/phase-{number}-{slug}`.
- Post-completion: merge → cleanup worktree dir → delete branch.
- Conflicts: spawn dedicated Claude Code process with resolution prompt.
- Never force-push. Merge failure → `compromised` with details.

---

## Definition of Done

- [ ] **Types safe** — no `any`. New interfaces exported from `@/types`.
- [ ] **Components correct** — Server/Client boundary right. `"use client"` only where needed.
- [ ] **Migration created** — `npx drizzle-kit generate`. Never edit existing migrations.
- [ ] **Server Actions** — mutations via actions, `revalidatePath()` after writes.
- [ ] **Socket events** — real-time changes emit correct events. Hooks updated.
- [ ] **Error handling** — caught, wrapped, styled military error UI.
- [ ] **Loading states** — `loading.tsx` or Suspense with skeleton UI.
- [ ] **AbortController** — long ops honor signals.
- [ ] **Worktree cleanup** — branches merged, dirs removed.
- [ ] **Tests pass** — `npm test` green. New logic covered.
- [ ] **Tailwind only** — no inline styles.
- [ ] **Domain model synced** — schema changes reflected here.

---

## Scripts

```json
{
  "dev": "tsx server.ts",
  "build": "next build",
  "start": "NODE_ENV=production tsx server.ts",
  "test": "vitest",
  "lint": "eslint",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",
  "seed": "tsx scripts/seed.ts"
}
```

---

## Environment Variables

`.env.local` — all optional with sane defaults:

| Variable                    | Default      | Description                              |
|-----------------------------|--------------|------------------------------------------|
| `DEVROOM_PORT`              | `7777`       | HTTP server port                         |
| `DEVROOM_HOST`              | `0.0.0.0`    | Bind address                             |
| `DEVROOM_DB_PATH`           | `./devroom.db`| SQLite file path                        |
| `DEVROOM_DEV_BASE_PATH`    | `/dev`        | Base directory for new battlefields      |
| `DEVROOM_LOG_LEVEL`         | `info`       | debug, info, warn, error                 |
| `DEVROOM_MAX_AGENTS`        | `5`          | Max concurrent Claude Code processes     |
| `DEVROOM_CLAUDE_PATH`       | `claude`     | Path to Claude Code binary               |
| `DEVROOM_LOG_RETENTION_DAYS`| `30`         | Days to keep mission logs                |
| `DEVROOM_TELEGRAM_BOT_TOKEN`| `''`         | Telegram bot token for notifications     |
| `DEVROOM_TELEGRAM_CHAT_ID` | `''`         | Telegram chat ID for notifications       |
| `DEVROOM_TELEGRAM_ENABLED` | `false`      | Enable Telegram integration (`'true'`)   |
