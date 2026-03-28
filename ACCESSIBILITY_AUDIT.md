# DEVROOM Accessibility Audit — Contrast & Size Violations

**Date:** 2026-03-28
**Type:** READ-ONLY audit — no code modified
**Auditor:** OPERATIVE (Mission: Accessibility Recon)

---

## Executive Summary

**Total violations found: ~190+** across 60+ files

The DEVROOM UI has two systemic accessibility failures:

1. **`text-dr-dim` (#4a4a5a) is used extensively for readable content** — this color produces a contrast ratio of ~2.7:1 on `#0a0a0c` and ~2.9:1 on `#111114`, failing WCAG AA (requires 4.5:1 for normal text, 3:1 for large text).

2. **`text-[10px]` arbitrary sizing is used ~25+ times** for labels, badges, and metadata that should be at minimum `text-xs` (12px).

Additionally, `text-dr-muted` (#6a6a7a) produces ~3.8:1 contrast on dark backgrounds — passing WCAG AA for large text (3:1) but failing for normal text (4.5:1). It is used for body text, labels, and descriptions where 4.5:1 is required.

### Contrast Reference Table

| Token | Hex | On #0a0a0c | On #111114 | On #1a1a22 | WCAG AA (4.5:1)? |
|-------|-----|-----------|-----------|-----------|-------------------|
| `text-dr-text` | #b8b8c8 | ~8.5:1 | ~7.5:1 | ~6.2:1 | PASS |
| `text-dr-muted` | #6a6a7a | ~4.0:1 | ~3.8:1 | ~3.2:1 | FAIL (normal text) |
| `text-dr-dim` | #4a4a5a | ~2.7:1 | ~2.5:1 | ~2.2:1 | FAIL |

---

## Theme-Level Issues (globals.css)

### Issue T1: `--color-dr-muted` too dark for body text
- **Token:** `--color-dr-muted: #6a6a7a` / `--muted-foreground: #6a6a7a`
- **Category:** CONTRAST
- **Severity:** HIGH
- **Impact:** Every component using `text-dr-muted` or `text-muted-foreground` on dark backgrounds fails WCAG AA for normal text
- **Suggested fix:** Change to `#8a8a9a` (~5.2:1 on #0a0a0c) or `#9a9aaa` (~6.2:1)

### Issue T2: `--color-dr-dim` unusable for text
- **Token:** `--color-dr-dim: #4a4a5a`
- **Category:** CONTRAST
- **Severity:** HIGH
- **Impact:** Never meets WCAG AA for any text size on any dark background
- **Suggested fix:** Change to `#6a6a7a` (current muted level) or reserve exclusively for borders/decorative elements, never text

---

## Violations by File

### Layout Components

#### `src/components/layout/sidebar.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 51 | `text-dr-muted text-sm` | CONTRAST | HIGH | Muted text on dark surface | `text-dr-text` |
| 84 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Dim xs text — double violation | `text-dr-muted text-sm` |
| 89 | `text-dr-muted text-sm` | CONTRAST | HIGH | Muted on dark bg | `text-dr-text` |
| 92-95 | `text-dr-dim text-sm` | CONTRAST | MEDIUM | Dim text on dark bg | `text-dr-muted` |

#### `src/components/layout/sidebar-nav.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 74 | `text-dr-muted` | CONTRAST | HIGH | Inactive nav items hard to read | `text-neutral-300` |
| 80 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Count badges dim and tiny | `text-dr-muted text-sm` |

#### `src/components/layout/global-nav.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 36 | `text-dr-muted` | CONTRAST | HIGH | Inactive nav items unreadable | `text-neutral-300` |

#### `src/components/layout/battlefield-selector.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 28 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "No battlefields" empty state | `text-dr-muted text-sm` |
| 37 | `text-xs` | SIZE | MEDIUM | Dropdown trigger text | `text-sm` |
| 42 | `text-xs` | SIZE | MEDIUM | Dropdown item text | `text-sm` |

#### `src/components/layout/intel-bar.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 129 | `text-dr-dim text-sm` | CONTRAST | MEDIUM | Inspirational quote text | `text-neutral-400` |
| 142 | `text-dr-dim` | CONTRAST | MEDIUM | Bell icon when no notifications | `text-neutral-500` |
| 164 | `text-xs` | SIZE | MEDIUM | "No notifications" empty state | `text-sm` |
| 189 | `text-xs text-dr-muted` | CONTRAST+SIZE | HIGH | Notification detail text | `text-sm text-neutral-400` |
| 192 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | HIGH | Timestamp — 10px + dim | `text-xs text-neutral-500` |
| 220 | `text-dr-dim` | CONTRAST | MEDIUM | LOGISTICS link text | `text-neutral-400` |

#### `src/components/layout/page-header.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 12 | `text-dr-dim font-tactical text-xs` | CONTRAST+SIZE | HIGH | Codename line | `text-sm text-neutral-500` |

#### `src/components/layout/page-wrapper.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 28 | `text-xs font-tactical text-dr-dim` | CONTRAST+SIZE | HIGH | Breadcrumb text | `text-sm text-neutral-500` |

#### `src/components/layout/status-footer.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 5 | `text-dr-dim text-sm` | CONTRAST | MEDIUM | Footer security notice | `text-neutral-400` |

---

### Dashboard Components

#### `src/components/dashboard/deploy-mission.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 130 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Helper text | `text-dr-muted text-sm` |
| 143 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Helper text | `text-dr-muted text-sm` |

#### `src/components/dashboard/dossier-selector.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 106 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Empty state | `text-dr-muted` |
| 124 | `text-dr-muted text-xs` | CONTRAST | MEDIUM | Secondary text | `text-dr-text` |
| 128 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Template description | `text-dr-muted` |
| 135 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Variable label | `text-dr-muted` |
| 157 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Empty state | `text-dr-muted` |
| 168 | `text-dr-amber text-xs` | SIZE | MEDIUM | Header label | `text-sm` |
| 173 | `text-dr-text text-xs` | SIZE | MEDIUM | Form label | `text-sm` |
| 175 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Description | `text-dr-muted` |
| 178 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Template metadata | `text-dr-muted` |
| 198 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Helper text | `text-dr-muted` |

#### `src/components/dashboard/stats-bar.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 20,26,32,38,44 | `text-dr-muted text-sm` | CONTRAST | MEDIUM | All 5 stats labels | `text-dr-text` |

#### `src/components/dashboard/mission-list.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 64 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Mission metadata | `text-dr-muted` |
| 88 | `text-dr-dim text-sm` | CONTRAST | HIGH | Asset codename / timestamp | `text-dr-muted` |

#### `src/components/dashboard/activity-feed.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 47 | `text-xs font-data` | SIZE | MEDIUM | Activity log content | `text-sm` |
| 48 | `text-dr-dim` | CONTRAST | HIGH | Activity feed text | `text-dr-muted` |
| 74 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Feed metadata | `text-dr-muted` |

---

### Campaign Components

#### `src/components/campaign/briefing-chat.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 74 | `text-dr-dim` | CONTRAST | HIGH | Muted text on dr-bg | `text-dr-muted` |
| 87 | `text-[10px]` | SIZE | MEDIUM | Label | `text-xs` |
| 104 | `text-[10px]` | SIZE | MEDIUM | GENERAL label | `text-xs` |

#### `src/components/campaign/campaign-controls.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 150 | `text-xs` | SIZE | MEDIUM | Guidance text | `text-sm` |
| 156 | `text-xs` | SIZE | MEDIUM | Error message | `text-sm` |

#### `src/components/campaign/campaign-results.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 66 | `text-dr-dim` | CONTRAST | HIGH | "CACHE HIT" label | `text-dr-muted` |
| 77 | `text-[10px]` | SIZE | MEDIUM | Phase label | `text-xs` |
| 93 | `text-dr-dim` | CONTRAST | HIGH | Status indicator | `text-dr-text` |
| 115 | `text-[10px]` | SIZE | MEDIUM | "PHASE DEBRIEF" | `text-xs` |
| 118 | `text-dr-muted text-xs` | CONTRAST+SIZE | HIGH | Debrief text | `text-dr-text text-sm` |
| 133 | `text-[10px]` | SIZE | MEDIUM | StatCard label | `text-xs` |

#### `src/components/campaign/mission-card.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 64 | `text-xs text-dr-dim` | CONTRAST+SIZE | HIGH | Asset codename | `text-sm text-dr-muted` |
| 72 | `text-[10px]` | SIZE | MEDIUM | Status badge | `text-xs` |
| 78 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | HIGH | Duration/tokens | `text-xs text-dr-muted` |

#### `src/components/campaign/phase-timeline.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 78 | `text-xs text-dr-dim` | CONTRAST+SIZE | HIGH | Phase label | `text-dr-muted` |
| 94 | `text-xs text-dr-muted` | CONTRAST | HIGH | Phase objective | `text-sm text-dr-text` |
| 101 | `text-xs text-dr-dim` | CONTRAST+SIZE | HIGH | Metrics row | `text-dr-muted text-sm` |
| 115 | `text-[10px]` | SIZE | MEDIUM | "PHASE DEBRIEF" | `text-xs` |
| 150 | `text-xs text-dr-dim` | CONTRAST+SIZE | HIGH | "DEBRIEF" text | `text-dr-muted` |
| 153 | `text-sm text-dr-muted` | CONTRAST | HIGH | Debrief content | `text-dr-text` |

#### `src/components/campaign/plan-editor.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 120 | `text-xs` | SIZE | MEDIUM | Textarea in InlineEdit | `text-sm` |
| 138 | `text-xs` | SIZE | MEDIUM | Input in InlineEdit | `text-sm` |
| 151 | `text-dr-dim` | CONTRAST | HIGH | Placeholder in InlineEdit | `text-dr-muted` |
| 251 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | "BRIEFING" toggle | `text-xs text-dr-muted` |
| 260 | `text-xs` | SIZE | MEDIUM | Mission briefing textarea | `text-sm` |
| 266 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | "ASSET" label | `text-xs text-dr-muted` |
| 272 | `text-xs` | SIZE | MEDIUM | Asset select | `text-sm` |
| 285 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | "PRIORITY" label | `text-xs text-dr-muted` |
| 291 | `text-xs` | SIZE | MEDIUM | Priority select | `text-sm` |
| 303 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | "DEPS" label | `text-xs text-dr-muted` |
| 309 | `text-dr-muted text-[10px]` | CONTRAST+SIZE | MEDIUM | Dependency tags | `text-xs text-dr-text` |
| 345 | `text-xs` | SIZE | MEDIUM | Dependency option text | `text-sm` |
| 351 | `text-xs text-dr-dim` | CONTRAST+SIZE | MEDIUM | "No available missions" | `text-xs text-dr-muted` |
| 380 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | Asset codename overlay | `text-xs text-dr-muted` |
| 453 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | Phase label | `text-xs text-dr-muted` |
| 464 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | Mission count | `text-xs text-dr-muted` |
| 488 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | "OBJECTIVE" label | `text-xs text-dr-muted` |
| 496 | `text-xs text-dr-muted` | CONTRAST | HIGH | Objective input | `text-sm text-dr-text` |
| 520-524 | `text-xs` | SIZE | MEDIUM | "+ ADD MISSION" button | `text-sm` |
| 547 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | Phase overlay label | `text-xs text-dr-muted` |
| 553 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | Phase overlay count | `text-xs text-dr-muted` |
| 822 | `text-[10px]` | SIZE | MEDIUM | "UNSAVED CHANGES" | `text-xs` |
| 829 | `text-xs` | SIZE | MEDIUM | Save error message | `text-sm` |
| 846 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | MEDIUM | "PLAN SUMMARY" label | `text-xs text-dr-muted` |
| 856 | `text-xs` | SIZE | MEDIUM | Plan summary textarea | `text-sm` |
| 899 | `text-xs` | SIZE | MEDIUM | "+ ADD PHASE" button | `text-sm` |

---

### Mission Components

#### `src/components/mission/mission-comms.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 122 | `text-xs` | SIZE | MEDIUM | Token stats grid | `text-sm` |
| 124 | `text-dr-dim` | CONTRAST | HIGH | "INPUT" label | `text-dr-muted` |
| 130 | `text-dr-dim` | CONTRAST | HIGH | "OUTPUT" label | `text-dr-muted` |
| 136 | `text-dr-dim` | CONTRAST | HIGH | "CACHE" label | `text-dr-muted` |
| 144 | `text-dr-dim` | CONTRAST | HIGH | "DURATION" label | `text-dr-muted` |
| 150 | `text-dr-dim` | CONTRAST | HIGH | "COST" label | `text-dr-muted` |
| 274 | `text-dr-dim font-data text-xs` | CONTRAST+SIZE | HIGH | Override description | `text-dr-muted text-sm` |

#### `src/components/mission/mission-actions.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 274 | `text-dr-dim font-data text-xs` | CONTRAST+SIZE | HIGH | Override description | `text-dr-muted text-sm` |

---

### General Components

#### `src/components/general/general-chat.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 147 | `text-dr-muted` | CONTRAST | MEDIUM | Descriptive text | `text-dr-text` |
| 177 | `text-dr-muted` | CONTRAST | MEDIUM | Inactive tab text | `text-neutral-400` |
| 186 | `text-dr-dim` + `text-[10px]` | CONTRAST+SIZE | HIGH | Close button | `text-dr-muted text-xs` |
| 194 | `text-dr-dim` | CONTRAST | MEDIUM | "+" button | `text-dr-muted` |
| 203 | `text-dr-dim` | CONTRAST | MEDIUM | Help button | `text-dr-muted` |
| 239 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | HIGH | "BATTLEFIELD LINKED" badge | `text-xs text-dr-muted` |
| 282 | `text-[10px]` | SIZE | HIGH | "GENERAL" label | `text-xs` |
| 294 | `text-dr-dim` | CONTRAST | MEDIUM | "GENERAL is thinking..." | `text-dr-muted` |
| 364 | `text-[11px] text-dr-dim` | CONTRAST+SIZE | HIGH | System message | `text-xs text-dr-text` |
| 376 | `text-[10px]` | SIZE | HIGH | Role labels (COMMANDER/GENERAL) | `text-xs` |

#### `src/components/general/new-session-modal.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 57 | `text-dr-muted` | CONTRAST | MEDIUM | Form label | `text-dr-text` |
| 69-70 | `text-dr-muted` + `text-dr-dim` | CONTRAST | HIGH | Label + hint text | `text-dr-text` / `text-dr-muted` |

#### `src/components/general/command-reference.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 24 | `text-dr-dim` | CONTRAST | MEDIUM | Close button | `text-dr-muted` |
| 32,44,56 | `text-[10px] text-dr-muted` | CONTRAST+SIZE | HIGH | Section headers | `text-xs text-dr-text` |
| 72 | `text-[11px] text-dr-dim` | CONTRAST+SIZE | HIGH | Command descriptions | `text-xs text-dr-muted` |

---

### Battlefield Components

#### `src/components/battlefield/create-battlefield.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 149 | `text-dr-dim text-xs` | CONTRAST+SIZE | MEDIUM | Repo path display | `text-dr-muted text-sm` |
| 228 | `text-dr-dim` | CONTRAST | MEDIUM | "Skip bootstrap" link | `text-dr-muted` |
| 247 | `text-dr-dim text-xs` | CONTRAST+SIZE | MEDIUM | Helper text | `text-dr-muted` |

#### `src/components/battlefield/bootstrap-review.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 201 | `text-dr-dim` | CONTRAST | HIGH | Status line | `text-dr-muted` |

#### `src/components/battlefield/bootstrap-comms.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 38 | `text-dr-muted text-xs` | CONTRAST+SIZE | MEDIUM | Breadcrumb | `text-dr-text` |
| 42 | `text-dr-dim` | CONTRAST | MEDIUM | Status message | `text-dr-muted` |

#### `src/components/battlefield/bootstrap-error.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 64 | `text-dr-dim` | CONTRAST | MEDIUM | Error context | `text-dr-muted` |
| 68 | `text-dr-muted` | CONTRAST | MEDIUM | Debrief text | `text-dr-text` |

#### `src/components/battlefield/scaffold-output.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 50 | `text-dr-dim text-xs` | CONTRAST+SIZE | MEDIUM | Separator | `text-dr-muted` |

#### `src/components/battlefield/scaffold-retry.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 31 | `text-dr-dim` | CONTRAST | MEDIUM | Separator | `text-dr-muted` |
| 35 | `text-dr-muted` | CONTRAST | MEDIUM | Error description | `text-dr-text` |

---

### Asset Components

#### `src/components/asset/asset-list.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 134 | `text-dr-dim text-xs` | CONTRAST+SIZE | MEDIUM | Empty state | `text-dr-muted text-sm` |
| 158 | `text-xs` | SIZE | MEDIUM | Specialty text | `text-sm` |
| 161 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | HIGH | Model label | `text-xs text-dr-muted` |
| 166 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | HIGH | "Missions completed" | `text-xs text-dr-muted` |
| 178,186 | `text-[10px]` | SIZE | HIGH | EDIT/DELETE buttons | `text-xs` |

#### `src/components/asset/asset-form.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 75,87,99,111 | `text-[10px] text-dr-muted` | CONTRAST+SIZE | HIGH | All form labels | `text-xs text-dr-text` |

---

### UI Primitives

#### `src/components/ui/terminal.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 25 | `text-dr-muted` | CONTRAST | HIGH | Log type styles | `text-neutral-300` |
| 88 | `text-dr-dim` | CONTRAST | HIGH | Timestamp | `text-neutral-400` |
| 94 | `text-dr-dim` | CONTRAST | HIGH | Repeat count | `text-neutral-400` |

#### `src/components/ui/tac-button.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 13 | `text-dr-muted` | CONTRAST | HIGH | Ghost variant default text | `text-neutral-200` |

#### `src/components/ui/tac-input.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 10 | `placeholder:text-dr-dim` | CONTRAST | MEDIUM | Input placeholder | `placeholder:text-neutral-500` |
| 27 | `placeholder:text-dr-dim` | CONTRAST | MEDIUM | Textarea placeholder | `placeholder:text-neutral-500` |

#### `src/components/ui/tac-textarea-with-images.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 124 | `placeholder:text-dr-dim` | CONTRAST | MEDIUM | Placeholder text | `placeholder:text-neutral-500` |
| 133 | `text-dr-dim text-[10px]` | CONTRAST+SIZE | HIGH | "Paste or drop images" | `text-neutral-400 text-xs` |

#### `src/components/ui/tac-select.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 29 | `data-placeholder:text-dr-dim` | CONTRAST | MEDIUM | Select placeholder | `data-placeholder:text-neutral-500` |

#### `src/components/ui/markdown.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 81 | `text-dr-muted` | CONTRAST | HIGH | List items | `text-dr-text` |
| 99 | `text-dr-muted` | CONTRAST | HIGH | Blockquote text | `text-dr-text` |

#### `src/components/ui/modal.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 64 | `text-dr-muted font-data text-xs` | CONTRAST+SIZE | HIGH | Modal description | `text-neutral-300 text-sm` |

#### `src/components/ui/dropdown-menu.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 68 | `text-xs text-muted-foreground` | CONTRAST+SIZE | MEDIUM | Group labels | `text-sm text-foreground` |

#### `src/components/ui/select.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 105 | `text-xs text-muted-foreground` | CONTRAST+SIZE | MEDIUM | Group labels | `text-sm text-foreground` |

#### `src/components/ui/tabs.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 27,61 | `text-muted-foreground` | CONTRAST | MEDIUM | Inactive tab text | Needs lighter muted token |

---

### Git Components

#### `src/components/git/git-status.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 102 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "No staged files" | `text-neutral-400 text-sm` |
| 127 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "No modified files" | `text-neutral-400 text-sm` |
| 165 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "No untracked files" | `text-neutral-400 text-sm` |
| 233 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | File count in header | `text-neutral-400` |

#### `src/components/git/git-log.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 50 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "No commits found" | `text-neutral-400 text-sm` |
| 71 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Commit author | `text-neutral-400` |
| 74 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Relative time | `text-neutral-400` |

#### `src/components/git/git-branches.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 93 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Branch count | `text-neutral-400` |
| 96 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "No local branches" | `text-neutral-400 text-sm` |
| 109 | `text-dr-dim` | CONTRAST | HIGH | Inactive branch indicator | `text-neutral-500` |

#### `src/components/git/git-diff.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 21 | `text-dr-dim` | CONTRAST | HIGH | Context diff lines | `text-neutral-400` |

---

### Console Components

#### `src/components/console/dev-server-panel.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 69 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Stopped status | `text-neutral-400 text-sm` |
| 75 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | PID display | `text-neutral-400` |
| 78 | `text-dr-muted text-xs` | CONTRAST+SIZE | HIGH | Port display | `text-neutral-300 text-sm` |
| 115 | `text-dr-dim` | CONTRAST | HIGH | CMD/UPTIME labels | `text-neutral-400` |
| 116 | `text-dr-muted` | CONTRAST | HIGH | Command display value | `text-neutral-200` |
| 118 | `text-dr-muted` | CONTRAST | HIGH | Uptime value | `text-neutral-200` |

#### `src/components/console/command-output.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 33 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "LIVE OUTPUT" label | `text-neutral-400 text-sm` |
| 47 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "No active output" | `text-neutral-400 text-sm` |
| 57 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | "HISTORY" label | `text-neutral-400` |
| 76 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Relative time | `text-neutral-400` |
| 82 | `text-dr-muted text-xs` | CONTRAST+SIZE | HIGH | Command output text | `text-neutral-200 text-sm` |

---

### Config / Schedule / Warroom Components

#### `src/components/config/config-form.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 192,205,218,231,248,261,290,300,310,332 | `text-dr-dim` | CONTRAST | MEDIUM | All form labels (10 instances) | `text-neutral-400` |
| 303 | `text-dr-dim opacity-60` | CONTRAST | HIGH | Read-only field with extra opacity | Remove opacity; use `text-neutral-400` |
| 314,336 | `text-dr-muted` | CONTRAST | HIGH | Path display values | `text-neutral-200` |
| 398,415 | `text-dr-muted text-xs` | CONTRAST+SIZE | HIGH | Action descriptions | `text-neutral-300 text-sm` |
| 439 | `text-dr-dim` | CONTRAST | HIGH | Loading text | `text-neutral-400` |

#### `src/components/schedule/schedule-list.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 121 | `text-dr-dim text-sm` | CONTRAST | HIGH | Empty state | `text-neutral-400` |
| 161 | `text-dr-muted text-xs` | CONTRAST+SIZE | HIGH | Cron description | `text-neutral-300 text-sm` |
| 164 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Task stats | `text-neutral-400` |
| 175 | `text-dr-dim text-[10px]` | CONTRAST+SIZE | HIGH | "Next:" label | `text-neutral-400 text-xs` |

#### `src/components/schedule/schedule-form.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 142,155,171,210,223,243,264 | `text-dr-muted text-xs` | CONTRAST+SIZE | HIGH | All form labels (7 instances) | `text-neutral-300 text-sm` |

#### `src/components/warroom/boot-sequence.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 59 | `text-dr-dim` | CONTRAST | MEDIUM | "NYHZ OPS" header | `text-neutral-400` |
| 65 | `text-dr-dim` | CONTRAST | MEDIUM | Subtitle | `text-neutral-400` |
| 81 | `text-dr-muted text-sm` | CONTRAST | HIGH | Boot step labels | `text-neutral-300` |

---

### App Pages

#### `src/app/loading.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 4 | `text-dr-dim font-tactical text-xs` | CONTRAST+SIZE | HIGH | "LOADING..." text | `text-dr-muted text-sm` |

#### `src/app/error.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 48 | `text-dr-dim font-tactical text-xs` | CONTRAST+SIZE | HIGH | "ERROR DETAILS" summary | `text-dr-text text-sm` |
| 51 | `text-dr-dim font-mono text-xs` | CONTRAST+SIZE | HIGH | Error detail content | `text-dr-muted text-sm` |

#### `src/app/(hq)/page.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 74 | `text-dr-dim font-tactical text-xs` | CONTRAST+SIZE | HIGH | Metadata text | `text-dr-muted text-sm` |
| 137 | `text-dr-muted font-tactical text-xs` | CONTRAST+SIZE | MEDIUM | Description | `text-dr-text text-sm` |
| 160 | `text-dr-dim font-tactical text-xs` | CONTRAST+SIZE | HIGH | Empty state | `text-dr-muted text-sm` |
| 178-189 | `text-[10px] text-dr-dim/muted` | CONTRAST+SIZE | HIGH | Mission metadata (multiple) | `text-xs text-dr-muted` |

#### `src/app/(hq)/captain-log/page.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 19 | `text-xs text-dr-muted` | CONTRAST+SIZE | MEDIUM | Stats text | `text-sm text-dr-text` |
| 26-45 | `text-dr-muted` (6x) | CONTRAST | MEDIUM | Stats labels | `text-dr-text` |
| 33 | `text-dr-dim` | CONTRAST | HIGH | Percentage text | `text-dr-muted` |
| 53,56 | `text-dr-dim` | CONTRAST | HIGH | Empty state | `text-dr-muted` |
| 71 | `text-dr-dim` | CONTRAST | HIGH | Timestamp | `text-dr-muted` |
| 90,102,112 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | HIGH | Section labels | `text-xs text-dr-muted` |
| 93 | `text-xs text-dr-muted` | CONTRAST+SIZE | HIGH | Question text | `text-sm text-dr-text` |
| 115 | `text-xs text-dr-dim italic` | CONTRAST+SIZE | HIGH | Reasoning text | `text-sm text-dr-muted` |
| 137 | `text-[10px]` | SIZE | MEDIUM | Confidence badge | `text-xs` |

#### `src/app/(hq)/logistics/page.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 46 | `text-xs text-dr-muted` | CONTRAST+SIZE | MEDIUM | Stats text | `text-sm text-dr-text` |
| 53,57,63,69 | `text-[10px] text-dr-dim` | CONTRAST+SIZE | HIGH | Stats labels (4x) | `text-xs text-dr-muted` |
| 96-104 | `text-dr-muted/dim` | CONTRAST | HIGH | Rate limit section | `text-dr-text` |
| 131,164,198 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Empty states | `text-dr-muted text-sm` |
| 135,146,168,179 | `text-dr-dim` | CONTRAST | HIGH | Table headers/data | `text-dr-text` |
| 242 | `text-[10px] text-dr-muted` | CONTRAST+SIZE | HIGH | Legend text | `text-xs text-dr-text` |
| 265-280 | `text-dr-muted` (4x) | CONTRAST | MEDIUM | Status labels | `text-dr-text` |

#### `src/app/(hq)/battlefields/[id]/page.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 105,116,119 | `text-dr-dim` | CONTRAST | HIGH | Various dim text | `text-dr-muted` |
| 137 | `text-dr-muted text-xs` | CONTRAST+SIZE | MEDIUM | Description | `text-dr-text text-sm` |
| 160 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Empty state | `text-dr-muted text-sm` |
| 180 | `text-dr-muted text-xs` | CONTRAST+SIZE | MEDIUM | Cost summary | `text-sm` |
| 199 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Token summary | `text-dr-muted text-sm` |

#### `src/app/(hq)/battlefields/[id]/missions/[missionId]/page.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 45,51-54 | `text-dr-muted` (4x) | CONTRAST | MEDIUM | Status bar labels | `text-dr-text` |
| 108 | `text-dr-dim` | CONTRAST | HIGH | Timestamp | `text-dr-muted` |
| 112,123 | `text-[10px]` | SIZE | MEDIUM | Confidence badge | `text-xs` |
| 129 | `text-xs text-dr-muted` | CONTRAST+SIZE | HIGH | Question text | `text-sm text-dr-text` |
| 139 | `text-xs text-dr-dim italic` | CONTRAST+SIZE | HIGH | Reasoning text | `text-sm text-dr-muted` |

#### `src/app/(hq)/battlefields/[id]/git/page.tsx`

| Line | Classes | Cat | Sev | Issue | Fix |
|------|---------|-----|-----|-------|-----|
| 33 | `text-dr-dim text-xs` | CONTRAST+SIZE | HIGH | Branch info | `text-dr-muted text-sm` |
| 43,50,57 | `text-dr-muted text-xs` | CONTRAST+SIZE | MEDIUM | Tab labels (3x) | `text-sm text-dr-text` |

---

## Recommendations for Phase 2 (Fixes)

### Priority 1: Theme-level fix (highest impact, lowest effort)
Update `globals.css`:
- Change `--color-dr-muted` from `#6a6a7a` to `#8a8a9a` (or similar ~5:1 contrast)
- Change `--color-dr-dim` from `#4a4a5a` to `#6a6a7a` (or reserve for non-text use)
- Change `--muted-foreground` to match the new `--color-dr-muted`
- This single change fixes ~60% of all violations automatically

### Priority 2: Replace `text-[10px]` globally (~25 instances)
- Search-and-fix all `text-[10px]` → `text-xs`
- Search-and-fix all `text-[11px]` → `text-xs`

### Priority 3: Upgrade critical `text-xs` to `text-sm`
Focus on:
- Empty state messages
- Form labels
- Error messages
- Navigation items
- Button labels (non-decorative)

### Priority 4: Remove opacity modifiers on text
- `opacity-60` on text elements (config-form.tsx:303)
- Any `text-white/30`, `text-white/40` patterns

### Priority 5: Component-specific contrast fixes
For components where `text-dr-dim` is used intentionally for hierarchy, replace with the updated `text-dr-muted` or `text-dr-text` as appropriate.

---

## Debrief

Commander,

Recon complete. The DEVROOM interface has **systemic accessibility failures** across the entire UI. Two root causes account for the vast majority of issues:

1. **The `text-dr-dim` token (#4a4a5a) fails WCAG AA on every dark background in the app.** It's used ~80+ times across the codebase for labels, metadata, empty states, timestamps, and even interactive elements. Contrast ratio is ~2.5-2.7:1 — well below the 4.5:1 minimum.

2. **Arbitrary small text sizes (`text-[10px]`, `text-[11px]`) are used ~25+ times** for labels, badges, form elements, and role identifiers that should be at minimum 12px.

The most impactful fix is a **theme-level adjustment** — bumping `--color-dr-muted` and `--color-dr-dim` to lighter values in `globals.css` would instantly resolve ~60% of contrast violations without touching individual components.

**Risk assessment:** The current state makes the app difficult to use in normal lighting conditions, especially on non-retina displays. Sidebar navigation, empty states, form labels, terminal output, and metadata throughout the app are functionally unreadable for users with even mild visual impairment.

**Recommended next action:** Execute Phase 2 — apply the theme-level fix first, then sweep through the `text-[10px]` instances and critical `text-xs` upgrades.

— OPERATIVE
