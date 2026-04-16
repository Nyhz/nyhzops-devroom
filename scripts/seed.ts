import { count, eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { ulid } from 'ulid';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from '../src/lib/db/index';
import { assets, battlefields, dossiers, settings } from '../src/lib/db/schema';
import { DEFAULT_RULES_OF_ENGAGEMENT, ROE_V1 } from '../src/lib/settings/default-rules-of-engagement';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadPrompt(relPath: string): string {
  return readFileSync(path.join(__dirname, '..', 'src/control/assets/prompts', relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Default assets — 6 total (3 combat assets + 3 system assets).
// CONTROL reliability refactor reseed. Pre-cutover: "add missing, never
// overwrite" — existing legacy codenames remain in the DB untouched. A
// clean-slate migration at Phase 10 will wipe and reseed.
// ---------------------------------------------------------------------------
const DEFAULT_ASSETS: Array<{
  codename: string;
  specialty: string;
  model: string;
  maxTurns: number;
  effort: string;
  skills?: string;
  isSystem: number;
  systemPrompt: string;
}> = [
  // --- Combat Assets (isSystem: 0) ---
  {
    codename: 'OPERATIVE',
    specialty: 'General backend, fullstack, refactors, test-writing',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    effort: 'medium',
    skills: JSON.stringify([
      'verification-before-completion:verification-before-completion',
      'systematic-debugging:systematic-debugging',
      'simplify:simplify',
    ]),
    isSystem: 0,
    systemPrompt: loadPrompt('combat/operative.md'),
  },
  {
    codename: 'VANGUARD',
    specialty: 'Frontend — UI, styling, UX',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    effort: 'medium',
    skills: JSON.stringify([
      'frontend-design:frontend-design',
      'verification-before-completion:verification-before-completion',
      'test-driven-development:test-driven-development',
    ]),
    isSystem: 0,
    systemPrompt: loadPrompt('combat/vanguard.md'),
  },
  {
    codename: 'INTEL',
    specialty: 'Docs, analysis, specs, bootstrap',
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    effort: 'medium',
    skills: JSON.stringify([
      'verification-before-completion:verification-before-completion',
    ]),
    isSystem: 0,
    systemPrompt: loadPrompt('combat/intel.md'),
  },

  // --- System Assets (isSystem: 1) ---
  {
    codename: 'STRATEGIST',
    specialty: 'Campaign planning',
    model: 'claude-opus-4-6',
    maxTurns: 3,
    effort: 'high',
    isSystem: 1,
    systemPrompt: loadPrompt('system/strategist.md'),
  },
  {
    codename: 'OVERSEER',
    specialty: 'Exit classification + gate-failure consult',
    model: 'claude-sonnet-4-6',
    maxTurns: 2,
    effort: 'medium',
    isSystem: 1,
    systemPrompt: loadPrompt('system/overseer.md'),
  },
  {
    codename: 'QUARTERMASTER',
    specialty: 'Merge conflict resolution',
    model: 'claude-sonnet-4-6',
    maxTurns: 15,
    effort: 'medium',
    isSystem: 1,
    systemPrompt: loadPrompt('system/quartermaster.md'),
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
        effort: asset.effort,
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
