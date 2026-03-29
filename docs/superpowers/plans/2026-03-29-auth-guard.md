# Auth Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent missions from going COMPROMISED due to CLI auth failures by syncing host credentials into Docker and adding a pre-flight auth check with queue pause.

**Architecture:** A host-side cron script extracts OAuth tokens from macOS Keychain and writes them to a file that Docker mounts into the container. The executor copies this file into each mission's isolated HOME before spawning. A lightweight auth probe runs before each spawn — on failure, the mission stays QUEUED, the queue pauses globally, and a Telegram escalation fires with an UNPAUSE button.

**Tech Stack:** Node.js child_process (spawn), macOS `security` CLI, Shell script, Docker volumes

---

### Task 1: Host-Side Credential Sync Script

**Files:**
- Create: `scripts/sync-claude-credentials.sh`

This script runs on the Mac Mini host (not inside Docker). It extracts Claude Code's OAuth tokens from the macOS Keychain and writes them to a file that Docker can mount.

- [ ] **Step 1: Create the sync script**

```bash
#!/bin/bash
# sync-claude-credentials.sh
# Extracts Claude Code OAuth tokens from macOS Keychain and writes to a file
# that the DEVROOM Docker container mounts for agent authentication.
#
# Usage: Run via launchd or cron every 30 minutes.
#   crontab example: */30 * * * * /path/to/sync-claude-credentials.sh

set -euo pipefail

DEST="${DEVROOM_CREDENTIALS_DEST:-${HOME}/.devroom/claude-credentials.json}"
mkdir -p "$(dirname "$DEST")"

# Extract credential JSON from macOS Keychain
CRED=$(security find-generic-password -s "Claude Code-credentials" -g 2>&1 \
  | grep "^password:" \
  | sed 's/^password: "//' \
  | sed 's/"$//')

if [ -z "$CRED" ]; then
  echo "$(date): ERROR — Failed to extract credentials from Keychain" >&2
  exit 1
fi

# Validate it's parseable JSON with the expected key
if ! echo "$CRED" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'claudeAiOauth' in d" 2>/dev/null; then
  echo "$(date): ERROR — Credential data is not valid JSON or missing claudeAiOauth key" >&2
  exit 1
fi

echo "$CRED" > "$DEST"
chmod 600 "$DEST"
echo "$(date): OK — Credentials synced to $DEST"
```

- [ ] **Step 2: Make it executable and test on host**

Run (on Mac Mini host, not in Docker):
```bash
chmod +x scripts/sync-claude-credentials.sh
./scripts/sync-claude-credentials.sh
cat ~/.devroom/claude-credentials.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('Keys:', list(d.get('claudeAiOauth',{}).keys()))"
```
Expected: `Keys: ['accessToken', 'refreshToken', 'expiresAt', 'scopes', 'subscriptionType', 'rateLimitTier']`

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-claude-credentials.sh
git commit -m "feat: add host-side credential sync script for Docker auth"
```

---

### Task 2: Add Host Credentials Path to Config

**Files:**
- Modify: `src/lib/config.ts`

Add an env var for the mounted credentials file path so the executor knows where to find host-synced credentials.

- [ ] **Step 1: Add `hostCredentialsPath` to config**

In `src/lib/config.ts`, add the new field to the `DevRoomConfig` interface and the `loadConfig()` function.

Add to the `DevRoomConfig` interface after `telegramEnabled`:
```typescript
  hostCredentialsPath: string;
```

Add to the return object in `loadConfig()` after the `telegramEnabled` line:
```typescript
    hostCredentialsPath: process.env.DEVROOM_HOST_CREDENTIALS_PATH || '/host-credentials/claude-credentials.json',
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/config.ts
git commit -m "feat: add hostCredentialsPath config for Docker credential mount"
```

---

### Task 3: Update Executor to Copy from Host Credentials

**Files:**
- Modify: `src/lib/orchestrator/executor.ts:224-229`

Change the credential copy block to read from the host-mounted file instead of the container's `~/.claude/.credentials.json` (which doesn't exist).

- [ ] **Step 1: Update the credential copy block**

In `src/lib/orchestrator/executor.ts`, replace lines 224-229:

Old code:
```typescript
    // Copy auth and settings — no session data (each mission gets fresh sessions)
    for (const file of ['.credentials.json', 'settings.json']) {
      try {
        fs.copyFileSync(path.join(realHome, '.claude', file), path.join(missionClaudeDir, file));
      } catch { /* skip missing files */ }
    }
```

New code:
```typescript
    // Copy settings from container HOME
    try {
      fs.copyFileSync(path.join(realHome, '.claude', 'settings.json'), path.join(missionClaudeDir, 'settings.json'));
    } catch { /* skip missing */ }
    // Copy auth credentials from host-synced Keychain extract (Docker volume mount)
    try {
      fs.copyFileSync(config.hostCredentialsPath, path.join(missionClaudeDir, '.credentials.json'));
    } catch { /* no host credentials — auth check will catch this */ }
```

Add the config import if not already present. Check the existing imports at the top of the file — `config` is already imported from `@/lib/config` at line 10.

- [ ] **Step 2: Commit**

```bash
git add src/lib/orchestrator/executor.ts
git commit -m "feat: read credentials from host-mounted file instead of container HOME"
```

---

### Task 4: Create Auth Check Function

**Files:**
- Create: `src/lib/orchestrator/auth-check.ts`

A lightweight function that verifies CLI auth by running `claude auth status` with an isolated HOME containing the host-synced credentials.

- [ ] **Step 1: Create `auth-check.ts`**

```typescript
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '@/lib/config';

interface AuthCheckResult {
  ok: boolean;
  error?: string;
}

/**
 * Pre-flight auth check — verifies the Claude CLI can authenticate
 * using the host-synced credentials before spawning a mission.
 */
export async function checkCliAuth(): Promise<AuthCheckResult> {
  const tempHome = `/tmp/claude-auth-check-${Date.now()}`;
  const tempClaudeDir = path.join(tempHome, '.claude');

  try {
    fs.mkdirSync(tempClaudeDir, { recursive: true });

    // Copy .claude.json (profile info)
    const realHome = process.env.HOME || '/home/devroom';
    try {
      fs.copyFileSync(path.join(realHome, '.claude.json'), path.join(tempHome, '.claude.json'));
    } catch { /* fine — not strictly required for auth check */ }

    // Copy host-synced credentials
    try {
      fs.copyFileSync(config.hostCredentialsPath, path.join(tempClaudeDir, '.credentials.json'));
    } catch {
      return { ok: false, error: `Host credentials file not found: ${config.hostCredentialsPath}` };
    }

    // Run claude auth status with isolated HOME
    const result = await new Promise<AuthCheckResult>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ ok: false, error: 'Auth check timed out after 10s' });
      }, 10_000);

      const proc = spawn(config.claudePath, ['auth', 'status'], {
        env: { ...process.env, HOME: tempHome },
      });

      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          resolve({ ok: false, error: stderr || `Exit code ${code}` });
          return;
        }
        try {
          const status = JSON.parse(stdout);
          if (status.loggedIn) {
            resolve({ ok: true });
          } else {
            resolve({ ok: false, error: 'CLI reports not logged in' });
          }
        } catch {
          resolve({ ok: false, error: `Failed to parse auth status: ${stdout.slice(0, 200)}` });
        }
      });
    });

    return result;
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/orchestrator/auth-check.ts
git commit -m "feat: add pre-flight CLI auth check function"
```

---

### Task 5: Add Pause/Unpause to Orchestrator

**Files:**
- Modify: `src/lib/orchestrator/orchestrator.ts`

Add pause state, pause/unpause methods, and guard `drainQueue`/`onMissionQueued` against the paused flag.

- [ ] **Step 1: Add pause properties and methods**

In `src/lib/orchestrator/orchestrator.ts`, add the new properties after the existing `private io` and `private maxAgents` declarations (after line 21):

```typescript
  public paused: boolean = false;
  public pauseReason: string | null = null;
```

Add the new methods after the `triggerDrain()` method (after line 37):

```typescript
  pause(reason: string): void {
    this.paused = true;
    this.pauseReason = reason;
    console.log(`[Orchestrator] PAUSED: ${reason}`);
    this.io.to('hq:activity').emit('orchestrator:paused', { paused: true, reason });
  }

  unpause(): void {
    console.log(`[Orchestrator] UNPAUSED (was: ${this.pauseReason})`);
    this.paused = false;
    this.pauseReason = null;
    this.io.to('hq:activity').emit('orchestrator:resumed', { paused: false });
    this.drainQueue();
  }
```

- [ ] **Step 2: Guard `onMissionQueued` with pause check**

Add at the top of `onMissionQueued()`, before the capacity check (before line 41):

```typescript
    if (this.paused) {
      console.log(`[Orchestrator] Queue paused (${this.pauseReason}). Mission ${missionId} stays queued.`);
      return;
    }
```

- [ ] **Step 3: Guard `drainQueue` with pause check**

Add at the top of `drainQueue()`, before the slots calculation (before line 169):

```typescript
    if (this.paused) return;
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/orchestrator/orchestrator.ts
git commit -m "feat: add pause/unpause state to orchestrator queue"
```

---

### Task 6: Wire Auth Check into Executor Pre-flight

**Files:**
- Modify: `src/lib/orchestrator/executor.ts`

Add the pre-flight auth check after DEPLOYING status, before worktree setup. On failure, requeue the mission, pause the orchestrator, and escalate.

- [ ] **Step 1: Add imports**

At the top of `src/lib/orchestrator/executor.ts`, add the import for `checkCliAuth` after the existing orchestrator imports (after line 13):

```typescript
import { checkCliAuth } from './auth-check';
```

Also add the import for `Orchestrator` type (needed for the `globalThis` cast). Add after the `checkCliAuth` import:

```typescript
import type { Orchestrator } from './orchestrator';
```

- [ ] **Step 2: Add the pre-flight check**

In the `executeMission` function, after the DEPLOYING status update and campaign active check (after line 104, before "Step 2: Build prompt"), insert:

```typescript
    // Pre-flight auth check — verify CLI can authenticate before spending resources
    const authResult = await checkCliAuth();
    if (!authResult.ok) {
      updateStatus('queued');
      storeLog('status', `Auth check failed: ${authResult.error}. Mission re-queued.`);
      emitActivity('mission:auth_failed', `Auth check failed for mission: ${mission.title}. Re-queued.`);

      const orch = globalThis.orchestrator as Orchestrator | undefined;
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

      return;
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/orchestrator/executor.ts
git commit -m "feat: add pre-flight auth check before mission spawn"
```

---

### Task 7: Add Telegram UNPAUSE Callback Handler

**Files:**
- Modify: `src/lib/captain/escalation.ts:121-176`

Add the `unpause` case to `handleTelegramCallback` so the Commander can unpause the queue from Telegram.

- [ ] **Step 1: Add the unpause case**

In `src/lib/captain/escalation.ts`, add a new case inside the `switch (action)` block, before the `default` case (before line 173):

```typescript
      case 'unpause': {
        const orch = globalThis.orchestrator;
        if (orch) {
          orch.unpause();
          await editMessage(messageId, '\u25b6\ufe0f *Commander unpaused the queue.* Draining...');
        } else {
          await editMessage(messageId, '\u26a0\ufe0f *Orchestrator not available.* Cannot unpause.');
        }
        break;
      }
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/captain/escalation.ts
git commit -m "feat: add UNPAUSE callback handler for Telegram escalation"
```

---

### Task 8: Docker Compose Volume Mount

**Files:**
- Modify: `docker-compose.yml` (or equivalent Docker config)

Add the volume mount for the host-synced credentials file. If no docker-compose.yml exists yet, create documentation for how to add it.

- [ ] **Step 1: Check for existing Docker config**

Look for `docker-compose.yml`, `docker-compose.yaml`, `Dockerfile`, or any Docker config in the project root. The volume mount configuration depends on which file exists.

- [ ] **Step 2: Add volume mount**

If `docker-compose.yml` exists, add to the DEVROOM service's `volumes` section:

```yaml
    volumes:
      - ~/.devroom/claude-credentials.json:/host-credentials/claude-credentials.json:rw
```

If no Docker config exists in the repo, add a note to the sync script with the required Docker run flag:

```bash
# Docker run flag:
# -v ~/.devroom/claude-credentials.json:/host-credentials/claude-credentials.json:rw
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: configure Docker volume mount for host credential sync"
```

---

### Task 9: End-to-End Verification

Verify the full flow works by testing each piece.

- [ ] **Step 1: Verify credential sync script**

Run on Mac Mini host:
```bash
./scripts/sync-claude-credentials.sh
cat ~/.devroom/claude-credentials.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if 'claudeAiOauth' in d else 'FAIL')"
```
Expected: `OK`

- [ ] **Step 2: Verify auth check function works**

Start the DEVROOM dev server and trigger a mission. Check server logs for:
```
[Orchestrator] Executing mission ...
```
The mission should proceed past the auth check without pausing.

- [ ] **Step 3: Verify auth failure handling**

Temporarily rename or empty the host credentials file:
```bash
mv /host-credentials/claude-credentials.json /host-credentials/claude-credentials.json.bak
```

Queue a mission. Check server logs for:
```
[Orchestrator] PAUSED: CLI authentication lost
```

Verify:
- Mission status is `queued` (not `compromised`)
- Telegram notification received with UNPAUSE button
- No new missions launch while paused

Restore the file:
```bash
mv /host-credentials/claude-credentials.json.bak /host-credentials/claude-credentials.json
```

- [ ] **Step 4: Verify Telegram unpause**

Press the UNPAUSE button in Telegram. Check server logs for:
```
[Orchestrator] UNPAUSED (was: CLI authentication lost)
```

Verify the queued mission picks up and launches.

- [ ] **Step 5: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: adjustments from auth guard end-to-end testing"
```
