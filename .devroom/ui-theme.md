# UI & Theme

## UI / Aesthetic Direction

### Branding

The app identity is **NYHZ OPS** with **DEVROOM** as the operation codename. In the UI sidebar:

```
N   NYHZ OPS  ●
    DEVROOM
```

The `N` sits inside a colored circle (brand initial). The green dot indicates operational status.

### Reference

The UI follows the tactical operations center aesthetic from the reference screenshots. Key principles:

- **Dark background** with cool gray/slate tint (Ghost Ops V2 theme) (`#0a0a0c`).
- **Green accents** for success states and primary highlights.
- **Amber/orange accents** for labels, section headers, in-progress states.
- **Monospace everywhere** — all text.
- **Dense information layout** — stats bars, sidebars with asset lists, mission tables.
- **Sharp corners** — no border-radius on cards. Angular, military feel.
- **Top intel bar** with rotating military quotes.
- **Bottom status bar** with system status and LAN access warning.
- **Left sidebar** split into two sections:
  - **Global nav** (always visible): top links — HQ (◉), GENERAL (◇); bottom links — CAPTAIN'S LOG (⚓), ASSETS (◎), LOGISTICS (◈).
  - **Battlefield nav** (visible when inside `/battlefields/[id]`): MISSIONS (■), CAMPAIGNS (✕), INTEL BOARD (⊞), GIT (◆), CONSOLE (▶), SCHEDULE (⏱), CONFIG (⚙) — with count badges.
- **Right sidebar** (battlefield view) with asset list and asset breakdown stats.

### Tailwind Theme

Tailwind v4 uses CSS-based configuration. There is **no `tailwind.config.ts`**. All theme tokens are defined in `src/app/globals.css` using `@theme inline` blocks:

```css
/* src/app/globals.css */
@theme inline {
  --color-dr-bg:        #0a0a0c;
  --color-dr-surface:   #111114;
  --color-dr-elevated:  #1a1a22;
  --color-dr-border:    #2a2a32;
  --color-dr-text:      #b8b8c8;
  --color-dr-muted:     #9898a8;
  --color-dr-dim:       #868696;
  --color-dr-green:     #00ff41;
  --color-dr-amber:     #ffbf00;
  --color-dr-red:       #ff3333;
  --color-dr-blue:      #00aaff;

  --font-tactical: 'Share Tech Mono', monospace;
  --font-mono:     'IBM Plex Mono', monospace;
  --font-data:     'Courier Prime', monospace;

  --shadow-glow-green: 0 0 10px rgba(0, 255, 65, 0.3);
  --shadow-glow-amber: 0 0 10px rgba(255, 191, 0, 0.3);
  --shadow-glow-red:   0 0 10px rgba(255, 51, 51, 0.3);

  --radius-*: 0rem;  /* No border-radius — sharp angular military feel */
}
```

Usage in components: `bg-dr-bg`, `text-dr-green`, `font-tactical`, `shadow-glow-green`, etc.

### Intel Bar

Full-width top bar: `INTEL //` prefix + rotating military quote every 60s. Monospace, dim text.

```typescript
const INTEL_QUOTES = [
  "The supreme art of war is to subdue the enemy without fighting. — Sun Tzu",
  "No plan survives first contact with the enemy. — Helmuth von Moltke",
  "In preparing for battle I have always found that plans are useless, but planning is indispensable. — Eisenhower",
  "The more you sweat in training, the less you bleed in combat. — Richard Marcinko",
  "Speed is the essence of war. — Sun Tzu",
  "Who dares wins. — SAS motto",
  "The only easy day was yesterday. — Navy SEALs",
  "Brave men rejoice in adversity, just as brave soldiers triumph in war. — Seneca",
  "Strategy without tactics is the slowest route to victory. Tactics without strategy is the noise before defeat. — Sun Tzu",
  "Fortune favors the bold. — Virgil",
  "Let your plans be dark and impenetrable as night, and when you move, fall like a thunderbolt. — Sun Tzu",
  "Amateurs talk strategy. Professionals talk logistics. — Gen. Omar Bradley",
  "A good plan violently executed now is better than a perfect plan executed next week. — Patton",
  "Victory belongs to the most persevering. — Napoleon",
  "We sleep safely at night because rough men stand ready to visit violence on those who would harm us. — attributed to Orwell",
];
```

### Status Footer

Bottom bar: `● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK`. Green dot, dim monospace.

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  INTEL //  "The supreme art of war is to subdue the enemy..."   │
├────────┬────────────────────────────────────────┬───────────────┤
│        │                                        │               │
│  N     │  Battlefields // Project Name          │  ASSETS       │
│  NYHZ  │  PROJECT CODENAME                      │  ● PATHFINDER │
│  OPS ● │  Description text                      │  ● GENERAL    │
│  DEV-  │                                        │  ● OPERATIVE  │
│  ROOM  │  ┌─ DEPLOY MISSION ──────────────┐     │  ...          │
│        │  │ [textarea] [asset] [deploy]   │     │               │
│ ─────  │  └───────────────────────────────┘     │  BREAKDOWN    │
│ ◉ HQ   │                                        │  OPERATIVE 83 │
│ ◇ GEN  │  0 IN COMBAT │ 251 ACCOMPLISHED │ ...  │  PATHFINDER 7 │
│        │                                        │  ...          │
│ ─────  │  MISSIONS          [Search...]         │               │
│ PROJ ▾ │  │ mission title    ● ACCOMP.  │       │               │
│ ■ MISS │  │ ASSET · 9 mins ago    VIEW  │       │               │
│ ✕ CAMP │  ├─────────────────────────────┤       │               │
│ ⊞ INTL │  │ ...                         │       │               │
│ ◆ GIT  │  │ ASSET · 9 mins ago    VIEW  │       │               │
│ ▶ CONS │  └─────────────────────────────┘       │               │
│ ⏱ SCHD │                                        │               │
│ ⚙ CONF │                                        │               │
│        │                                        │               │
│ ─────  │                                        │               │
│ ⚓ LOG  │                                        │               │
│ ◎ ASST │                                        │               │
│ ◈ LOGI │                                        │               │
├────────┴────────────────────────────────────────┴───────────────┤
│  ● LOCAL ACCESS ONLY — NOT SAFE TO EXPOSE TO A NETWORK          │
└─────────────────────────────────────────────────────────────────┘
```

### Key UI Patterns

- **Deploy Mission**: inline on battlefield page. Textarea + asset dropdown + SAVE / SAVE & DEPLOY + Load dossier.
- **Stats bar**: `IN COMBAT | ACCOMPLISHED | COMPROMISED | STANDBY | cache hit %`.
- **Mission list**: table rows — title (+ iteration badge), asset + time, status badge, VIEW.
- **Asset panel**: right sidebar with green dots + codenames + models. ASSET BREAKDOWN below.
- **Campaign phases**: stacked containers with left border (green=secured, amber=active). Mission cards laid horizontally inside each phase.
- **Campaign controls**: `[MISSION ACCOMPLISHED]` (green) `[REDEPLOY]` `[ABANDON]` (red).

---

## Commander Reporting Tone

All system-generated text addresses the user as **Commander**:

**Mission debrief:**
```
DEBRIEF — Mission: Fix authentication bug
Status: ACCOMPLISHED | Asset: OPERATIVE
Duration: 2m 14s | Tokens: 45.2K (91% cache hit)

Commander, the authentication module has been updated. The JWT refresh
endpoint was returning 401 due to an expired signing key reference.
Changes applied:
- Replaced hardcoded key with dynamic lookup from config
- Added token rotation logic on refresh
- All 14 existing auth tests pass, 3 new tests added

No further action required. Awaiting next orders.
```

**Phase debrief:**
```
PHASE DEBRIEF — Phase 1: Recon
Status: SECURED | Duration: 1m 48s | Tokens: 683.0K

Commander, Phase 1 is complete. All reconnaissance missions accomplished.
- Code audit identified 12 areas requiring attention
- Test coverage stands at 67%, with 14 critical paths uncovered

Recommend proceeding to Phase 2: Strike. Standing by for orders.
```

**Error report:**
```
SITUATION REPORT — Mission COMPROMISED
Asset GHOST encountered resistance during deployment.
Error: git merge conflict in src/auth/handler.ts

Recommend manual review or redeployment with conflict resolution
asset. Awaiting Commander's orders.
```
