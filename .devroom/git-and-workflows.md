# Git, Workflows & Operations

## Git / Worktree

- Branch naming: `devroom/{codename-lower}/{mission-id-short}`.
- Phase branches: `devroom/{codename-lower}/phase-{number}-{slug}` (documented pattern — not yet implemented in orchestrator).
- Post-completion: merge → cleanup worktree dir → delete branch.
- Conflicts: handled by QUARTERMASTER asset — spawns Claude Code with merge/resolution prompt.
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
- [ ] **Overseer review** — debrief passes Overseer verdict (PASS/RETRY/ESCALATE).
- [ ] **Quartermaster merge** — worktree merged cleanly, branch deleted.
- [ ] **Tests pass** — `pnpm test` green. New logic covered.
- [ ] **Tailwind only** — no inline styles.
- [ ] **Domain model synced** — schema changes reflected here.

---

## Scripts

```json
{
  "dev": "tsx server.ts",
  "build": "NODE_ENV=production next build",
  "start": "NODE_ENV=production tsx server.ts",
  "test": "vitest",
  "lint": "eslint",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",
  "seed": "tsx scripts/seed.ts",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```

---

## Native Deployment

DEVROOM runs natively on the Mac Mini via `launchd`. No Docker.

### Service Files

| File | Purpose |
|------|---------|
| `scripts/com.devroom.app.plist` | launchd service definition |
| `scripts/devroom-service.sh` | Service runner (invoked by launchd) |
| `scripts/devroom-ctl.sh` | CLI control script |
| `scripts/devroom-status.5s.sh` | xbar menu bar plugin (refreshes every 5s) |

### CLI Control (`devroom-ctl.sh`)

| Command | Action |
|---------|--------|
| `devroom status` | Service status, mode, uptime |
| `devroom dev` | Switch to dev mode (hot reload) |
| `devroom prod` | Switch to prod mode (optimized build) |
| `devroom restart` | Restart the service |
| `devroom logs` | Tail the service log |

### Reverse Proxy

Caddy via Homebrew at `https://devroom.lan` with internal TLS. Config in `Caddyfile`:

```
devroom.lan {
  tls internal
  reverse_proxy localhost:7777
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
