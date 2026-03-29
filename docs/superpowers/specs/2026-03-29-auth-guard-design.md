# Auth Guard — Credential Sync & Lightweight Auth Check

## Problem

DEVROOM runs in Docker on a Mac Mini. The Claude Code CLI authenticates via OAuth, with tokens stored in the macOS Keychain on the host. The Docker container has no access to the Keychain, so when its credentials expire or go missing, missions fail instantly with "Not logged in — Please run /login" and get marked COMPROMISED — even though the host is fully authenticated.

## Solution

Two parts:

1. **Credential sync:** A host-side cron job extracts OAuth tokens from the macOS Keychain and writes them to a file. Docker mounts that file into the container. The executor copies it into each mission's isolated HOME before spawning — same as it already does, just from a reliable source.
2. **Lightweight auth guard:** A pre-flight auth check before each mission spawn. On failure, requeue the mission (not COMPROMISED), pause the queue globally, and send a Telegram escalation. Unpause via Telegram button.

No HQ UI changes needed. Auth failures should be extremely rare with the credential sync in place — the guard is a safety net.

---

## Part 1: Credential Sync

### How Claude Code Auth Works

- On macOS, OAuth tokens are stored in the Keychain under `"Claude Code-credentials"`.
- The stored value is JSON: `{ claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier } }`.
- On Linux (Docker), Claude falls back to reading `~/.claude/.credentials.json` — same format.
- The access token expires every ~8 hours, but the CLI auto-refreshes using the refresh token and writes back to the same location.
- Verified: writing Keychain data to `.credentials.json` and running `claude auth status` with that HOME returns `loggedIn: true`.

### 1.1 Host-Side Sync Script

A shell script on the Mac Mini that runs as a launchd job (or cron):

```bash
#!/bin/bash
# sync-claude-credentials.sh
# Extracts Claude Code OAuth tokens from macOS Keychain and writes to a file
# that the Docker container can mount.

DEST="${HOME}/.devroom/claude-credentials.json"
mkdir -p "$(dirname "$DEST")"

# Extract credential JSON from Keychain
CRED=$(security find-generic-password -s "Claude Code-credentials" -g 2>&1 \
  | grep "^password:" \
  | sed 's/^password: "//' \
  | sed 's/"$//')

if [ -z "$CRED" ]; then
  echo "$(date): Failed to extract credentials from Keychain" >&2
  exit 1
fi

echo "$CRED" > "$DEST"
chmod 600 "$DEST"
```

Schedule: every 30 minutes via launchd or cron. The access token lasts ~8 hours, so 30-minute sync is conservative.

### 1.2 Docker Volume Mount

In `docker-compose.yml` (or equivalent), mount the synced credential file:

```yaml
volumes:
  - ~/.devroom/claude-credentials.json:/host-credentials/claude-credentials.json:rw
```

Mounted read-write so the container's CLI can refresh the token and write back (keeping the file fresh even if the host cron hasn't run recently).

### 1.3 Executor Reads from Mounted Path

**Modified file:** `src/lib/orchestrator/executor.ts`

Change the credential copy block (lines 224-229). Instead of copying from `$HOME/.claude/.credentials.json` (which doesn't exist in the container), copy from the mounted host credential file:

```typescript
// Copy auth credentials from host-synced Keychain extract
const hostCredPath = '/host-credentials/claude-credentials.json';
try {
  fs.copyFileSync(hostCredPath, path.join(missionClaudeDir, '.credentials.json'));
} catch {
  // No host credentials available — auth check will catch this
}
```

The path `/host-credentials/claude-credentials.json` is configurable via `DEVROOM_HOST_CREDENTIALS_PATH` env var (with that default).

### 1.4 Self-Healing Token Refresh

When the container's CLI uses a mission HOME with valid credentials, it can refresh the access token using the refresh token. Since the `.credentials.json` in the mission HOME is a copy (not the mounted file), the refresh only persists for that mission's lifetime.

However, if the mounted file itself is read-write, the container can also update it. To enable this, after a successful mission spawn, the executor could optionally write back refreshed credentials to the mounted path. This is a nice-to-have, not critical — the host cron keeps the file fresh regardless.

---

## Part 2: Lightweight Auth Guard

### 2.1 Auth Probe Function

**New file:** `src/lib/orchestrator/auth-check.ts`

Exports `checkCliAuth(): Promise<{ ok: boolean; error?: string }>`.

Behavior:
- Creates a temporary HOME directory (same isolation pattern as mission execution — copies `.claude.json` and the host-synced `.credentials.json`).
- Spawns `claude auth status --json` with that HOME and a 10-second timeout.
- Parses the JSON output. If `loggedIn` is `true`: `{ ok: true }`.
- If `loggedIn` is `false`, exit non-zero, or timeout: `{ ok: false, error: <detail> }`.
- Cleans up the temp directory after the check.

Uses `claude auth status` rather than `--version` (which doesn't require auth) or `--print "ping"` (which costs tokens).

### 2.2 Orchestrator Pause State

**Modified file:** `src/lib/orchestrator/orchestrator.ts`

New properties on `Orchestrator`:
- `public paused: boolean = false`
- `public pauseReason: string | null = null`

New methods:
- `pause(reason: string)` — sets `paused = true`, sets `pauseReason`, emits `orchestrator:paused` via Socket.IO to `hq:activity` room.
- `unpause()` — sets `paused = false`, clears `pauseReason`, emits `orchestrator:resumed` via Socket.IO to `hq:activity` room, then calls `drainQueue()`.

Modified methods:
- `drainQueue()` — early return if `this.paused`.
- `onMissionQueued()` — early return if `this.paused`.

Missions already IN COMBAT continue running. Only new launches are blocked.

### 2.3 Pre-flight Check in Executor

**Modified file:** `src/lib/orchestrator/executor.ts`

After setting status to DEPLOYING and before worktree setup, insert:

```typescript
const authResult = await checkCliAuth();
if (!authResult.ok) {
  // Return mission to queue — not compromised
  updateStatus('queued');
  storeLog('status', `Auth check failed: ${authResult.error}. Mission re-queued.`);

  // Pause orchestrator globally
  const orch = globalThis.orchestrator as Orchestrator;
  if (orch && !orch.paused) {
    orch.pause('CLI authentication lost');
    escalate({
      level: 'critical',
      title: 'CLI Authentication Lost',
      detail: 'Queue paused. All missions held.\nCheck host credential sync and re-login if needed.',
      actions: [
        { label: 'UNPAUSE', handler: 'unpause' },
      ],
    });
  }

  return; // Exit early — no worktree, no spawn
}
```

### 2.4 Telegram UNPAUSE Action

**Modified file:** `src/lib/captain/escalation.ts`

Add `unpause` case to `handleTelegramCallback`:

```typescript
case 'unpause': {
  const orch = globalThis.orchestrator as Orchestrator;
  if (orch) {
    orch.unpause();
    await editMessage(messageId, '▶️ *Commander unpaused the queue.* Draining...');
  }
  break;
}
```

The callback data format is `unpause:system:global`.

---

## Edge Cases

- **Multiple auth failures in parallel:** The first mission to fail pauses the queue. Subsequent missions in `drainQueue()` see `paused = true` and skip. Missions already deploying concurrently may also hit the auth failure — they also requeue without marking compromised.
- **Auth check passes but mission still fails with auth error:** Possible if token expires between probe and spawn (~seconds gap). Extremely rare. Mission goes COMPROMISED normally — acceptable.
- **Unpause without fixing auth:** Commander's choice. The next mission will fail the auth check again and re-pause. No harm done.
- **Host cron stops running:** Credentials go stale after ~8 hours (access token expiry). Container CLI may still refresh via the refresh token. If both expire, auth guard catches it.
- **Mounted file missing:** Executor's copy falls back silently (try/catch). Auth guard catches the missing credentials on the next spawn.
- **Refresh token expires:** Rare (likely months). Commander re-logins on host, cron syncs fresh tokens.

## Non-Goals

- HQ UI for pause/unpause (Telegram is sufficient for this rare event).
- HQ re-login flow (credential sync eliminates the need).
- Auto-resume after re-login (Commander explicitly unpauses via Telegram).
- Per-battlefield pause (auth is global to the CLI installation).
