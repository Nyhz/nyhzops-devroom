# Database Schema

### Battlefield

```
- id                TEXT PRIMARY KEY (ULID)
- name              TEXT NOT NULL
- codename          TEXT NOT NULL            -- e.g. "OPERATION THUNDER"
- description       TEXT
- initialBriefing   TEXT                     -- Commander's project briefing for bootstrap
- repoPath          TEXT NOT NULL            -- absolute path to git repo (auto-generated or linked)
- defaultBranch     TEXT DEFAULT 'main'
- claudeMdPath      TEXT                     -- path to project CLAUDE.md (auto-set after bootstrap)
- specMdPath        TEXT                     -- path to project SPEC.md (auto-set after bootstrap)
- scaffoldCommand   TEXT                     -- command used to scaffold (for reference)
- scaffoldStatus    TEXT                     -- null | 'running' | 'complete' | 'failed'
- devServerCommand  TEXT DEFAULT 'npm run dev' -- command to start dev server
- autoStartDevServer INTEGER DEFAULT 0       -- boolean
- status            TEXT DEFAULT 'initializing' -- initializing | active | archived
- bootstrapMissionId TEXT                    -- references the bootstrap mission
- createdAt         INTEGER NOT NULL         -- unix ms
- updatedAt         INTEGER NOT NULL
```

### Mission

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- campaignId      TEXT REFERENCES campaigns(id)
- phaseId         TEXT REFERENCES phases(id)
- type            TEXT DEFAULT 'standard'  -- standard | bootstrap | conflict_resolution | phase_debrief
- title           TEXT NOT NULL
- briefing        TEXT NOT NULL            -- markdown, may contain base64 images
- status          TEXT DEFAULT 'standby'   -- standby|queued|deploying|in_combat|reviewing|approved|merging|accomplished|compromised|abandoned
- priority        TEXT DEFAULT 'normal'    -- low|normal|high|critical
- assetId         TEXT REFERENCES assets(id)
- useWorktree     INTEGER DEFAULT 0
- worktreeBranch  TEXT
- dependsOn       TEXT                     -- mission ID this depends on (intra-phase ordering)
- sessionId       TEXT                     -- Claude Code session for reuse
- debrief         TEXT
- iterations      INTEGER DEFAULT 0
- costInput       INTEGER DEFAULT 0
- costOutput      INTEGER DEFAULT 0
- costCacheHit    INTEGER DEFAULT 0
- reviewAttempts  INTEGER DEFAULT 0        -- Overseer review retry count
- compromiseReason TEXT                    -- timeout | merge-failed | review-failed | execution-failed | escalated
- mergeRetryAt    INTEGER                  -- unix ms for merge retry scheduling
- skillOverrides  TEXT                     -- JSON: { added?: string[], removed?: string[] }
- durationMs      INTEGER DEFAULT 0
- startedAt       INTEGER
- completedAt     INTEGER
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### Campaign

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- name            TEXT NOT NULL            -- e.g. "Operation Clean Sweep"
- objective       TEXT NOT NULL
- status          TEXT DEFAULT 'draft'     -- draft|planning|active|paused|accomplished|compromised|abandoned
- worktreeMode    TEXT DEFAULT 'phase'     -- none|phase|mission
- currentPhase    INTEGER DEFAULT 0
- isTemplate      INTEGER DEFAULT 0
- templateId      TEXT
- debrief         TEXT                     -- campaign completion debrief
- stallReason     TEXT                     -- reason campaign was paused/stalled
- stalledPhaseId  TEXT                     -- phase that caused the stall
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### Phase

```
- id              TEXT PRIMARY KEY (ULID)
- campaignId      TEXT NOT NULL REFERENCES campaigns(id)
- phaseNumber     INTEGER NOT NULL
- name            TEXT NOT NULL            -- e.g. "Recon", "Strike", "Extraction"
- objective       TEXT
- status          TEXT DEFAULT 'standby'   -- standby|active|secured|compromised
- debrief         TEXT
- totalTokens     INTEGER DEFAULT 0
- durationMs      INTEGER DEFAULT 0
- completingAt    INTEGER                  -- timestamp when phase started completing
- createdAt       INTEGER NOT NULL
```

### BriefingSession

Interactive campaign planning sessions with GENERAL asset.

```
- id              TEXT PRIMARY KEY (ULID)
- campaignId      TEXT NOT NULL REFERENCES campaigns(id) UNIQUE
- sessionId       TEXT                     -- Claude Code session ID
- assetId         TEXT REFERENCES assets(id)
- status          TEXT DEFAULT 'open'      -- open | closed
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### BriefingMessage

```
- id              TEXT PRIMARY KEY (ULID)
- briefingId      TEXT NOT NULL REFERENCES briefingSessions(id)
- role            TEXT NOT NULL             -- 'user' | 'assistant'
- content         TEXT NOT NULL
- timestamp       INTEGER NOT NULL
```

### Asset

```
- id              TEXT PRIMARY KEY (ULID)
- codename        TEXT NOT NULL UNIQUE     -- e.g. "OPERATIVE", "ASSERT"
- specialty       TEXT NOT NULL
- systemPrompt    TEXT
- model           TEXT DEFAULT 'claude-sonnet-4-6'
- status          TEXT DEFAULT 'active'    -- active | offline
- missionsCompleted INTEGER DEFAULT 0
- skills          TEXT                     -- JSON array of Claude Code plugin skill identifiers
- mcpServers      TEXT                     -- JSON array of MCP server configurations
- maxTurns        INTEGER                  -- max turns for Claude Code invocation
- effort          TEXT                     -- 'low' | 'medium' | 'high' | 'max'
- isSystem        INTEGER DEFAULT 0        -- boolean; system assets (GENERAL, OVERSEER, QUARTERMASTER) cannot be deleted
- createdAt       INTEGER NOT NULL
```

### MissionLog

```
- id              TEXT PRIMARY KEY (ULID)
- missionId       TEXT NOT NULL REFERENCES missions(id)
- timestamp       INTEGER NOT NULL
- type            TEXT NOT NULL             -- log | status | error
- content         TEXT NOT NULL
```

### ScheduledTask

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- name            TEXT NOT NULL             -- e.g. "Nightly test suite"
- type            TEXT NOT NULL             -- mission | campaign
- cron            TEXT NOT NULL             -- cron expression (e.g. "0 3 * * *")
- enabled         INTEGER DEFAULT 1        -- boolean
- missionTemplate TEXT                     -- JSON: { title, briefing, assetId, priority, useWorktree }
- campaignId      TEXT REFERENCES campaigns(id) -- if type=campaign, which template to re-run
- lastRunAt       INTEGER                  -- unix ms
- nextRunAt       INTEGER                  -- unix ms (precomputed)
- runCount        INTEGER DEFAULT 0
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### CommandLog

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- command         TEXT NOT NULL             -- the command that was executed
- exitCode        INTEGER
- durationMs      INTEGER DEFAULT 0
- output          TEXT                     -- captured stdout+stderr (truncated if large)
- createdAt       INTEGER NOT NULL
```

### Dossier

Reusable mission briefing templates with variable interpolation.

```
- id              TEXT PRIMARY KEY (ULID)
- codename        TEXT NOT NULL UNIQUE     -- e.g. "CODE_REVIEW", "SECURITY_AUDIT"
- name            TEXT NOT NULL
- description     TEXT
- briefingTemplate TEXT NOT NULL           -- markdown with {{variable}} placeholders
- variables       TEXT                     -- JSON array of DossierVariable objects
- assetCodename   TEXT                     -- recommended asset for this dossier
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

`DossierVariable` shape: `{ key, label, description, placeholder }`.

### OverseerLog

Records Overseer review decisions during mission/campaign execution.

```
- id              TEXT PRIMARY KEY (ULID)
- missionId       TEXT NOT NULL REFERENCES missions(id)
- campaignId      TEXT REFERENCES campaigns(id)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- question        TEXT NOT NULL             -- the decision the Overseer faced
- answer          TEXT NOT NULL             -- the decision made
- reasoning       TEXT NOT NULL             -- why this decision was chosen
- confidence      TEXT NOT NULL             -- 'high' | 'medium' | 'low'
- escalated       INTEGER DEFAULT 0        -- whether it was escalated to Commander
- timestamp       INTEGER NOT NULL
```

### Notification

In-app and Telegram alerts for mission events, failures, and escalations.

```
- id              TEXT PRIMARY KEY (ULID)
- level           TEXT NOT NULL             -- 'info' | 'warning' | 'critical'
- title           TEXT NOT NULL
- detail          TEXT NOT NULL
- entityType      TEXT                     -- 'mission' | 'campaign' | 'phase'
- entityId        TEXT
- battlefieldId   TEXT
- read            INTEGER DEFAULT 0
- telegramSent    INTEGER DEFAULT 0
- telegramMsgId   INTEGER
- createdAt       INTEGER NOT NULL
```

### GeneralSession

Standalone GENERAL chat sessions — independent of campaigns. Can optionally link to a battlefield for project context.

```
- id              TEXT PRIMARY KEY (ULID)
- name            TEXT NOT NULL             -- user-assigned session name
- sessionId       TEXT                     -- Claude Code resume session ID
- battlefieldId   TEXT REFERENCES battlefields(id) -- optional battlefield context
- status          TEXT DEFAULT 'active'    -- 'active' | 'closed'
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### GeneralMessage

```
- id              TEXT PRIMARY KEY (ULID)
- sessionId       TEXT NOT NULL REFERENCES generalSessions(id)
- role            TEXT NOT NULL             -- 'commander' | 'general' | 'system'
- content         TEXT NOT NULL
- timestamp       INTEGER NOT NULL
```

### FollowUpSuggestion

Extracted from mission debriefs by the Quartermaster. Surfaces recommended next actions on the battlefield overview.

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- missionId       TEXT REFERENCES missions(id)
- campaignId      TEXT REFERENCES campaigns(id)
- suggestion      TEXT NOT NULL
- status          TEXT NOT NULL DEFAULT 'pending' -- 'pending' | 'added' | 'dismissed'
- intelNoteId     TEXT REFERENCES intelNotes(id)
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```

### IntelNote

Board cards for battlefield planning and tracking.

```
- id              TEXT PRIMARY KEY (ULID)
- battlefieldId   TEXT NOT NULL REFERENCES battlefields(id)
- title           TEXT NOT NULL
- description     TEXT                     -- markdown, may contain base64 images
- column          TEXT DEFAULT 'backlog'   -- 'backlog' | 'planned'
- position        INTEGER DEFAULT 0
- missionId       TEXT REFERENCES missions(id)
- campaignId      TEXT REFERENCES campaigns(id)
- createdAt       INTEGER NOT NULL
- updatedAt       INTEGER NOT NULL
```
