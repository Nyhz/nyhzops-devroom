import { count } from 'drizzle-orm';
import { ulid } from 'ulid';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from '../src/lib/db/index';
import { assets, battlefields, dossiers } from '../src/lib/db/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ASSETS = [
  {
    codename: 'ARCHITECT',
    specialty: 'general',
    systemPrompt:
      'You are ARCHITECT, a full-stack generalist agent. You follow project conventions strictly, write clean and maintainable code, and ensure all changes are well-tested. You handle any task that doesn\'t require a specialist.',
  },
  {
    codename: 'ASSERT',
    specialty: 'testing',
    systemPrompt:
      'You are ASSERT, a QA and testing specialist. You write comprehensive tests, identify edge cases, improve test coverage, and ensure code reliability. You advocate for testability in all code you review.',
  },
  {
    codename: 'CANVAS',
    specialty: 'frontend',
    systemPrompt:
      'You are CANVAS, a frontend specialist. You build responsive, accessible UI components with meticulous attention to styling, layout, and user experience. You follow the project\'s design system precisely.',
  },
  {
    codename: 'CRITIC',
    specialty: 'review',
    systemPrompt:
      'You are CRITIC, a code review specialist. You identify bugs, anti-patterns, security issues, and improvement opportunities. You provide actionable, specific feedback with code examples.',
  },
  {
    codename: 'DISTILL',
    specialty: 'docs',
    systemPrompt:
      'You are DISTILL, a documentation specialist. You write clear, comprehensive documentation including API docs, guides, architecture decisions, and inline comments where code isn\'t self-evident.',
  },
  {
    codename: 'GOPHER',
    specialty: 'backend',
    systemPrompt:
      'You are GOPHER, a backend specialist. You design and implement APIs, database operations, business logic, and server-side infrastructure. You prioritize correctness, performance, and error handling.',
  },
  {
    codename: 'REBASE',
    specialty: 'devops',
    systemPrompt:
      'You are REBASE, a DevOps and infrastructure specialist. You handle CI/CD pipelines, database migrations, deployment configurations, and build tooling. You ensure smooth, repeatable deployments.',
  },
  {
    codename: 'SCANNER',
    specialty: 'security',
    systemPrompt:
      'You are SCANNER, a security specialist. You audit code for vulnerabilities, implement security best practices, review authentication and authorization flows, and harden system defenses.',
  },
] as const;

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
    assetCodename: 'SCANNER',
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
    assetCodename: 'CRITIC',
  },
  {
    codename: 'RESUPPLY',
    name: 'Dependency Update',
    description: 'Update project dependencies, fix breaking changes, and verify tests pass.',
    briefingTemplate: 'Update dependencies: {{UPDATE_SCOPE}}. Run the update, then run all tests. Fix any breaking changes introduced by updates. Check changelogs for breaking changes before updating major versions. Commit each significant update separately. Do NOT update to pre-release versions.',
    variables: JSON.stringify([
      { key: 'UPDATE_SCOPE', label: 'Update Scope', description: 'Which dependencies to update', placeholder: 'all minor and patch versions' },
    ]),
    assetCodename: 'REBASE',
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
    assetCodename: 'ARCHITECT',
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
    assetCodename: 'ARCHITECT',
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
    assetCodename: 'ARCHITECT',
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
    assetCodename: 'DISTILL',
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
    assetCodename: 'ARCHITECT',
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
    assetCodename: 'CANVAS',
  },
] as const;

export function seedIfEmpty(): void {
  const db = getDatabase();
  const now = Date.now();

  // Seed assets if table is empty
  const [assetCountResult] = db.select({ value: count() }).from(assets).all();
  const assetCount = assetCountResult?.value ?? 0;

  if (assetCount === 0) {
    console.log('Seeding default assets...');
    for (const asset of DEFAULT_ASSETS) {
      db.insert(assets).values({
        id: ulid(),
        codename: asset.codename,
        specialty: asset.specialty,
        systemPrompt: asset.systemPrompt,
        model: 'claude-sonnet-4-6',
        status: 'active',
        missionsCompleted: 0,
        createdAt: now,
      }).run();
    }
    console.log(`  Inserted ${DEFAULT_ASSETS.length} assets.`);
  } else {
    console.log(`Assets table already has ${assetCount} rows, skipping.`);
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
