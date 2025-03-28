// src/index.ts
import SpiceDBMCPServer from './server';
import { loadConfig } from './config';
import winston from 'winston';

// Setup logging
const logger = winston.createLogger({
  level: loadConfig().logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Start the server
try {
  const config = loadConfig();
  logger.info('Starting SpiceDB MCP server with configuration', {
    spicedbUrl: config.spicedbUrl,
    serverPort: config.serverPort,
    logLevel: config.logLevel
  });

  if (!config.spicedbApiKey) {
    logger.warn('No SpiceDB API key provided. Set SPICEDB_API_KEY environment variable.');
  }

  const server = new SpiceDBMCPServer(
    config.spicedbUrl,
    config.spicedbApiKey,
    config.serverPort
  );
  
  server.start();
  logger.info(`SpiceDB MCP server running on port ${config.serverPort}`);
} catch (error) {
  logger.error('Error starting SpiceDB MCP server', { error });
  process.exit(1);
}
