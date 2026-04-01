# Battlefields — Creation, Bootstrap & Configuration

## Creating a Battlefield

The creation form (`<CreateBattlefield />`) collects:

- **Name**: human-readable project name (e.g. "My Blog Engine").
- **Codename**: auto-generated tactical codename (e.g. "OPERATION THUNDER"), editable.
- **Description**: short one-liner about the project.
- **Initial Briefing**: large textarea — the Commander's description of the project. What it is, what stack it uses, what conventions to follow, the scope, architecture decisions, anything relevant. Can be a paragraph or several pages. This is the primary input for the bootstrap process.
- **Scaffold command** (optional): a command to run after folder creation (e.g. `npx create-next-app@latest . --typescript --tailwind --app --src-dir --use-npm`). If blank, only `git init` is performed.
- **Default branch**: (default: `main`).

The **repo path is NOT a form field**. It is auto-generated as `{DEVROOM_DEV_BASE_PATH}/{name-in-kebab-case}`. For a project named "My Blog Engine" with default base path `/dev`, the repo lands at `/dev/my-blog-engine`.

On submit:
1. Compute `repoPath` = `{basePath}/{toKebabCase(name)}`. Validate the folder doesn't already exist.
2. Create the directory: `mkdir -p {repoPath}`.
3. Run `git init` in the new directory.
4. If a scaffold command is provided:
   a. Execute it in the new directory (via `child_process.spawn`).
   b. Stream output to the client in real-time (Socket.IO `console:{battlefieldId}` room).
   c. Wait for completion. If it fails, show the error but still create the battlefield (Commander can fix later).
   d. After scaffold, run `git add -A && git commit -m "Initial scaffold"`.
5. Create battlefield record with status `initializing`.
6. Create a bootstrap mission (type `bootstrap`, asset INTEL, priority `critical`).
7. Queue the bootstrap mission immediately.
8. Redirect to the battlefield page, which shows scaffold output (if any) followed by bootstrap in progress.

## Linking Existing Repos

A secondary flow for existing projects. Toggle `[Link existing repo]` on the creation form reveals:
- **Repo path**: absolute path input. Validated as a git repo.
- Everything else stays the same (name, codename, description, initial briefing, etc.).
- The repo path is used directly instead of auto-generated.
- No `mkdir`, no `git init`, no scaffold. Straight to bootstrap.

## Bootstrap Process

The bootstrap mission is a special mission type (`type: 'bootstrap'`). It runs like any other mission but has a dedicated prompt (see `.devroom/spec-prompts.md`) and a specific post-completion flow.

The bootstrap process:
1. Claude Code analyzes the repo (file structure, existing code, package.json, configs, etc.).
2. Reads the Commander's Initial Briefing.
3. Generates two files:
   - **CLAUDE.md**: project conventions, stack, structure, domain model, coding rules, definition of done.
   - **SPEC.md**: detailed feature specification, screens, workflows, behaviors.
4. The generated content is stored in the mission's debrief field as a structured output (JSON with `claudeMd` and `specMd` keys).

## Bootstrap Review

When the bootstrap mission reaches `accomplished`, the battlefield page shows a **review screen** instead of the normal overview. The `<BootstrapReview />` component displays:

```
┌──────────────────────────────────────────────────────────────┐
│  OPERATION THUNDER — BOOTSTRAP COMPLETE                      │
│  Status: INITIALIZING — Awaiting Commander review            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ CLAUDE.md ─────────────────────────────────────────────┐ │
│  │  (rendered markdown preview, scrollable)                 │ │
│  │                                            [EDIT]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ SPEC.md ───────────────────────────────────────────────┐ │
│  │  (rendered markdown preview, scrollable)                 │ │
│  │                                            [EDIT]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  [APPROVE & DEPLOY]              [REGENERATE]  [ABANDON]     │
└──────────────────────────────────────────────────────────────┘
```

- **EDIT**: Opens an inline markdown editor for each file. Commander can modify before approving.
- **APPROVE & DEPLOY**: Commits both files to the repo root, auto-sets `claudeMdPath` and `specMdPath` on the battlefield, transitions status to `active`. The battlefield is now operational.
- **REGENERATE**: Re-runs the bootstrap mission with the same briefing (or Commander can edit the briefing first). Increments the mission's `iterations` count.
- **ABANDON**: Deletes the battlefield and the bootstrap mission.

## Bootstrap During Initialization

While the bootstrap mission is running (`in_combat`), the battlefield page shows real-time comms stream, just like any other mission.

## Skipping Bootstrap

If the Commander already has a CLAUDE.md for the project (e.g. migrating from another tool), the creation form includes an optional `[Skip bootstrap — I'll provide my own CLAUDE.md]` toggle. When enabled:
- The `claudeMdPath` field appears (file path input).
- Optionally `specMdPath`.
- The battlefield is created directly in `active` status. No bootstrap mission.

---

## Battlefield Overview — `/battlefields/[id]`

Server Component. The main working screen.

### Header

- Breadcrumb: `Battlefields // {name}`
- Title: `{codename}` — large, tactical font.
- Description line.
- Buttons: `[EDIT]` `[ASSETS]`. *(Not yet implemented — header currently has no action buttons. Navigate to config or assets manually.)*

### Deploy Mission (inline)

Card with amber header `DEPLOY MISSION`:
- **Textarea**: placeholder "Describe the mission objective and any relevant intel..."
- **Asset selector**: dropdown of active assets (codename only).
- **Buttons**: `[SAVE]` (green) — saves as STANDBY. `[SAVE & DEPLOY]` (amber) — saves and queues. `[Load dossier]` — file picker for `.md`/`.txt` to populate briefing.
- Server Actions: `createMission` / `createAndDeployMission`.

### Stats Bar

Large numbers + uppercase labels:

```
| 0 IN COMBAT | 251 ACCOMPLISHED | 0 COMPROMISED | 0 STANDBY | 100% |
```

Last value = overall cache hit rate. Live-updated via Socket.IO.

### Mission List

Section header `MISSIONS` (amber) + search input.

Rows (div-based, not `<table>`):
- Mission title (truncated) + iteration badge if > 1.
- Below: `{ASSET} · {relative_time}` in dim.
- Status badge + `VIEW` button.
- Sorted: active first, then `createdAt` desc.
- Search filters by title.

### Right Sidebar

**ASSETS** section:
- Header with `manage` link → `/battlefields/[id]/assets`. *(Route declared but not yet implemented — only `loading.tsx` exists.)*
- List: green dot (active) / gray (offline) + codename + model dim text.

**ASSET BREAKDOWN** section:
- Per-asset mission counts: `{CODENAME}  {total} ({done} done)`.
- Sorted by total desc.
- Includes `NO ASSET` row for unassigned.

---

## Configuration — `/battlefields/[id]/config`

Per-battlefield:
- Name / codename / description (editable).
- Initial Briefing (editable — can re-trigger bootstrap with updated briefing).
- Repo path (read-only after creation, unless linked from existing repo).
- Default branch (dropdown from repo branches).
- CLAUDE.md path (auto-set by bootstrap, editable, preview button).
- SPEC.md path (auto-set by bootstrap, editable, preview button).
- `[RE-BOOTSTRAP]` button: re-run the bootstrap process with current briefing. Shows review before committing.
- Max agents override (optional per-battlefield cap).
- Default asset for deploy form.
- **Dev server command**: the command to start the dev server (default: `npm run dev`).
- **Auto-start dev server**: toggle. If on, dev server starts when DEVROOM boots.

---

## Screenshots & Images

Briefing textarea supports clipboard paste (Cmd+V) and drag-and-drop. Stored as base64 in markdown. Passed directly to Claude Code.
