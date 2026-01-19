import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/index.js';
import { getInstallationOctokit } from '../github/client.js';
import * as git from './git.js';
import pino from 'pino';

const log = pino({ name: 'workspace' });

export interface WorkspaceInfo {
  path: string;
  branchName: string;
}

export interface CreateWorkspaceParams {
  sessionId: string;
  installationId: number;
  owner: string;
  repo: string;
  cloneUrl: string;
  issueNumber: number;
}

export async function createWorkspace(params: CreateWorkspaceParams): Promise<WorkspaceInfo> {
  const config = getConfig();
  const { sessionId, installationId, owner, repo, cloneUrl, issueNumber } = params;

  // Ensure workspace directory exists
  if (!fs.existsSync(config.workspace.dir)) {
    fs.mkdirSync(config.workspace.dir, { recursive: true });
  }

  // Create unique workspace path
  const workspacePath = path.join(config.workspace.dir, `${owner}-${repo}-${sessionId}`);

  log.info({ workspacePath, repo: `${owner}/${repo}` }, 'Creating workspace');

  // Get installation token for clone
  const octokit = await getInstallationOctokit(installationId);
  const auth = await octokit.auth() as { token: string };

  // Clone the repository
  await git.cloneRepo(cloneUrl, workspacePath, auth.token);

  // Configure git user
  git.configureUser('Orcha Agent', 'orcha-agent@users.noreply.github.com', { cwd: workspacePath });

  // Set up remote with token for pushing
  git.setRemoteUrl(cloneUrl, auth.token, { cwd: workspacePath });

  // Create a branch for the work
  const branchName = `orcha/issue-${issueNumber}-${sessionId.slice(0, 8)}`;
  git.createBranch(branchName, { cwd: workspacePath });

  log.info({ workspacePath, branchName }, 'Workspace created');

  return {
    path: workspacePath,
    branchName,
  };
}

export function deleteWorkspace(workspacePath: string): void {
  if (!workspacePath || !fs.existsSync(workspacePath)) {
    return;
  }

  const config = getConfig();

  // Safety check: only delete from workspace directory
  const normalizedPath = path.resolve(workspacePath);
  const normalizedWorkspaceDir = path.resolve(config.workspace.dir);

  if (!normalizedPath.startsWith(normalizedWorkspaceDir)) {
    log.error({ workspacePath }, 'Refusing to delete path outside workspace directory');
    return;
  }

  log.info({ workspacePath }, 'Deleting workspace');

  try {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  } catch (error) {
    log.error({ error, workspacePath }, 'Failed to delete workspace');
  }
}

export function cleanupOldWorkspaces(maxAgeHours = 24): void {
  const config = getConfig();

  if (!fs.existsSync(config.workspace.dir)) {
    return;
  }

  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();

  const entries = fs.readdirSync(config.workspace.dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(config.workspace.dir, entry.name);

    try {
      const stats = fs.statSync(fullPath);
      const age = now - stats.mtimeMs;

      if (age > maxAgeMs) {
        log.info({ path: fullPath, ageHours: Math.round(age / (60 * 60 * 1000)) }, 'Cleaning up old workspace');
        deleteWorkspace(fullPath);
      }
    } catch (error) {
      log.warn({ error, path: fullPath }, 'Failed to check workspace age');
    }
  }
}

export function getWorkspaceStats(): { count: number; totalSizeBytes: number } {
  const config = getConfig();

  if (!fs.existsSync(config.workspace.dir)) {
    return { count: 0, totalSizeBytes: 0 };
  }

  let count = 0;
  let totalSizeBytes = 0;

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (path.dirname(fullPath) === config.workspace.dir) {
          count++;
        }
        walkDir(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        totalSizeBytes += stats.size;
      }
    }
  }

  try {
    walkDir(config.workspace.dir);
  } catch {
    // Ignore errors
  }

  return { count, totalSizeBytes };
}
