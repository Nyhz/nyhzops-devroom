// ---------------------------------------------------------------------------
// Dependency Manager
// ---------------------------------------------------------------------------
export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export interface DepEntry {
  name: string;
  version: string;
  isDev: boolean;
}

export interface DepsResult {
  packageManager: PackageManager;
  deps: DepEntry[];
  devDeps: DepEntry[];
}

export interface OutdatedDep {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  isDev: boolean;
}

export interface AuditVulnerability {
  name: string;
  severity: string;
  title: string;
  url?: string;
}

export interface AuditResult {
  vulnerabilities: AuditVulnerability[];
  summary: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
  };
}
