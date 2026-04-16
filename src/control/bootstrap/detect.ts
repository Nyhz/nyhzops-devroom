import fs from 'node:fs/promises';
import path from 'node:path';

export interface DetectedGates {
  build: string | null;
  test: string | null;
  lint: string | null;
  typecheck: string | null;
}

export async function detectGates(repoPath: string): Promise<DetectedGates> {
  const hasFile = async (p: string) =>
    fs
      .access(path.join(repoPath, p))
      .then(() => true)
      .catch(() => false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pkg: any = null;
  if (await hasFile('package.json')) {
    try {
      pkg = JSON.parse(await fs.readFile(path.join(repoPath, 'package.json'), 'utf8'));
    } catch {
      // ignore malformed package.json
    }
  }

  const scripts = pkg?.scripts ?? {};
  const gates: DetectedGates = { build: null, test: null, lint: null, typecheck: null };

  // TS/JS detection
  if (pkg) {
    if (scripts.test) gates.test = 'pnpm test';
    if (scripts.build) gates.build = 'pnpm build';
    if (scripts.lint) gates.lint = 'pnpm lint';
    if (scripts.typecheck) gates.typecheck = 'pnpm typecheck';
    else if (await hasFile('tsconfig.json')) gates.typecheck = 'tsc --noEmit';
  }

  // Python
  if (
    !gates.test &&
    ((await hasFile('pyproject.toml')) ||
      (await hasFile('pytest.ini')) ||
      (await hasFile('setup.py')))
  ) {
    gates.test = 'pytest';
  }

  // Go
  if (!gates.test && (await hasFile('go.mod'))) {
    gates.test = 'go test ./...';
    if (!gates.build) gates.build = 'go build ./...';
  }

  // Rust
  if (!gates.test && (await hasFile('Cargo.toml'))) {
    gates.test = 'cargo test';
    if (!gates.build) gates.build = 'cargo build';
  }

  return gates;
}
