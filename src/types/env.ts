// ---------------------------------------------------------------------------
// Environment Variable Manager
// ---------------------------------------------------------------------------
export interface EnvFileInfo {
  filename: string;
  inGitignore: boolean;
  varCount: number;
}

export interface EnvVariable {
  key: string;
  value: string;
  comment?: string;
  lineNumber: number;
}
