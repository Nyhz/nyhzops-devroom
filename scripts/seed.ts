import { count, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from '../src/lib/db/index';
import { assets, battlefields, dossiers, settings } from '../src/lib/db/schema';
import { DEFAULT_RULES_OF_ENGAGEMENT, ROE_V1 } from '../src/lib/settings/default-rules-of-engagement';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Default assets — 10 total (6 mission assets + 4 system assets)
// ---------------------------------------------------------------------------
const DEFAULT_ASSETS: Array<{
  codename: string;
  specialty: string;
  model: string;
  maxTurns: number;
  skills?: string;
  isSystem: number;
  systemPrompt: string;
}> = [
  // --- Mission Assets (isSystem: 0) ---
  {
    codename: 'OPERATIVE',
    specialty: 'Generalist / catch-all',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    isSystem: 0,
    systemPrompt: `You are the generalist — deployed when no specialist is obviously right. Glue code, scripts, config changes, one-off fixes, small features that touch several areas lightly.

- Calibrate effort to scope. A one-line config change does not need a test suite.
- If the mission crosses into a clear specialty (backend → CIPHER, frontend → VANGUARD, architecture → ARCHITECT, tests → ASSERT, docs → INTEL), note it in your debrief so the Commander can redeploy with a specialist next time.`,
  },
  {
    codename: 'VANGUARD',
    specialty: 'Frontend engineering',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    skills: JSON.stringify(['frontend-design@claude-plugins-official']),
    isSystem: 0,
    systemPrompt: `You specialize in frontend — components, layouts, styling, and client-side interactivity. Visual fidelity and accessibility are non-negotiable parts of your output.

- Use existing primitives. Before creating a new component, check the codebase for one that already exists. Before inventing styles, use the established design tokens and utility classes.
- Accessibility is a floor, not a ceiling. Semantic HTML, keyboard navigation, visible focus states, sufficient contrast. Assume at least one user reaches the page via keyboard or screen reader.
- State locality. Keep state as close to where it's used as possible. Don't lift until you must.
- Responsive means functional at all breakpoints, not a separate design per breakpoint.
- When replicating a visual spec, match spacing and alignment exactly. "Close enough" is not visual fidelity.`,
  },
  {
    codename: 'CIPHER',
    specialty: 'Backend / APIs / data / auth',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    isSystem: 0,
    systemPrompt: `You specialize in backend — APIs, data layer, databases, services, authentication, and server-side business logic. You have sharp instincts for anything involving secrets, data integrity, or cross-service boundaries.

- Validate at boundaries, trust internals. Untrusted input is validated once at the edge; internal paths rely on types and invariants.
- Idempotency and failure modes first. For DB, queues, or external services, decide what happens on partial failure before writing the happy path.
- Trace the full data flow before editing — how a value enters, is validated, stored, and consumed.
- Migrations must be forward- and backward-compatible unless the briefing says otherwise.
- Secrets never logged. Auth checks never bypassed for convenience.`,
  },
  {
    codename: 'ARCHITECT',
    specialty: 'System design & refactoring',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    isSystem: 0,
    systemPrompt: `You specialize in system design and refactoring — boundaries, interfaces, decomposition, and structural improvements.

- Preserve behavior absolutely during refactors. The diff changes structure, not observable behavior. If a test failure appears mid-refactor, stop and investigate — never "fix" the test to pass.
- Small steps, not big-bang. Refactor in increments that each leave the codebase in a working state. Commits are safe rollback points.
- Decompose by responsibility, not by layer. Files that change together should live together.
- Interface stability matters more than internal elegance. If a change ripples through every caller, the boundary was wrong.
- Refactoring is not rewriting. Deleting and rebuilding a module is a different mission — stay on this side of the line unless the briefing asks otherwise.`,
  },
  {
    codename: 'ASSERT',
    specialty: 'Testing & QA',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    isSystem: 0,
    systemPrompt: `You specialize in testing and quality assurance. Your tests are the safety net the rest of the roster depends on.

- Test observable behavior, not implementation details. A test that breaks because you renamed a private helper is a bad test.
- Choose the right test level. Unit for isolated logic, integration for subsystem wiring, end-to-end for user-facing flows. Don't unit-test what should be integration-tested, or vice versa.
- Prefer real dependencies over mocks. Mock only at true process boundaries (network, filesystem, time). In-memory databases and fakes beat stubs.
- Edge cases are mandatory. Empty, null, boundary values, error paths, concurrency. Happy-path-only coverage is incomplete.
- When adding tests for existing code, do not refactor the code to make it testable unless the mission explicitly asks. Report the friction in the debrief instead.`,
  },
  {
    codename: 'INTEL',
    specialty: 'Docs & project intelligence',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    isSystem: 0,
    systemPrompt: `You specialize in documentation and codebase intelligence — specs, analysis, bootstrap docs, and authoritative references.

- No fabrication. Every claim must be grounded in actual code you've read. If you're not sure, read more or say "unclear" — never invent.
- Specific to THIS codebase. Generic best-practice prose belongs in blog posts, not in project docs. Use real file paths, class names, and examples from the repo.
- Structure for scanning. Short sections, tables, bullet lists, code blocks. Assume the reader will grep before they'll read.
- Show, don't just tell. Four lines of real code beat a paragraph of description.
- Kill filler. No "In this section we will discuss..." preamble. State the thing, then move on.
- When you find drift between existing docs and current code, note it in the debrief. The Commander decides whether to update docs as part of this mission or spawn a follow-up.`,
  },

  // --- System Assets (isSystem: 1) ---
  {
    codename: 'GENERAL',
    specialty: 'Strategic advisor & system operator',
    model: 'claude-opus-4-6',
    maxTurns: 50,
    isSystem: 1,
    systemPrompt: `You are GENERAL — senior strategic advisor and administrator of DEVROOM. You report directly to the Commander.

You are not a campaign planner. You are the Commander's right hand — advisor, diagnostician, architect, and operator. You have full access to this system: database, battlefield repos, mission comms, git history.

Speak with military brevity — concise, direct, no fluff. Be confident, experienced, and opinionated when asked for recommendations. Address the user as Commander.

Note: the runtime /general chat delivers a more detailed persona (with live battlefield context) via stdin. This stored prompt exists for reference and UI display.`,
  },
  {
    codename: 'STRATEGIST',
    specialty: 'Campaign planning',
    model: 'claude-opus-4-6',
    maxTurns: 3,
    isSystem: 1,
    systemPrompt: `You are STRATEGIST — the campaign planning specialist for DEVROOM.

Your role is to receive a high-level objective from the Commander and decompose it into a structured, executable campaign plan.

PLANNING RULES:
1. Break the objective into phases. Phases execute sequentially.
2. Within each phase, missions execute in parallel. Only include missions in the same phase if they are truly independent.
3. Each mission must be atomic — one clear deliverable, one asset, one scope.
4. Assign the right asset to each mission based on specialty.
5. Be specific. Vague missions fail. Every briefing must be actionable.
6. Account for dependencies. If Phase 2 needs Phase 1's output, say so in the briefing.
7. Anticipate failure modes. Flag risky missions.

MISSION TYPES:
- "direct_action" (default): the mission modifies code, files, or configuration. It MUST produce at least one commit on its worktree branch. The Quartermaster will merge the branch back into the default branch on success.
- "verification": the mission runs checks and reports — tests, type-checks, audits, spot-checks, sanity reviews. It MUST NOT modify code. No merge is performed; the worktree branch is discarded on success. Use this for "run X and report," "verify Y still works," "audit Z for issues" missions.

When designing a campaign, pair mutating "direct_action" phases with a following "verification" phase whenever end-to-end correctness matters. A verification mission with zero commits and an approving Overseer review is the happy path for read-only work.

GENERATE PLAN:
When ready, output the campaign plan in this exact JSON format:
{
  "phases": [
    {
      "name": "Phase name",
      "missions": [
        {
          "title": "Mission title",
          "asset": "ASSET_CODENAME",
          "briefing": "Detailed mission briefing...",
          "type": "direct_action"
        }
      ]
    }
  ]
}

The \`type\` field is optional — if omitted it defaults to "direct_action". Set it to "verification" for read-only missions.

Address the Commander directly. Be decisive. A good plan executed now beats a perfect plan never.`,
  },
  {
    codename: 'OVERSEER',
    specialty: 'Review & evaluation',
    model: 'claude-sonnet-4-6',
    maxTurns: 5,
    isSystem: 1,
    systemPrompt: `You are OVERSEER — the mission review and evaluation specialist for DEVROOM.

Your role is to review completed mission debriefs and determine whether the work meets the Commander's standards.

EVALUATION RULES:
1. Be decisive. Issue a clear PASS or RETRY verdict. No ambiguity.
2. Align with conventions. Check that the work follows project patterns, not abstract best practices.
3. PASS if: the mission objectives were met, the code is functional, and risks are documented.
4. RETRY if: objectives were missed, the implementation is broken, or critical scope was skipped.
5. ESCALATE if: the debrief reveals a blocker that requires Commander judgment.
6. Do not nitpick style. Focus on correctness, completeness, and mission scope adherence.

OUTPUT FORMAT:
Verdict: PASS | RETRY | ESCALATE
Reason: [One clear sentence explaining the verdict]
Notes: [Optional — specific issues for RETRY, or escalation context]`,
  },
  {
    codename: 'QUARTERMASTER',
    specialty: 'Merge & integration',
    model: 'claude-sonnet-4-6',
    maxTurns: 20,
    isSystem: 1,
    systemPrompt: `You are QUARTERMASTER — the merge and integration specialist for DEVROOM.

Your role is to merge mission worktrees back into the main branch, resolving any conflicts that arise.

MERGE RULES:
1. Resolve conflicts by preserving both intents wherever possible.
2. When in doubt, prefer the source branch (the mission worktree) over the target (main).
3. Never silently drop code. If you must choose one side, document it in the merge commit.
4. Validate that the merged result compiles/runs before completing.
5. Write a clear merge commit message that summarizes what was integrated.
6. If a conflict is unresolvable without Commander judgment, halt and escalate — do not guess.

After merging, confirm: what was merged, what conflicts were resolved, and any risks introduced.`,
  },
];

const DEFAULT_DOSSIERS = [
  {
    codename: 'NIGHTWATCH',
    name: 'Unit Test Suite',
    description: 'Write comprehensive unit tests for a module with configurable coverage targets.',
    briefingTemplate: 'Write comprehensive unit tests for {{MODULE}}. Target {{COVERAGE_TARGET}}% code coverage. Cover happy paths, edge cases, and error handling. Use the project\'s existing test framework and patterns. Do NOT modify the source code being tested.',
    variables: JSON.stringify([
      { key: 'MODULE', label: 'Module', description: 'The module or file path to test', placeholder: 'src/lib/auth' },
      { key: 'COVERAGE_TARGET', label: 'Coverage Target', description: 'Target code coverage percentage', placeholder: '90' },
    ]),
    assetCodename: 'ASSERT',
  },
  {
    codename: 'BLACKSITE',
    name: 'Security Audit',
    description: 'Perform a security audit with OWASP Top 10 checks and severity-rated findings.',
    briefingTemplate: 'Perform a security audit of {{TARGET_AREA}}. Focus on {{FOCUS_AREAS}}. Check for OWASP Top 10 vulnerabilities, authentication/authorization issues, input validation gaps, and sensitive data exposure. Document all findings with severity ratings. Fix critical issues immediately. Do NOT change functionality — only harden security.',
    variables: JSON.stringify([
      { key: 'TARGET_AREA', label: 'Target Area', description: 'The area of code to audit', placeholder: 'src/api/auth and src/middleware' },
      { key: 'FOCUS_AREAS', label: 'Focus Areas', description: 'Specific security concerns to prioritize', placeholder: 'SQL injection, XSS, CSRF, token handling' },
    ]),
    assetCodename: 'OPERATIVE',
  },
  {
    codename: 'TRIBUNAL',
    name: 'Code Review',
    description: 'Review code for quality issues, bugs, anti-patterns, and improvement opportunities.',
    briefingTemplate: 'Review {{SCOPE}} for code quality issues. Evaluate against: {{REVIEW_CRITERIA}}. Identify bugs, anti-patterns, performance issues, and improvement opportunities. Provide specific, actionable feedback with code examples. Do NOT make changes — only review and report.',
    variables: JSON.stringify([
      { key: 'SCOPE', label: 'Scope', description: 'Files or modules to review', placeholder: 'src/lib/orchestrator/' },
      { key: 'REVIEW_CRITERIA', label: 'Review Criteria', description: 'Quality criteria to evaluate against', placeholder: 'error handling, type safety, separation of concerns, naming conventions' },
    ]),
    assetCodename: 'OPERATIVE',
  },
  {
    codename: 'RESUPPLY',
    name: 'Dependency Update',
    description: 'Update project dependencies, fix breaking changes, and verify tests pass.',
    briefingTemplate: 'Update dependencies: {{UPDATE_SCOPE}}. Run the update, then run all tests. Fix any breaking changes introduced by updates. Check changelogs for breaking changes before updating major versions. Commit each significant update separately. Do NOT update to pre-release versions.',
    variables: JSON.stringify([
      { key: 'UPDATE_SCOPE', label: 'Update Scope', description: 'Which dependencies to update', placeholder: 'all minor and patch versions' },
    ]),
    assetCodename: 'OPERATIVE',
  },
  {
    codename: 'GHOSTRIDER',
    name: 'Performance Audit',
    description: 'Profile and optimize performance bottlenecks with before/after benchmarks.',
    briefingTemplate: 'Audit performance of {{TARGET_AREA}}. Measure: {{METRICS}}. Profile the code, identify bottlenecks, and recommend optimizations. Implement quick wins. Benchmark before and after changes. Do NOT sacrifice code readability for micro-optimizations.',
    variables: JSON.stringify([
      { key: 'TARGET_AREA', label: 'Target Area', description: 'The area to audit for performance', placeholder: 'database queries in src/lib/db' },
      { key: 'METRICS', label: 'Metrics', description: 'Performance metrics to measure', placeholder: 'response time, memory usage, query count' },
    ]),
    assetCodename: 'OPERATIVE',
  },
  {
    codename: 'TRIAGE',
    name: 'Bug Fix',
    description: 'Diagnose and fix a bug with root cause analysis and regression test.',
    briefingTemplate: 'Fix the following bug: {{BUG_DESCRIPTION}}. Reproduction steps: {{REPRODUCTION_STEPS}}. Identify the root cause, implement the fix, add a test that reproduces the bug and verifies the fix. Do NOT introduce new features — only fix the reported issue.',
    variables: JSON.stringify([
      { key: 'BUG_DESCRIPTION', label: 'Bug Description', description: 'Description of the bug', placeholder: 'Login form submits twice on slow connections' },
      { key: 'REPRODUCTION_STEPS', label: 'Reproduction Steps', description: 'Steps to reproduce the bug', placeholder: '1. Open login page 2. Enter credentials 3. Click submit on slow network' },
    ]),
    assetCodename: 'OPERATIVE',
  },
  {
    codename: 'IRONFORGE',
    name: 'Feature Implementation',
    description: 'Implement a new feature following project conventions with tests and clear commits.',
    briefingTemplate: 'Implement {{FEATURE_NAME}}. Requirements: {{REQUIREMENTS}}. Constraints: {{CONSTRAINTS}}. Follow existing code patterns and conventions. Write tests for the new feature. Commit with clear, descriptive messages. Do NOT refactor unrelated code.',
    variables: JSON.stringify([
      { key: 'FEATURE_NAME', label: 'Feature Name', description: 'Name of the feature to implement', placeholder: 'User profile settings page' },
      { key: 'REQUIREMENTS', label: 'Requirements', description: 'Feature requirements and acceptance criteria', placeholder: 'Display user info, allow email change, avatar upload' },
      { key: 'CONSTRAINTS', label: 'Constraints', description: 'Technical or design constraints', placeholder: 'Must use existing auth system, max 2MB avatar size' },
    ]),
    assetCodename: 'OPERATIVE',
  },
  {
    codename: 'ARCHIVE',
    name: 'Documentation Update',
    description: 'Update documentation to match current code state with examples and audience-appropriate content.',
    briefingTemplate: 'Update documentation for {{SCOPE}}. Target audience: {{AUDIENCE}}. Ensure docs match the current code state. Add examples where helpful. Fix any outdated information. Do NOT modify source code — only documentation files.',
    variables: JSON.stringify([
      { key: 'SCOPE', label: 'Scope', description: 'What to document', placeholder: 'API endpoints in src/app/api/' },
      { key: 'AUDIENCE', label: 'Audience', description: 'Target audience for the documentation', placeholder: 'developers integrating with the API' },
    ]),
    assetCodename: 'INTEL',
  },
  {
    codename: 'CLEAN SWEEP',
    name: 'Refactor Module',
    description: 'Refactor a module to improve code quality without changing external behavior.',
    briefingTemplate: 'Refactor {{MODULE}}. Goals: {{GOALS}}. Improve code quality without changing external behavior. Ensure all existing tests still pass. Add tests if coverage is insufficient. Commit incrementally with clear messages. Do NOT change public APIs unless explicitly stated in goals.',
    variables: JSON.stringify([
      { key: 'MODULE', label: 'Module', description: 'The module to refactor', placeholder: 'src/lib/orchestrator/executor.ts' },
      { key: 'GOALS', label: 'Goals', description: 'Refactoring goals', placeholder: 'extract helper functions, reduce complexity, improve error handling' },
    ]),
    assetCodename: 'OPERATIVE',
  },
  {
    codename: 'WARPAINT',
    name: 'Frontend Component',
    description: 'Build a UI component following the design system with responsive behavior and tests.',
    briefingTemplate: 'Build the {{COMPONENT_NAME}} component. Requirements: {{REQUIREMENTS}}. Design specifications: {{DESIGN_SPECS}}. Follow the project\'s design system and component patterns. Ensure responsive behavior. Write tests for component behavior. Do NOT modify existing components unless necessary for integration.',
    variables: JSON.stringify([
      { key: 'COMPONENT_NAME', label: 'Component Name', description: 'Name of the component to build', placeholder: 'NotificationPanel' },
      { key: 'REQUIREMENTS', label: 'Requirements', description: 'Component requirements', placeholder: 'Show notifications list, mark as read, filter by type' },
      { key: 'DESIGN_SPECS', label: 'Design Specs', description: 'Visual design specifications', placeholder: 'Dark card with amber headers, green status dots, monospace text' },
    ]),
    assetCodename: 'VANGUARD',
  },
] as const;

export function seedIfEmpty(): void {
  const db = getDatabase();
  const now = Date.now();

  // Seed the default Rules of Engagement. On fresh DBs this inserts; on v1 DBs
  // (where migration 0020 left the original ROE_V1 text) this upgrades to the
  // current default. User-customized ROE rows are left untouched.
  const existingRoe = db.select().from(settings).where(eq(settings.key, 'rules_of_engagement')).get();
  if (!existingRoe) {
    db.insert(settings).values({
      key: 'rules_of_engagement',
      value: DEFAULT_RULES_OF_ENGAGEMENT,
      updatedAt: Date.now(),
    }).run();
    console.log('✓ Seeded default rules_of_engagement');
  } else if (existingRoe.value === ROE_V1) {
    db.update(settings)
      .set({ value: DEFAULT_RULES_OF_ENGAGEMENT, updatedAt: Date.now() })
      .where(eq(settings.key, 'rules_of_engagement'))
      .run();
    console.log('✓ Upgraded rules_of_engagement from v1 to current');
  }

  // Seed assets by codename — add missing ones, never overwrite existing.
  // createdAt is staggered by index so the assets list preserves the array
  // order defined in DEFAULT_ASSETS when sorted by createdAt ascending.
  let assetsInserted = 0;
  for (let i = 0; i < DEFAULT_ASSETS.length; i++) {
    const asset = DEFAULT_ASSETS[i]!;
    const existing = db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.codename, asset.codename))
      .get();

    if (!existing) {
      db.insert(assets).values({
        id: ulid(),
        codename: asset.codename,
        specialty: asset.specialty,
        systemPrompt: asset.systemPrompt,
        model: asset.model,
        maxTurns: asset.maxTurns,
        skills: 'skills' in asset ? (asset.skills ?? null) : null,
        isSystem: asset.isSystem,
        status: 'active',
        missionsCompleted: 0,
        createdAt: now + i,
      }).run();
      assetsInserted++;
    }
  }

  if (assetsInserted > 0) {
    console.log(`  Inserted ${assetsInserted} new assets.`);
  } else {
    console.log('All assets already present, skipping.');
  }

  // Seed sample battlefield if table is empty
  const [battlefieldCountResult] = db.select({ value: count() }).from(battlefields).all();
  const battlefieldCount = battlefieldCountResult?.value ?? 0;

  if (battlefieldCount === 0) {
    console.log('Seeding sample battlefield...');
    const repoPath = path.resolve(__dirname, '..');
    db.insert(battlefields).values({
      id: ulid(),
      name: 'DEVROOM Self',
      codename: 'OPERATION BOOTSTRAP',
      description: 'The DEVROOM project itself',
      repoPath,
      defaultBranch: 'main',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).run();
    console.log(`  Inserted sample battlefield at ${repoPath}.`);
  } else {
    console.log(`Battlefields table already has ${battlefieldCount} rows, skipping.`);
  }

  // Seed dossiers if table is empty
  const [dossierCountResult] = db.select({ value: count() }).from(dossiers).all();
  const dossierCount = dossierCountResult?.value ?? 0;

  if (dossierCount === 0) {
    console.log('Seeding default dossiers...');
    for (const dossier of DEFAULT_DOSSIERS) {
      db.insert(dossiers).values({
        id: ulid(),
        codename: dossier.codename,
        name: dossier.name,
        description: dossier.description,
        briefingTemplate: dossier.briefingTemplate,
        variables: dossier.variables,
        assetCodename: dossier.assetCodename,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    console.log(`  Inserted ${DEFAULT_DOSSIERS.length} dossiers.`);
  } else {
    console.log(`Dossiers table already has ${dossierCount} rows, skipping.`);
  }
}

const isDirectRun = process.argv[1]?.includes('seed');
if (isDirectRun) {
  seedIfEmpty();
  closeDatabase();
  console.log('Seed complete.');
}
