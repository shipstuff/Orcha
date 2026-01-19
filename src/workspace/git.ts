import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';
import pino from 'pino';

const execAsync = promisify(exec);
const log = pino({ name: 'git' });

export interface GitOptions {
  cwd: string;
  timeout?: number;
}

function runGit(args: string[], options: GitOptions): string {
  const command = `git ${args.join(' ')}`;

  log.debug({ command, cwd: options.cwd }, 'Running git command');

  try {
    const result = execSync(command, {
      cwd: options.cwd,
      encoding: 'utf-8',
      timeout: options.timeout ?? 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return result.trim();
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    log.error({ command, error: err.stderr ?? err.message }, 'Git command failed');
    throw error;
  }
}

async function runGitAsync(args: string[], options: GitOptions): Promise<string> {
  const command = `git ${args.join(' ')}`;

  log.debug({ command, cwd: options.cwd }, 'Running git command (async)');

  try {
    const { stdout } = await execAsync(command, {
      cwd: options.cwd,
      timeout: options.timeout ?? 300000, // 5 min for clone
    });

    return stdout.trim();
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    log.error({ command, error: err.stderr ?? err.message }, 'Git command failed');
    throw error;
  }
}

export async function cloneRepo(url: string, destPath: string, token?: string): Promise<void> {
  let cloneUrl = url;

  // Inject token if provided
  if (token && url.startsWith('https://')) {
    cloneUrl = url.replace('https://', `https://x-access-token:${token}@`);
  }

  await runGitAsync(['clone', '--depth', '1', cloneUrl, destPath], { cwd: process.cwd() });
}

export function createBranch(branchName: string, options: GitOptions): void {
  runGit(['checkout', '-b', branchName], options);
}

export function checkoutBranch(branchName: string, options: GitOptions): void {
  runGit(['checkout', branchName], options);
}

export function getCurrentBranch(options: GitOptions): string {
  return runGit(['rev-parse', '--abbrev-ref', 'HEAD'], options);
}

export function getDefaultBranch(options: GitOptions): string {
  try {
    // Try to get the default branch from remote
    const result = runGit(['remote', 'show', 'origin'], options);
    const match = result.match(/HEAD branch:\s*(\S+)/);
    return match?.[1] ?? 'main';
  } catch {
    return 'main';
  }
}

export function stageAll(options: GitOptions): void {
  runGit(['add', '-A'], options);
}

export function commit(message: string, options: GitOptions): void {
  runGit(['commit', '-m', message], options);
}

export function push(branchName: string, options: GitOptions, setUpstream = true): void {
  const args = ['push'];

  if (setUpstream) {
    args.push('-u', 'origin', branchName);
  } else {
    args.push('origin', branchName);
  }

  runGit(args, options);
}

export function hasChanges(options: GitOptions): boolean {
  try {
    const status = runGit(['status', '--porcelain'], options);
    return status.length > 0;
  } catch {
    return false;
  }
}

export function getStatus(options: GitOptions): string {
  return runGit(['status', '--short'], options);
}

export function configureUser(name: string, email: string, options: GitOptions): void {
  runGit(['config', 'user.name', name], options);
  runGit(['config', 'user.email', email], options);
}

export function setRemoteUrl(url: string, token: string, options: GitOptions): void {
  let remoteUrl = url;

  if (token && url.startsWith('https://')) {
    remoteUrl = url.replace('https://', `https://x-access-token:${token}@`);
  }

  runGit(['remote', 'set-url', 'origin', remoteUrl], options);
}

export function getDiff(options: GitOptions): string {
  return runGit(['diff'], options);
}

export function getLog(count: number, options: GitOptions): string {
  return runGit(['log', `--oneline`, `-${count}`], options);
}
