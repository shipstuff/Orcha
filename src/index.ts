import { startServer } from './app.js';
import { closeDatabase } from './database/index.js';
import { orchestrator } from './orchestrator/index.js';

async function main() {
  const app = await startServer();

  // Start the orchestrator
  orchestrator.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    // Stop the orchestrator
    orchestrator.stop();

    // Close the server
    await app.close();

    // Close database connection
    closeDatabase();

    app.log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
