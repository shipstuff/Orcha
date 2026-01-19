import Fastify, { FastifyInstance } from 'fastify';
import { getConfig } from './config/index.js';
import { runMigrations } from './database/migrate.js';
import { githubWebhookRoutes } from './webhook/routes/github.js';

export async function buildApp(): Promise<FastifyInstance> {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
      transport: process.env['NODE_ENV'] === 'production' ? undefined : {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // Run database migrations
  runMigrations();

  // Health check endpoint
  app.get('/health', async (_request, _reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register webhook routes
  await app.register(githubWebhookRoutes, { prefix: '/webhook' });

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const config = getConfig();
  const app = await buildApp();

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    app.log.info(`Server listening on ${config.server.host}:${config.server.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  return app;
}
