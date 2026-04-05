// ---------------------------------------------------------------------------
// System monitoring
// ---------------------------------------------------------------------------
export interface SystemMetrics {
  cores: number[];
  ram: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  uptime: number;
  assets: { active: number; max: number };
}
