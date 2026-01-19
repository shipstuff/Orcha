import { z } from 'zod';

const configSchema = z.object({
  github: z.object({
    appId: z.string().min(1, 'GITHUB_APP_ID is required'),
    privateKey: z.string().min(1, 'GITHUB_PRIVATE_KEY is required'),
    webhookSecret: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  }),
  anthropic: z.object({
    apiKey: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  }),
  database: z.object({
    path: z.string().default('./data/orcha.db'),
  }),
  workspace: z.object({
    dir: z.string().default('./workspaces'),
  }),
  server: z.object({
    port: z.number().int().positive().default(3000),
    host: z.string().default('0.0.0.0'),
  }),
  auth: z.object({
    approvedUsers: z.array(z.string()).default([]),
    maintainers: z.array(z.string()).default([]),
  }),
  agent: z.object({
    maxConcurrent: z.number().int().positive().default(3),
    timeoutMinutes: z.number().int().positive().default(60),
  }),
  triggerLabel: z.string().default('agent-work'),
});

export type Config = z.infer<typeof configSchema>;

function parseCommaSeparatedList(value: string | undefined): string[] {
  if (!value || value.trim() === '') {
    return [];
  }
  return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function parsePrivateKey(value: string | undefined): string {
  if (!value) {
    return '';
  }
  // Handle escaped newlines in environment variables
  return value.replace(/\\n/g, '\n');
}

export function loadConfig(): Config {
  const env = process.env;

  const rawConfig = {
    github: {
      appId: env['GITHUB_APP_ID'] ?? '',
      privateKey: parsePrivateKey(env['GITHUB_PRIVATE_KEY']),
      webhookSecret: env['GITHUB_WEBHOOK_SECRET'] ?? '',
    },
    anthropic: {
      apiKey: env['ANTHROPIC_API_KEY'] ?? '',
    },
    database: {
      path: env['DATABASE_PATH'] ?? './data/orcha.db',
    },
    workspace: {
      dir: env['WORKSPACE_DIR'] ?? './workspaces',
    },
    server: {
      port: parseInt(env['PORT'] ?? '3000', 10),
      host: env['HOST'] ?? '0.0.0.0',
    },
    auth: {
      approvedUsers: parseCommaSeparatedList(env['APPROVED_USERS']),
      maintainers: parseCommaSeparatedList(env['MAINTAINERS']),
    },
    agent: {
      maxConcurrent: parseInt(env['MAX_CONCURRENT_AGENTS'] ?? '3', 10),
      timeoutMinutes: parseInt(env['AGENT_TIMEOUT_MINUTES'] ?? '60', 10),
    },
    triggerLabel: env['TRIGGER_LABEL'] ?? 'agent-work',
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

let config: Config | null = null;

export function getConfig(): Config {
  if (!config) {
    config = loadConfig();
  }
  return config;
}
