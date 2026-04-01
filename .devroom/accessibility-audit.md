# Accessibility Audit — Contrast and Size Violations

**Date**: 2026-03-28
**Scope**: Entire DEVROOM UI (`src/components/`, `src/app/`, `globals.css`)
**Type**: READ-ONLY audit — no code modifications

---

## Executive Summary

**Total violations found: ~130+**

| Category | Count | Severity Breakdown |
|----------|-------|--------------------|
| Contrast (muted/dim text on dark backgrounds) | ~80 | HIGH: ~50, MEDIUM: ~30 |
| Text size (below minimum thresholds) | ~30 | HIGH: ~20, MEDIUM: ~10 |
| Icon size (below 16px) | ~15 | HIGH: ~8, MEDIUM: ~7 |
| Opacity-based contrast reduction | ~5 | MEDIUM: ~5 |

---

## Theme Token Analysis (`globals.css`)

The root cause of most contrast violations is two theme tokens:

| Token | Hex Value | RGB Average | Used For |
|-------|-----------|-------------|----------|
| `--color-dr-dim` | `#4a4a5a` | ~79.5 | Labels, timestamps, secondary text |
| `--color-dr-muted` | `#6a6a7a` | ~106.75 | Metadata, placeholders, section headers |

These are rendered against very dark backgrounds:

| Token | Hex Value |
|-------|-----------|
| `--color-dr-bg` | `#0a0a0c` |
| `--color-dr-surface` | `#111114` |
| `--color-dr-elevated` | `#1a1a22` |

**Contrast ratios** (approximate):
- `dr-dim` (#4a4a5a) on `dr-bg` (#0a0a0c): **~2.8:1** — fails WCAG AA (requires 4.5:1 for normal text)
- `dr-muted` (#6a6a7a) on `dr-bg` (#0a0a0c): **~4.0:1** — fails WCAG AA for normal text, passes for large text only
- `dr-muted` on `dr-surface` (#111114): **~3.7:1** — fails WCAG AA

**Font size overrides** in globals.css (1440p scaling):
- `text-xs`: 14px → acceptable minimum for labels
- `text-sm`: 16px → acceptable body text
- Arbitrary sizes (`text-[10px]`, `text-[11px]`, `text-[8px]`) bypass these overrides

---

## Violations by File

### `src/components/console/command-output.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 33 | `text-dr-dim text-xs font-tactical tracking-wider` | CONTRAST+SIZE | HIGH | Dim label text |
| 47 | `text-dr-dim text-xs font-data py-4 text-center` | CONTRAST | HIGH | Empty state message |
| 57 | `text-dr-dim text-xs font-tactical tracking-wider` | CONTRAST+SIZE | HIGH | Dim label text |
| 76 | `text-dr-dim text-xs font-data` | CONTRAST | HIGH | Dim data text |
| 82 | `text-dr-muted text-xs font-data` | CONTRAST | MEDIUM | Muted output text |

**Fix**: Replace `text-dr-dim` → `text-dr-text` for body content; keep `text-dr-muted` for timestamps only.

---

### `src/components/console/dev-server-panel.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 69 | `text-dr-dim text-xs font-tactical` | CONTRAST | HIGH | Panel label |
| 75 | `text-dr-dim text-xs font-data` | CONTRAST | HIGH | Panel data |
| 78 | `text-dr-muted text-xs font-data` | CONTRAST | MEDIUM | Secondary label |

---

### `src/components/campaign/plan-editor.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 236 | `h-2 w-2 shrink-0 rounded-full` | SIZE | HIGH | Status dot too small |
| 251 | `text-left text-[10px] text-dr-dim uppercase` | CONTRAST+SIZE | HIGH | 10px dim label |
| 309 | `text-dr-muted text-[10px]` | CONTRAST+SIZE | HIGH | 10px muted text |
| 377 | `h-2 w-2 shrink-0 rounded-full` | SIZE | HIGH | Status dot too small |
| 496 | `text-xs text-dr-muted` | CONTRAST | MEDIUM | Muted helper text |

---

### `src/components/campaign/campaign-results.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 77 | `text-dr-dim font-tactical text-[10px] tracking-wider mr-2` | CONTRAST+SIZE | HIGH | 10px dim label |
| 115 | `text-dr-dim font-tactical text-[10px] tracking-wider` | CONTRAST+SIZE | HIGH | 10px dim interactive text |
| 133 | `text-dr-dim font-tactical text-[10px] tracking-wider mt-1` | CONTRAST+SIZE | HIGH | 10px dim label |

---

### `src/components/campaign/briefing-chat.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 107 | `w-1.5 h-3 bg-dr-amber/70 animate-pulse` | SIZE | HIGH | Cursor indicator too narrow (6px) |

---

### `src/components/campaign/mission-card.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 54 | `mt-1.5 h-2 w-2 shrink-0 rounded-full` | SIZE | HIGH | Status dot 8px |

---

### `src/components/general/general-chat.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 147 | `text-dr-muted font-mono text-sm` | CONTRAST | MEDIUM | Muted chat metadata |
| 186 | `text-dr-dim hover:text-dr-red ml-1 text-[10px]` | CONTRAST+SIZE | HIGH | 10px dim delete action |
| 239 | `text-dr-dim font-mono text-[10px]` | CONTRAST+SIZE | HIGH | 10px dim timestamp |
| 364 | `text-dr-dim font-mono text-[11px] tracking-widest` | CONTRAST+SIZE | HIGH | 11px dim text |

---

### `src/components/general/command-reference.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 32, 44, 56 | `text-dr-muted font-tactical text-[10px] tracking-widest uppercase` | CONTRAST+SIZE | MEDIUM | 10px muted section headers |
| 72 | `text-dr-dim font-mono text-[11px]` | CONTRAST+SIZE | HIGH | 11px dim code text |

---

### `src/components/general/new-session-modal.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 57, 69 | `text-dr-muted font-tactical text-xs block mb-1` | CONTRAST | MEDIUM | Muted form labels |

---

### `src/components/asset/asset-list.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 107 | `text-dr-muted font-data text-xs` | CONTRAST | MEDIUM | Muted metadata |
| 161 | `text-dr-dim font-tactical text-[10px] mb-2` | CONTRAST+SIZE | HIGH | 10px dim label |
| 166 | `text-dr-dim font-tactical text-[10px] uppercase tracking-wider` | CONTRAST+SIZE | HIGH | 10px dim section header |

---

### `src/components/asset/asset-deployment.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 66 | `text-dr-dim font-tactical text-[10px]` | CONTRAST+SIZE | HIGH | 10px dim interactive link |
| 76 | `text-dr-dim font-data text-[10px] text-center` | CONTRAST+SIZE | HIGH | 10px dim empty state |
| 96 | `text-dr-dim font-data text-[10px] truncate` | CONTRAST+SIZE | HIGH | 10px dim truncated text |

---

### `src/components/asset/asset-form.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 75, 87, 99, 111 | `text-dr-muted font-tactical text-[10px] tracking-wider uppercase mb-1` | CONTRAST+SIZE | MEDIUM | 10px muted form labels (x4) |

---

### `src/components/layout/sidebar.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 51 | `text-dr-muted text-sm` | CONTRAST | MEDIUM | Muted sidebar text |
| 84 | `text-xs` with muted color | SIZE | MEDIUM | Small section header |
| 89 | `text-dr-muted text-sm` | CONTRAST | MEDIUM | Muted sidebar empty state |

---

### `src/components/layout/intel-bar.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 158 | `text-xs` notification count | SIZE | MEDIUM | Small counter text |
| 164 | `text-xs` empty state | SIZE | MEDIUM | Small empty state text |
| 186 | `w-1.5 h-1.5 bg-dr-amber rounded-full` | SIZE | HIGH | 6px indicator dot |

---

### `src/components/layout/page-header.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 12 | `text-xs` breadcrumb labels | SIZE | MEDIUM | Small breadcrumb text |

---

### `src/components/schedule/schedule-list.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 139 | `inline-block w-2 h-2 rounded-full` | SIZE | HIGH | 8px status dot |
| 175 | `text-dr-dim font-tactical text-[10px] uppercase tracking-wider` | CONTRAST+SIZE | HIGH | 10px dim label |

---

### `src/components/schedule/schedule-form.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 142, 155, 171, 210, 223, 243, 264 | `text-dr-muted font-tactical text-xs uppercase tracking-wider mb-1` | CONTRAST | MEDIUM | Muted form labels (x7) |

---

### `src/components/config/config-form.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 192, 205, 218, 231, 248, 261, 290, 300, 310, 332 | `text-xs` form labels | SIZE | MEDIUM | Small form labels (x10) |
| 398, 415 | `text-dr-muted font-data text-xs mt-0.5` | CONTRAST | MEDIUM | Muted helper text |

---

### `src/components/battlefield/create-battlefield.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 116, 125, 139, 149, 157, 170, 185, 201, 212, 228, 238 | `text-xs` form labels | SIZE | MEDIUM | Small form labels (x11) |

---

### `src/components/git/git-branches.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 93, 96 | `text-xs` branch count, empty state | SIZE | MEDIUM | Small text for content |

---

### `src/components/git/git-log.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 50, 71, 74 | `text-xs` empty state, commit info | SIZE | MEDIUM | Small text |

---

### `src/components/mission/mission-actions.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 274 | `text-xs` mission description | SIZE | MEDIUM | Small description text |

---

### `src/components/dashboard/deploy-mission.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 114, 130 | `disabled:opacity-50 disabled:cursor-not-allowed` | CONTRAST | MEDIUM | Opacity reduces contrast |
| 130 | `text-dr-dim font-tactical text-xs` | CONTRAST | MEDIUM | Dim interactive text |

---

### `src/components/ui/tac-input.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 10, 27 | `placeholder:text-dr-dim` | CONTRAST | MEDIUM | Dim placeholder text |
| 12, 29 | `disabled:opacity-50` | CONTRAST | MEDIUM | Opacity-based disabled state |

---

### `src/components/ui/tac-textarea-with-images.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 124 | `placeholder:text-dr-dim` | CONTRAST | MEDIUM | Dim placeholder text |
| 126 | `disabled:opacity-50` | CONTRAST | MEDIUM | Opacity-based disabled state |
| 133 | `text-dr-dim font-tactical text-[10px] tracking-wider` | CONTRAST+SIZE | HIGH | 10px dim label |

---

### `src/components/ui/tac-button.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 28 | `disabled:opacity-50` | CONTRAST | MEDIUM | Opacity-based disabled state |

---

### `src/app/(hq)/overseer-log/page.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 19, 26, 31, 37, 41, 45, 93 | `text-dr-muted` various elements | CONTRAST | HIGH | Muted text throughout page |
| 33, 53, 56, 71, 90, 102, 112, 115 | `text-dr-dim` various elements | CONTRAST | HIGH | Dim text throughout page |
| 90, 102, 112, 137 | `text-[10px]` labels | SIZE | HIGH | 10px text labels |

---

### `src/app/(hq)/page.tsx` (HQ Dashboard)

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 74, 160, 178, 187 | `text-dr-dim` various elements | CONTRAST | HIGH | Dim dashboard text |
| 137, 183 | `text-dr-muted` | CONTRAST | HIGH | Muted dashboard labels |
| 178, 183, 187 | `text-[10px]` | SIZE | HIGH | 10px text on dashboard |

---

### `src/app/(hq)/logistics/page.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 46, 96, 100, 146, 147, 179, 180, 242, 265, 270, 275, 280 | `text-dr-muted` | CONTRAST | HIGH | Muted text (12 instances) |
| 53, 57, 63, 69, 104, 117, 131 | `text-dr-dim` | CONTRAST | HIGH | Dim text (7 instances) |
| 53, 57, 63, 69, 242 | `text-[10px]` | SIZE | HIGH | 10px labels |
| 88-89 | `text-[8px]` status indicators | SIZE | **CRITICAL** | 8px text — smallest in codebase |
| 244, 247, 250 | `w-2 h-2` legend dots | SIZE | MEDIUM | 8px chart legend dots |

---

### `src/app/(hq)/battlefields/[id]/page.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 180 | `text-dr-muted` | CONTRAST | HIGH | Muted battlefield label |

---

### `src/app/(hq)/battlefields/[id]/git/page.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 33 | `text-dr-dim` | CONTRAST | HIGH | Dim tab text |
| 44, 50, 56 | `text-dr-muted text-xs` | CONTRAST | HIGH | Muted tab trigger labels |

---

### `src/app/(hq)/battlefields/[id]/campaigns/page.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 75 | `text-dr-muted` | CONTRAST | MEDIUM | Muted campaign label |
| 81 | `text-dr-dim text-[10px]` | CONTRAST+SIZE | HIGH | 10px dim text |

---

### `src/app/(hq)/battlefields/[id]/missions/[missionId]/page.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 45, 51, 129 | `text-dr-muted` | CONTRAST | MEDIUM | Muted mission metadata |
| 112, 123 | `text-[10px]` | SIZE | HIGH | 10px labels |

---

### `src/app/error.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 48, 51 | `text-dr-dim` | CONTRAST | HIGH | Dim error page text |

---

### `src/app/loading.tsx`

| Line | Classes | Category | Severity | Issue |
|------|---------|----------|----------|-------|
| 4 | `text-dr-dim` | CONTRAST | MEDIUM | Dim loading text |

---

## Recommended Fixes (Priority Order)

### 1. CRITICAL — Fix Theme Tokens in `globals.css`

The most impactful fix: brighten the two problematic tokens.

| Token | Current | Suggested | Contrast on #0a0a0c |
|-------|---------|-----------|---------------------|
| `--color-dr-dim` | `#4a4a5a` | `#8a8a9a` | ~5.2:1 (passes AA) |
| `--color-dr-muted` | `#6a6a7a` | `#9a9aaa` | ~6.5:1 (passes AA) |

This single change fixes ~80% of all contrast violations instantly.

### 2. HIGH — Eliminate `text-[10px]` and `text-[8px]`

Replace all arbitrary small sizes:
- `text-[8px]` → `text-xs` (14px with override) or use icon
- `text-[10px]` → `text-xs` (14px with override)
- `text-[11px]` → `text-xs` (14px with override)

~30 instances across the codebase.

### 3. HIGH — Increase Status Indicator Dots

All status dots should be minimum `w-3 h-3` (12px):
- `w-1.5 h-1.5` → `w-3 h-3`
- `w-2 h-2` → `w-3 h-3`
- `w-1.5 h-3` → `w-3 h-4`

~8 instances.

### 4. MEDIUM — Replace `disabled:opacity-50` Pattern

Use color-based disabled states instead:
- `disabled:opacity-50` → `disabled:text-dr-muted disabled:bg-dr-surface`

~5 instances across UI primitives.

### 5. MEDIUM — Upgrade `placeholder:text-dr-dim`

- `placeholder:text-dr-dim` → `placeholder:text-dr-muted` (after muted is brightened)

~4 instances in input components.

---

## Files Requiring Most Changes (Ranked)

1. `src/app/(hq)/logistics/page.tsx` — 25+ violations
2. `src/app/(hq)/overseer-log/page.tsx` — 15+ violations
3. `src/app/(hq)/page.tsx` — 8+ violations
4. `src/components/campaign/plan-editor.tsx` — 5 violations
5. `src/components/general/general-chat.tsx` — 4 violations
6. `src/components/asset/asset-deployment.tsx` — 3 violations
7. `src/components/console/command-output.tsx` — 5 violations
8. `src/components/campaign/campaign-results.tsx` — 3 violations
9. `src/components/config/config-form.tsx` — 12 violations (mostly SIZE)
10. `src/components/battlefield/create-battlefield.tsx` — 11 violations (mostly SIZE)
