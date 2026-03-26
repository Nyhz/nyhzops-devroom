# Phase D2: Git Dashboard — Design Spec

**Project:** DEVROOM — Agent Orchestrator
**Phase:** D2 (Git Dashboard)
**Date:** 2026-03-26
**Status:** Approved

---

## Overview

Replace the git stub page with a visual git interface: working tree status (staged/modified/untracked), commit form, commit log, branch management, and diff viewer. All operations via `simple-git` through Server Actions.

---

## 1. Server Actions

**File:** `src/actions/git.ts`

All actions take `battlefieldId` as first param, resolve `repoPath` from the battlefield record.

### Actions

| Action | Input | Returns |
|--------|-------|---------|
| `getGitStatus(battlefieldId)` | — | `{ staged: FileEntry[], modified: FileEntry[], untracked: FileEntry[] }` |
| `stageFile(battlefieldId, path)` | file path | void |
| `unstageFile(battlefieldId, path)` | file path | void |
| `stageAll(battlefieldId)` | — | void |
| `unstageAll(battlefieldId)` | — | void |
| `commitChanges(battlefieldId, message)` | commit message | void |
| `getGitLog(battlefieldId, limit?, offset?)` | pagination | `{ commits: CommitEntry[] }` |
| `getBranches(battlefieldId)` | — | `{ current: string, local: BranchEntry[], remote: BranchEntry[] }` |
| `checkoutBranch(battlefieldId, branch)` | branch name | void |
| `deleteBranch(battlefieldId, branch)` | branch name | void |
| `createBranch(battlefieldId, name)` | branch name | void |
| `getFileDiff(battlefieldId, path)` | file path | `string` (unified diff) |

```typescript
interface FileEntry { path: string; status: string; }
interface CommitEntry { hash: string; message: string; author: string; date: string; refs: string; }
interface BranchEntry { name: string; current: boolean; }
```

All mutations call `revalidatePath`.

---

## 2. Git Dashboard Page

**Replace:** `src/app/projects/[id]/git/page.tsx`

Server Component. Uses Tabs (shadcn) for three views: STATUS, LOG, BRANCHES.

### Status Tab (default)

**Staged files:** Green list. Each: file path + `[UNSTAGE]` button.
**Modified files:** Amber list. Each: file path + `[STAGE]` + `[DIFF]` buttons.
**Untracked files:** Dim list. Each: file path + `[STAGE]` button.
**Bulk:** `[STAGE ALL]` `[UNSTAGE ALL]` buttons.
**Commit form:** Message input + `[COMMIT]` button (only enabled when staged files exist).
**Auto-refresh:** Re-query on mutations via revalidatePath.

### Log Tab

Commit history list. Each: short hash (amber), message, author, relative time.
Paginated: 50 per page, `[LOAD MORE]` at bottom.
Click commit → expand to show diff (inline, not a new page).

### Branches Tab

**Local branches:** List with current highlighted (`●`). Actions: `[CHECKOUT]`, `[DELETE]` (confirm, not on current).
**Remote branches:** Collapsed section.
**`[NEW BRANCH]`:** Input + create button.
**`[MERGE INTO CURRENT]`:** On non-current branches. Confirmation dialog.

### Diff Viewer

When viewing a diff (from status DIFF button or log commit expand):
- Unified diff format
- Line-by-line with `+` lines green, `-` lines red
- `font-data` monospace
- File path as header
- Rendered in a scrollable card

---

## 3. Components

- `src/components/git/git-status.tsx` — Client Component (buttons for stage/unstage/commit)
- `src/components/git/git-log.tsx` — Client Component (pagination + expandable commits)
- `src/components/git/git-branches.tsx` — Client Component (branch actions)
- `src/components/git/git-diff.tsx` — Presentational diff renderer

---

## 4. Safety

- Delete branch requires confirmation modal
- No force-push button
- No rebase UI
- Commit button disabled when no staged files
