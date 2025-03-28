// config.ts
export interface SpiceDBMCPConfig {
  spicedbUrl: string;
  spicedbApiKey: string;
  serverPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const defaultConfig: SpiceDBMCPConfig = {
  spicedbUrl: process.env.SPICEDB_URL || 'http://localhost:50051',
  spicedbApiKey: process.env.SPICEDB_API_KEY || '',
  serverPort: parseInt(process.env.PORT || '3000', 10),
  logLevel: (process.env.LOG_LEVEL as any) || 'info'
};

export function loadConfig(): SpiceDBMCPConfig {
  // Load from environment variables by default
  return {
    ...defaultConfig,
    // Additional configuration loading logic could be added here
    // For example, loading from a config file
  };
}
