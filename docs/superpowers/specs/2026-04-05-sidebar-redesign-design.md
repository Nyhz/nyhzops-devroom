# Sidebar Redesign

## Problem

The sidebar has 15+ navigation items across 5 sections, causing vertical overflow on 1080p monitors and excessive visual weight. The OPS TOOLS section (7 items) is the main offender. The battlefield selector dropdown has a bug that prevents it from showing the selected battlefield name. Intel Briefing, Logistics, and Config are redundant with elements already present elsewhere in the UI.

## Goals

- Fit all navigation items on a 1080p screen without scrolling (collapsed state)
- Reduce visual weight by removing redundant items and collapsing secondary tools
- Fix the battlefield selector to show the active battlefield name prominently
- Move Config to a gear icon on the battlefield selector row

## Design

### Battlefield Selector

Replace the current `TacSelect` dropdown with a custom compact selector row:

- **Layout:** Flex row with select element (~80% width) and a separate gear button (30px square)
- **Select closed state:** Status dot (green = active, dim = archived) + bold battlefield codename + dropdown arrow (▾)
- **Select open state:** Inline dropdown pushes sidebar content down, shows all battlefields with status dots, selected one highlighted in amber. Dropdown aligns with select width only (not under gear button)
- **Gear button:** Separate bordered button to the right of the select. Navigates to `/battlefields/[id]/config`. Hover state: amber text + amber border + subtle amber background
- **Bug fix:** Change `segments.indexOf("projects")` to `segments.indexOf("battlefields")` in `battlefield-selector.tsx` line 23

### Navigation Structure (top to bottom)

1. **HQ** (◉) — global, href: `/`
2. **GENERAL** (◇) — global, href: `/general`
3. **Battlefield selector row** — select + gear icon
4. **MISSIONS** (■) — battlefield-scoped, with count badge
5. **CAMPAIGNS** (✕) — battlefield-scoped, with count badge
6. **INTEL BOARD** (⊞) — battlefield-scoped
7. **OPS TOOLS** (▸) — collapsible, **collapsed by default**, contains:
   - Git (◆)
   - Console (▶)
   - Env (◇)
   - Deps (◎)
   - Tests (▸)
   - Schedule (⏱) — moved here from standalone
8. *(spacer)*
9. **OVERSEER'S LOG** (◆) — global, always visible
10. **ASSETS** (◎) — global, always visible

### Items Removed from Sidebar

| Item | Reason | Where it lives now |
|------|--------|--------------------|
| Intel Briefing | Agent count already shown in IntelBar topbar | IntelBar only |
| Logistics | Already has a link in IntelBar | IntelBar only |
| Config | Replaced by gear icon on battlefield selector | Gear button on selector row |
| Schedule (standalone) | Moved into OPS TOOLS group | OPS TOOLS collapsible section |

### Collapsed State

9 visible items total — comfortably fits 1080p without scrolling. Expanding OPS TOOLS adds 6 items (15 total), which is still shorter than the current sidebar since Intel Briefing, Logistics, Config, and standalone Schedule are removed.

### OPS TOOLS Collapse Behavior

- **Default state:** collapsed
- **Storage key:** keep existing `sidebar-ops-tools-collapsed` localStorage key, but invert the default (currently defaults to expanded)
- **Auto-expand:** if the current URL matches any OPS TOOLS child route, auto-expand the section (existing behavior, keep it)
- **Persist user preference:** once user manually expands/collapses, persist that choice

### Responsive Behavior

Existing breakpoint patterns remain unchanged:

- **Mobile (< md):** MobileDrawer with the updated sidebar content
- **Tablet (md–lg):** Icon-rail + expanded overlay — update icon list to match new structure (remove Logistics, Config, Schedule icons; keep the rest)
- **Desktop (lg+):** Full sidebar with new layout

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/layout/battlefield-selector.tsx` | Rewrite: custom selector with gear button, fix `"projects"` → `"battlefields"` bug |
| `src/components/layout/sidebar-nav.tsx` | Move Schedule into OPS_TOOLS_ITEMS, remove Config from nav items, default OPS TOOLS to collapsed |
| `src/components/layout/sidebar-content.tsx` | Remove Intel Briefing section and its Socket.IO subscription |
| `src/components/layout/global-nav.tsx` | Remove Logistics from BOTTOM_LINKS |
| `src/components/layout/collapsible-sidebar.tsx` | Update icon-rail items: remove Logistics, Config, Schedule icons |
| `src/components/layout/app-shell.tsx` | Remove any Intel Briefing data fetching if present |

### Files NOT Modified

- `intel-bar.tsx` — topbar stays as-is
- `mobile-drawer.tsx` — receives updated SidebarContent, no structural changes
- `mobile-top-bar.tsx` — no changes
- `app-shell-client.tsx` — grid layout unchanged
