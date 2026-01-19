import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { getConfig } from '../config/index.js';
import { getDatabase } from '../database/index.js';

interface InstallationToken {
  installation_id: number;
  token: string;
  expires_at: string;
}

const tokenCache = new Map<number, { token: string; expiresAt: Date }>();

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const config = getConfig();

  // Check cache first
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return new Octokit({ auth: cached.token });
  }

  // Create app auth
  const appAuth = createAppAuth({
    appId: config.github.appId,
    privateKey: config.github.privateKey,
  });

  // Get installation access token
  const installationAuth = await appAuth({
    type: 'installation',
    installationId,
  });

  // Cache the token
  const expiresAt = new Date(Date.now() + 55 * 60 * 1000); // ~55 minutes
  tokenCache.set(installationId, {
    token: installationAuth.token,
    expiresAt,
  });

  // Also persist to database for recovery after restart
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO installation_tokens (installation_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(installationId, installationAuth.token, expiresAt.toISOString());

  return new Octokit({ auth: installationAuth.token });
}

export async function getAppOctokit(): Promise<Octokit> {
  const config = getConfig();

  const appAuth = createAppAuth({
    appId: config.github.appId,
    privateKey: config.github.privateKey,
  });

  const auth = await appAuth({ type: 'app' });

  return new Octokit({ auth: auth.token });
}

export function clearTokenCache(installationId?: number): void {
  if (installationId !== undefined) {
    tokenCache.delete(installationId);
  } else {
    tokenCache.clear();
  }
}
