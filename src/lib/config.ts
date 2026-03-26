export interface DevRoomConfig {
  port: number;
  host: string;
  dbPath: string;
  devBasePath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxAgents: number;
  claudePath: string;
  logRetentionDays: number;
}

function loadConfig(): DevRoomConfig {
  return {
    port: parseInt(process.env.DEVROOM_PORT || '7777', 10),
    host: process.env.DEVROOM_HOST || '0.0.0.0',
    dbPath: process.env.DEVROOM_DB_PATH || './devroom.db',
    devBasePath: process.env.DEVROOM_DEV_BASE_PATH || '/dev',
    logLevel: (process.env.DEVROOM_LOG_LEVEL as DevRoomConfig['logLevel']) || 'info',
    maxAgents: parseInt(process.env.DEVROOM_MAX_AGENTS || '5', 10),
    claudePath: process.env.DEVROOM_CLAUDE_PATH || 'claude',
    logRetentionDays: parseInt(process.env.DEVROOM_LOG_RETENTION_DAYS || '30', 10),
  };
}

export const config = loadConfig();
