import { count } from 'drizzle-orm';
import { ulid } from 'ulid';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from '../src/lib/db/index';
import { assets, battlefields } from '../src/lib/db/schema';

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
}

const isDirectRun = process.argv[1]?.includes('seed');
if (isDirectRun) {
  seedIfEmpty();
  closeDatabase();
  console.log('Seed complete.');
}
