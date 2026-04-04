'use server';

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { revalidatePath } from 'next/cache';
import { getRepoPath } from './_helpers';
import { runCommand } from '@/lib/process/command-runner';
import type {
  PackageManager,
  DepEntry,
  DepsResult,
  OutdatedDep,
  AuditVulnerability,
  AuditResult,
} from '@/types';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const PACKAGE_NAME_RE =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^\s]+)?$/;

function validatePackageName(name: string): void {
  if (!PACKAGE_NAME_RE.test(name)) {
    throw new Error(`Invalid package name: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getInstallCmd(pm: PackageManager): string {
  return pm === 'npm' ? 'install' : 'add';
}

function getRemoveCmd(pm: PackageManager): string {
  return pm === 'npm' ? 'uninstall' : 'remove';
}

function getDevFlag(pm: PackageManager): string {
  return pm === 'npm' ? '--save-dev' : '-D';
}

function readPackageJson(repoPath: string): Record<string, unknown> {
  const pkgPath = path.join(repoPath, 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
}

function getDevDependencyNames(repoPath: string): Set<string> {
  const pkg = readPackageJson(repoPath);
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  return new Set(Object.keys(devDeps));
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function detectPackageManager(
  battlefieldId: string,
): Promise<PackageManager> {
  const repoPath = await getRepoPath(battlefieldId);

  if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(repoPath, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(repoPath, 'package-lock.json'))) return 'npm';

  return 'npm';
}

export async function getDependencies(
  battlefieldId: string,
): Promise<DepsResult> {
  const repoPath = await getRepoPath(battlefieldId);
  const pkg = readPackageJson(repoPath);
  const pm = await detectPackageManager(battlefieldId);

  const dependencies = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDependencies = (pkg.devDependencies ?? {}) as Record<string, string>;

  const deps: DepEntry[] = Object.entries(dependencies).map(
    ([name, version]) => ({ name, version, isDev: false }),
  );

  const devDeps: DepEntry[] = Object.entries(devDependencies).map(
    ([name, version]) => ({ name, version, isDev: true }),
  );

  return { packageManager: pm, deps, devDeps };
}

export async function getOutdatedDeps(
  battlefieldId: string,
): Promise<OutdatedDep[]> {
  const repoPath = await getRepoPath(battlefieldId);
  const pm = await detectPackageManager(battlefieldId);
  const devNames = getDevDependencyNames(repoPath);

  let jsonOutput: string;
  try {
    jsonOutput = execSync(`${pm} outdated --json`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    // pnpm/npm outdated exits non-zero when outdated deps exist
    const execErr = err as { stdout?: string; stderr?: string };
    if (execErr.stdout) {
      jsonOutput = execErr.stdout;
    } else {
      return [];
    }
  }

  if (!jsonOutput.trim()) return [];

  const parsed = JSON.parse(jsonOutput);

  // yarn outdated --json outputs newline-delimited JSON, not a single object
  // pnpm and npm return { "package-name": { current, latest, wanted } }
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.entries(parsed).map(([name, info]) => {
      const dep = info as { current?: string; wanted?: string; latest?: string };
      return {
        name,
        current: dep.current ?? 'unknown',
        wanted: dep.wanted ?? dep.current ?? 'unknown',
        latest: dep.latest ?? 'unknown',
        isDev: devNames.has(name),
      };
    });
  }

  // yarn array format
  if (Array.isArray(parsed)) {
    return parsed.map((entry) => ({
      name: entry.name ?? entry[0],
      current: entry.current ?? entry[1] ?? 'unknown',
      wanted: entry.wanted ?? entry[2] ?? 'unknown',
      latest: entry.latest ?? entry[3] ?? 'unknown',
      isDev: devNames.has(entry.name ?? entry[0]),
    }));
  }

  return [];
}

export async function installPackage(
  battlefieldId: string,
  name: string,
  isDev: boolean,
): Promise<void> {
  validatePackageName(name);
  const repoPath = await getRepoPath(battlefieldId);
  const pm = await detectPackageManager(battlefieldId);
  const devFlag = isDev ? ` ${getDevFlag(pm)}` : '';
  const command = `${pm} ${getInstallCmd(pm)}${devFlag} ${name}`;

  await runCommand({
    command,
    cwd: repoPath,
    socketRoom: `deps:${battlefieldId}`,
    battlefieldId,
  });

  revalidatePath(`/battlefields/${battlefieldId}/deps`);
}

export async function removePackage(
  battlefieldId: string,
  name: string,
): Promise<void> {
  validatePackageName(name);
  const repoPath = await getRepoPath(battlefieldId);
  const pm = await detectPackageManager(battlefieldId);
  const command = `${pm} ${getRemoveCmd(pm)} ${name}`;

  await runCommand({
    command,
    cwd: repoPath,
    socketRoom: `deps:${battlefieldId}`,
    battlefieldId,
  });

  revalidatePath(`/battlefields/${battlefieldId}/deps`);
}

export async function updatePackage(
  battlefieldId: string,
  name?: string,
): Promise<void> {
  if (name) validatePackageName(name);
  const repoPath = await getRepoPath(battlefieldId);
  const pm = await detectPackageManager(battlefieldId);
  const command = name ? `${pm} update ${name}` : `${pm} update`;

  await runCommand({
    command,
    cwd: repoPath,
    socketRoom: `deps:${battlefieldId}`,
    battlefieldId,
  });

  revalidatePath(`/battlefields/${battlefieldId}/deps`);
}

export async function runInstall(battlefieldId: string): Promise<void> {
  const repoPath = await getRepoPath(battlefieldId);
  const pm = await detectPackageManager(battlefieldId);

  await runCommand({
    command: `${pm} install`,
    cwd: repoPath,
    socketRoom: `deps:${battlefieldId}`,
    battlefieldId,
  });

  revalidatePath(`/battlefields/${battlefieldId}/deps`);
}

export async function runAudit(battlefieldId: string): Promise<AuditResult> {
  const repoPath = await getRepoPath(battlefieldId);
  const pm = await detectPackageManager(battlefieldId);

  let jsonOutput: string;
  try {
    jsonOutput = execSync(`${pm} audit --json`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    // audit exits non-zero when vulnerabilities exist
    const execErr = err as { stdout?: string };
    if (execErr.stdout) {
      jsonOutput = execErr.stdout;
    } else {
      return { vulnerabilities: [], summary: { critical: 0, high: 0, moderate: 0, low: 0 } };
    }
  }

  if (!jsonOutput.trim()) {
    return { vulnerabilities: [], summary: { critical: 0, high: 0, moderate: 0, low: 0 } };
  }

  const parsed = JSON.parse(jsonOutput);
  const vulnerabilities: AuditVulnerability[] = [];
  const summary = { critical: 0, high: 0, moderate: 0, low: 0 };

  if (pm === 'pnpm') {
    // pnpm audit --json: { advisories: { [id]: { module_name, severity, title, url } } }
    const advisories = parsed.advisories ?? {};
    for (const advisory of Object.values(advisories)) {
      const adv = advisory as {
        module_name: string;
        severity: string;
        title: string;
        url?: string;
      };
      vulnerabilities.push({
        name: adv.module_name,
        severity: adv.severity,
        title: adv.title,
        url: adv.url,
      });
      const sev = adv.severity as keyof typeof summary;
      if (sev in summary) summary[sev]++;
    }
  } else {
    // npm audit --json: { vulnerabilities: { [name]: { severity, via: [{ title, url }] } } }
    const vulns = parsed.vulnerabilities ?? {};
    for (const [name, info] of Object.entries(vulns)) {
      const vuln = info as {
        severity: string;
        via: Array<{ title?: string; url?: string } | string>;
      };
      const firstVia = vuln.via.find(
        (v): v is { title?: string; url?: string } => typeof v === 'object',
      );
      vulnerabilities.push({
        name,
        severity: vuln.severity,
        title: firstVia?.title ?? name,
        url: firstVia?.url,
      });
      const sev = vuln.severity as keyof typeof summary;
      if (sev in summary) summary[sev]++;
    }
  }

  return { vulnerabilities, summary };
}
