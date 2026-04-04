# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce sidebar visual weight and vertical overflow by collapsing OPS TOOLS, removing redundant items, and replacing the buggy battlefield selector with a compact codename display + gear icon.

**Architecture:** Modify 6 existing layout components. No new files. The battlefield selector gets rewritten in-place as a custom component (no more TacSelect). OPS TOOLS default changes from expanded to collapsed. Intel Briefing section and its Socket.IO subscription are removed. Logistics removed from sidebar (already in IntelBar). Config replaced by gear icon. Schedule moves into OPS TOOLS.

**Tech Stack:** Next.js App Router, React hooks, Tailwind CSS, `usePathname`/`useRouter` for URL-based state.

**Spec:** `docs/superpowers/specs/2026-04-05-sidebar-redesign-design.md`

---

### Task 1: Rewrite Battlefield Selector

**Files:**
- Modify: `src/components/layout/battlefield-selector.tsx` (full rewrite)

- [ ] **Step 1: Write the component**

Replace the entire file. The new selector is a flex row: a clickable select area (~flex-1) showing status dot + codename + arrow, and a separate gear button (fixed width) linking to config. The dropdown opens inline on click, showing all battlefields with status dots.

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Battlefield } from "@/types";

interface BattlefieldSelectorProps {
  battlefields: Battlefield[];
}

export function BattlefieldSelector({ battlefields }: BattlefieldSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract current battlefield ID from URL: /battlefields/[id]/...
  const segments = pathname.split("/");
  const bfIndex = segments.indexOf("battlefields");
  const currentId = bfIndex >= 0 ? segments[bfIndex + 1] : undefined;

  const currentBattlefield = battlefields.find((bf) => bf.id === currentId);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close dropdown on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (battlefields.length === 0) {
    return (
      <div className="text-dr-muted text-sm px-1 py-1">No battlefields</div>
    );
  }

  function handleSelect(id: string) {
    setOpen(false);
    router.push(`/battlefields/${id}`);
  }

  return (
    <div ref={containerRef}>
      <div className="flex items-center gap-1.5">
        {/* Select trigger */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            "flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2 text-sm",
            "bg-dr-elevated border border-dr-border rounded",
            "hover:border-dr-dim transition-colors",
            open && "border-dr-dim rounded-b-none"
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {currentBattlefield && (
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  currentBattlefield.status === "archived" ? "bg-dr-dim" : "bg-dr-green"
                )}
              />
            )}
            <span className="font-bold text-dr-text truncate">
              {currentBattlefield?.codename ?? "Select battlefield"}
            </span>
          </span>
          <span className="text-dr-dim text-[10px] shrink-0">
            {open ? "▴" : "▾"}
          </span>
        </button>

        {/* Gear button — config */}
        {currentId && (
          <Link
            href={`/battlefields/${currentId}/config`}
            className={cn(
              "shrink-0 w-[34px] h-[34px] flex items-center justify-center",
              "bg-dr-elevated border border-dr-border rounded",
              "text-dr-dim hover:text-dr-amber hover:border-dr-amber transition-colors"
            )}
            title="Battlefield Config"
          >
            ⚙
          </Link>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="bg-dr-elevated border border-dr-border border-t-0 rounded-b overflow-hidden"
          style={{ marginRight: currentId ? "calc(34px + 0.375rem)" : "0" }}
        >
          {battlefields.map((bf) => (
            <button
              key={bf.id}
              type="button"
              onClick={() => handleSelect(bf.id)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                bf.id === currentId
                  ? "text-dr-amber"
                  : "text-dr-muted hover:text-dr-text hover:bg-dr-surface"
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  bf.status === "archived" ? "bg-dr-dim" : "bg-dr-green"
                )}
              />
              <span className="truncate">{bf.codename}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: `pnpm dev` and navigate to a battlefield page. Confirm:
- Codename is displayed with a green status dot
- Gear icon appears to the right
- Clicking the select opens the dropdown below it (not under the gear)
- Clicking a battlefield navigates and closes the dropdown
- Clicking outside closes the dropdown
- Gear icon links to `/battlefields/[id]/config`

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/battlefield-selector.tsx
git commit -m "feat: rewrite battlefield selector with codename display and gear icon"
```

---

### Task 2: Restructure Sidebar Nav — Move Schedule, Remove Config, Default Collapsed

**Files:**
- Modify: `src/components/layout/sidebar-nav.tsx`

- [ ] **Step 1: Move Schedule into OPS_TOOLS_ITEMS and remove BOTTOM_ITEMS**

In `sidebar-nav.tsx`, change the nav item arrays. Add Schedule as the 6th OPS TOOLS item. Delete the BOTTOM_ITEMS array entirely. Remove the line that renders BOTTOM_ITEMS.

Replace lines 21-32 (OPS_TOOLS_ITEMS and BOTTOM_ITEMS):
```tsx
const OPS_TOOLS_ITEMS: NavItem[] = [
  { icon: "◆", label: "GIT", segment: "git" },
  { icon: "▶", label: "CONSOLE", segment: "console" },
  { icon: "◇", label: "ENV", segment: "env" },
  { icon: "◎", label: "DEPS", segment: "deps" },
  { icon: "▸", label: "TESTS", segment: "tests" },
  { icon: "⏱", label: "SCHEDULE", segment: "schedule" },
];
```

- [ ] **Step 2: Change default collapsed state to true**

In `sidebar-nav.tsx`, change the `getCollapsedServerSnapshot` function (line 48-50) to return `true` instead of `false`:

```tsx
function getCollapsedServerSnapshot(): boolean {
  return true;
}
```

Also update `getCollapsedSnapshot` (line 44-46) to default to `true` when no localStorage value exists:

```tsx
function getCollapsedSnapshot(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return true;
  return stored === "true";
}
```

- [ ] **Step 3: Remove BOTTOM_ITEMS rendering**

Remove line 151 which renders BOTTOM_ITEMS:

```tsx
{BOTTOM_ITEMS.map((item) => renderItem(item))}
```

The nav JSX should end after the OPS_TOOLS section:

```tsx
  return (
    <nav className="flex flex-col px-3 gap-0.5">
      {TOP_ITEMS.map((item) => renderItem(item))}

      <button
        type="button"
        onClick={toggleCollapsed}
        className="flex items-center gap-2 px-3 py-2 mt-2 text-xs tracking-widest text-dr-dim hover:text-dr-muted transition-colors"
      >
        <span className={cn(
          "text-[10px] transition-transform duration-150",
          isOpen ? "rotate-90" : "rotate-0"
        )}>
          ▶
        </span>
        <span>OPS TOOLS</span>
      </button>

      {isOpen && OPS_TOOLS_ITEMS.map((item) => renderItem(item, true))}
    </nav>
  );
```

- [ ] **Step 4: Verify**

Run: `pnpm dev` and navigate to a battlefield. Confirm:
- OPS TOOLS is collapsed by default (only the "▶ OPS TOOLS" button visible)
- Clicking expands to show 6 items (Git, Console, Env, Deps, Tests, Schedule)
- Schedule and Config no longer appear as standalone items below OPS TOOLS
- Navigating to an OPS TOOLS route (e.g. `/battlefields/[id]/git`) auto-expands the section

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar-nav.tsx
git commit -m "feat: collapse OPS TOOLS by default, move Schedule in, remove Config"
```

---

### Task 3: Remove Logistics from Global Nav

**Files:**
- Modify: `src/components/layout/global-nav.tsx`

- [ ] **Step 1: Remove Logistics from BOTTOM_LINKS**

In `global-nav.tsx`, change lines 12-16. Remove the Logistics entry:

```tsx
const BOTTOM_LINKS = [
  { href: '/overseer-log', icon: '◆', label: "OVERSEER'S LOG" },
  { href: '/assets', icon: '◎', label: 'ASSETS' },
] as const;
```

- [ ] **Step 2: Verify**

Run: `pnpm dev`. Confirm the sidebar bottom section shows only OVERSEER'S LOG and ASSETS. Logistics is no longer in the sidebar (it's still accessible via the IntelBar topbar link).

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/global-nav.tsx
git commit -m "feat: remove Logistics from sidebar (already in IntelBar)"
```

---

### Task 4: Remove Intel Briefing from Sidebar Content

**Files:**
- Modify: `src/components/layout/sidebar-content.tsx`

- [ ] **Step 1: Remove Intel Briefing section and activeAgents state/socket**

Remove the `activeAgents` prop, `useState`, `useEffect` for Socket.IO, and the entire Intel Briefing div at the bottom. Remove the `useSocket` and `config` imports since they're only used for Intel Briefing.

Replace the full file:

```tsx
"use client";

import Link from "next/link";
import { GlobalNavTop, GlobalNavBottom } from "./global-nav";
import { BattlefieldSelector } from "./battlefield-selector";
import { SidebarNav } from "./sidebar-nav";
import type { Battlefield } from "@/types";

interface SidebarContentProps {
  battlefields: Battlefield[];
  missionCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
  onLinkClick?: () => void;
}

export function SidebarContent({
  battlefields,
  missionCounts,
  campaignCounts,
  onLinkClick,
}: SidebarContentProps) {
  return (
    <>
      {/* Brand block — clickable, goes to War Room */}
      <Link
        href="/"
        className="block px-5 pt-5 pb-4 hover:bg-dr-elevated transition-colors"
        onClick={onLinkClick}
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-dr-amber flex items-center justify-center text-dr-bg font-bold text-base shrink-0">
            N
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-dr-text text-base font-bold tracking-wide">
                NYHZ OPS
              </span>
              <span className="text-dr-green text-sm">●</span>
            </div>
            <span className="text-dr-muted text-sm">DEVROOM</span>
          </div>
        </div>
      </Link>

      {/* Separator */}
      <div className="border-t border-dr-border" />

      {/* Global nav — always visible, highlights active route */}
      <GlobalNavTop />

      {/* Separator */}
      <div className="border-t border-dr-border" />

      {/* Battlefield selector */}
      <div className="px-4 py-3">
        <BattlefieldSelector battlefields={battlefields} />
      </div>

      {/* Nav links */}
      <SidebarNav
        missionCounts={missionCounts}
        campaignCounts={campaignCounts}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Global links — highlights active route */}
      <GlobalNavBottom />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/sidebar-content.tsx
git commit -m "feat: remove Intel Briefing section and Socket.IO subscription"
```

---

### Task 5: Remove activeAgents Prop Threading

**Files:**
- Modify: `src/components/layout/collapsible-sidebar.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/components/layout/app-shell-client.tsx`
- Modify: `src/components/layout/mobile-drawer.tsx`

Since `SidebarContent` no longer accepts `activeAgents`, remove it from all parents that pass it down.

- [ ] **Step 1: Update CollapsibleSidebar**

In `collapsible-sidebar.tsx`, remove `activeAgents` from the interface (line 36) and from the destructured props (line 43). Remove `activeAgents={activeAgents}` from both `<SidebarContent>` renders (lines 211 and 229).

Replace lines 32-37:
```tsx
interface CollapsibleSidebarProps {
  battlefields: Battlefield[];
  missionCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
}
```

Replace lines 39-44:
```tsx
export function CollapsibleSidebar({
  battlefields,
  missionCounts,
  campaignCounts,
}: CollapsibleSidebarProps) {
```

Remove `activeAgents={activeAgents}` from the two `<SidebarContent>` usages (around lines 207-212 and 225-230).

- [ ] **Step 2: Update icon-rail — remove Schedule, Config, Logistics**

In `collapsible-sidebar.tsx`, update the BATTLEFIELD_ICONS array (lines 17-24). Remove Schedule and Config:

```tsx
const BATTLEFIELD_ICONS = [
  { icon: "\u25A0", label: "MISSIONS", segment: "" },
  { icon: "\u2715", label: "CAMPAIGNS", segment: "campaigns" },
  { icon: "\u25C6", label: "GIT", segment: "git" },
  { icon: "\u25B6", label: "CONSOLE", segment: "console" },
] as const;
```

Update GLOBAL_BOTTOM_ICONS (lines 26-30). Remove Logistics:

```tsx
const GLOBAL_BOTTOM_ICONS = [
  { href: "/overseer-log", icon: "\u2693", label: "OVERSEER'S LOG" },
  { href: "/assets", icon: "\u25CE", label: "ASSETS" },
] as const;
```

- [ ] **Step 3: Update AppShellClient**

Read `src/components/layout/app-shell-client.tsx` to find and remove `activeAgents` from its interface and props, and from where it passes to `CollapsibleSidebar` and `MobileDrawer`.

- [ ] **Step 4: Update MobileDrawer**

Read `src/components/layout/mobile-drawer.tsx` to find and remove `activeAgents` from its interface and props, and from where it passes to `SidebarContent`.

- [ ] **Step 5: Update AppShell server component**

In `src/components/layout/app-shell.tsx`, remove lines 35-40 (the activeAgents query) and remove `activeAgents={activeAgents}` from the `<AppShellClient>` render (line 48).

- [ ] **Step 6: Verify**

Run: `pnpm dev`. Navigate the app. Confirm:
- No TypeScript errors in the terminal
- Sidebar renders correctly on desktop, tablet icon-rail, and mobile drawer
- Intel Briefing is gone everywhere
- Icon-rail no longer shows Schedule, Config, or Logistics icons
- No console errors about missing props

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/collapsible-sidebar.tsx src/components/layout/app-shell.tsx src/components/layout/app-shell-client.tsx src/components/layout/mobile-drawer.tsx
git commit -m "feat: remove activeAgents prop threading and update icon-rail items"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run type check**

Run: `pnpm tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: All existing tests pass. No regressions.

- [ ] **Step 3: Visual check on desktop**

Open the app at full desktop width. Verify the sidebar shows exactly:
1. Brand block (NYHZ OPS)
2. HQ
3. GENERAL
4. Battlefield selector (codename + gear icon)
5. MISSIONS (with count)
6. CAMPAIGNS (with count)
7. INTEL BOARD
8. ▶ OPS TOOLS (collapsed)
9. OVERSEER'S LOG
10. ASSETS

Total: 9 visible items in collapsed state.

- [ ] **Step 4: Visual check at 1080p**

Resize browser to 1920x1080. Confirm no scrolling needed in collapsed state.

- [ ] **Step 5: Check tablet icon-rail**

Resize to tablet width (768-1024px). Confirm icon-rail shows only: N brand, HQ, GENERAL, MISSIONS, CAMPAIGNS, GIT, CONSOLE, spacer, OVERSEER'S LOG, ASSETS. No Schedule, Config, or Logistics icons.

- [ ] **Step 6: Check mobile drawer**

Resize to mobile width (<768px). Open the hamburger menu. Confirm the drawer shows the same updated sidebar content.
