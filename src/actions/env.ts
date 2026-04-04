'use server';

import fs from 'node:fs';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { getRepoPath } from './_helpers';
import type { EnvFileInfo, EnvVariable } from '@/types';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const ENV_FILENAME_RE = /^\.env(\.\w+)*$/;

function validateFilename(filename: string): void {
  if (!ENV_FILENAME_RE.test(filename)) {
    throw new Error(`Invalid env filename: ${filename}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isInGitignore(repoPath: string, filename: string): boolean {
  const gitignorePath = path.join(repoPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const lines = fs.readFileSync(gitignorePath, 'utf-8').split('\n');
  return lines.some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return false;
    // Exact match or glob pattern like .env*
    if (trimmed === filename) return true;
    if (trimmed === '.env*' || trimmed === '.env.*') return true;
    // Simple glob: .env* matches .env.local etc.
    if (trimmed.endsWith('*') && filename.startsWith(trimmed.slice(0, -1))) return true;
    return false;
  });
}

function parseEnvLines(content: string): EnvVariable[] {
  const lines = content.split('\n');
  const variables: EnvVariable[] = [];
  let pendingComment: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      pendingComment = undefined;
      continue;
    }

    if (trimmed.startsWith('#')) {
      pendingComment = trimmed.slice(1).trim();
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1);

    // Strip outer quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    variables.push({
      key,
      value,
      comment: pendingComment,
      lineNumber: i + 1,
    });

    pendingComment = undefined;
  }

  return variables;
}

function serializeEnvVariables(variables: EnvVariable[]): string {
  const lines: string[] = [];
  for (const v of variables) {
    if (v.comment) {
      lines.push(`# ${v.comment}`);
    }
    const needsQuotes = /[\s#"'\\$`]/.test(v.value) || v.value === '';
    const serialized = needsQuotes ? `"${v.value}"` : v.value;
    lines.push(`${v.key}=${serialized}`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function getEnvFiles(battlefieldId: string): Promise<EnvFileInfo[]> {
  const repoPath = await getRepoPath(battlefieldId);
  const entries = fs.readdirSync(repoPath, { withFileTypes: true });

  return entries
    .filter((e) => e.isFile() && ENV_FILENAME_RE.test(e.name))
    .map((e) => {
      const content = fs.readFileSync(path.join(repoPath, e.name), 'utf-8');
      const varCount = content
        .split('\n')
        .filter((line) => {
          const t = line.trim();
          return t !== '' && !t.startsWith('#') && t.includes('=');
        }).length;

      return {
        filename: e.name,
        inGitignore: isInGitignore(repoPath, e.name),
        varCount,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function getEnvFileContents(
  battlefieldId: string,
  filename: string,
): Promise<EnvVariable[]> {
  validateFilename(filename);
  const repoPath = await getRepoPath(battlefieldId);
  const filePath = path.join(repoPath, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseEnvLines(content);
}

export async function getEnvExample(
  battlefieldId: string,
): Promise<EnvVariable[] | null> {
  const repoPath = await getRepoPath(battlefieldId);
  const examplePath = path.join(repoPath, '.env.example');
  if (!fs.existsSync(examplePath)) return null;
  const content = fs.readFileSync(examplePath, 'utf-8');
  return parseEnvLines(content);
}

export async function saveEnvFile(
  battlefieldId: string,
  filename: string,
  variables: EnvVariable[],
): Promise<void> {
  validateFilename(filename);
  const repoPath = await getRepoPath(battlefieldId);
  const filePath = path.join(repoPath, filename);
  fs.writeFileSync(filePath, serializeEnvVariables(variables), 'utf-8');
  revalidatePath(`/battlefields/${battlefieldId}/env`);
}

export async function createEnvFile(
  battlefieldId: string,
  filename: string,
): Promise<void> {
  validateFilename(filename);
  const repoPath = await getRepoPath(battlefieldId);
  const filePath = path.join(repoPath, filename);
  fs.writeFileSync(filePath, '', 'utf-8');
  revalidatePath(`/battlefields/${battlefieldId}/env`);
}

export async function deleteEnvFile(
  battlefieldId: string,
  filename: string,
): Promise<void> {
  validateFilename(filename);
  const repoPath = await getRepoPath(battlefieldId);
  const filePath = path.join(repoPath, filename);
  fs.unlinkSync(filePath);
  revalidatePath(`/battlefields/${battlefieldId}/env`);
}
