import { spawn, ChildProcess } from 'node:child_process';
import { getConfig } from '../config/index.js';
import { AgentSession } from './session.js';
import { parseAgentOutput, ParsedOutput } from './output-parser.js';
import { issuesRepository } from '../database/repositories/issues.js';
import { createIssueComment, formatAgentQuestionComment, formatAgentStartedComment, formatAgentCompletedComment, formatAgentFailedComment } from '../github/comments.js';
import { createPullRequest, formatPullRequestBody, getDefaultBranch } from '../github/pulls.js';
import pino from 'pino';

const log = pino({ name: 'agent-runner' });

interface RunAgentOptions {
  session: AgentSession;
  installationId: number;
  workspacePath: string;
  prompt: string;
  resume?: boolean;
  replyText?: string;
}

const activeProcesses = new Map<string, ChildProcess>();

export async function runAgent(options: RunAgentOptions): Promise<void> {
  const { session, installationId, workspacePath, prompt, resume, replyText } = options;
  const config = getConfig();

  // Get issue details
  const issue = issuesRepository.findById(session.issueId);
  if (!issue) {
    throw new Error(`Issue not found: ${session.issueId}`);
  }

  // Build Claude Code command
  const args: string[] = [
    '--print',
    '--output-format', 'stream-json',
    '--max-turns', '50',
  ];

  // Resume from previous session if available
  if (resume && session.claudeSessionId) {
    args.push('--resume', session.claudeSessionId);
  }

  // Add the prompt or reply
  if (replyText) {
    args.push(replyText);
  } else {
    args.push(prompt);
  }

  log.info({
    sessionId: session.id,
    workspacePath,
    resume,
  }, 'Starting Claude Code');

  // Spawn Claude Code
  const child = spawn('claude', args, {
    cwd: workspacePath,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: config.anthropic.apiKey,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeProcesses.set(session.id, child);

  let output = '';
  let lastParsed: ParsedOutput | null = null;
  let claudeSessionId: string | null = null;

  // Transition to running state
  session.transition('initialized');

  // Post started comment
  await createIssueComment({
    installationId,
    owner: issue.repository_owner,
    repo: issue.repository_name,
    issueNumber: issue.issue_number,
    body: formatAgentStartedComment(session.id),
  });

  child.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    output += chunk;

    // Try to parse each line as JSON (stream-json format)
    const lines = chunk.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);

        // Extract session ID from JSON output
        if (json.session_id && !claudeSessionId) {
          claudeSessionId = json.session_id;
          session.setClaudeSessionId(claudeSessionId);
        }

        // Track token usage
        if (json.usage) {
          const inputTokens = json.usage.input_tokens ?? 0;
          const outputTokens = json.usage.output_tokens ?? 0;
          // Estimate cost (claude-3.5-sonnet pricing)
          const costCents = Math.round((inputTokens * 0.003 + outputTokens * 0.015) * 100);
          session.recordTokenUsage(inputTokens, outputTokens, costCents);
        }

        // Log progress
        if (json.type === 'assistant' && json.content) {
          log.debug({ sessionId: session.id, content: json.content.slice(0, 100) }, 'Agent output');
        }
      } catch {
        // Not JSON, just raw output
        log.trace({ chunk: line.slice(0, 200) }, 'Raw output');
      }
    }

    lastParsed = parseAgentOutput(output);
  });

  child.stderr?.on('data', (data: Buffer) => {
    log.warn({ sessionId: session.id, stderr: data.toString() }, 'Agent stderr');
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => {
      log.warn({ sessionId: session.id }, 'Agent timeout');
      child.kill('SIGTERM');

      session.transition('error', 'Agent timeout');

      await createIssueComment({
        installationId,
        owner: issue.repository_owner,
        repo: issue.repository_name,
        issueNumber: issue.issue_number,
        body: formatAgentFailedComment(session.id, 'Agent timed out'),
      });

      reject(new Error('Agent timeout'));
    }, config.agent.timeoutMinutes * 60 * 1000);

    child.on('close', async (code) => {
      clearTimeout(timeout);
      activeProcesses.delete(session.id);

      log.info({ sessionId: session.id, code }, 'Agent process exited');

      try {
        await handleAgentCompletion({
          session,
          issue,
          installationId,
          workspacePath,
          output,
          exitCode: code ?? 0,
          parsed: lastParsed,
        });
        resolve();
      } catch (error) {
        log.error({ error, sessionId: session.id }, 'Error handling agent completion');
        reject(error);
      }
    });

    child.on('error', async (error) => {
      clearTimeout(timeout);
      activeProcesses.delete(session.id);

      log.error({ error, sessionId: session.id }, 'Agent process error');

      session.transition('error', error.message);

      await createIssueComment({
        installationId,
        owner: issue.repository_owner,
        repo: issue.repository_name,
        issueNumber: issue.issue_number,
        body: formatAgentFailedComment(session.id, error.message),
      });

      reject(error);
    });
  });
}

interface HandleCompletionOptions {
  session: AgentSession;
  issue: ReturnType<typeof issuesRepository.findById>;
  installationId: number;
  workspacePath: string;
  output: string;
  exitCode: number;
  parsed: ParsedOutput | null;
}

async function handleAgentCompletion(options: HandleCompletionOptions): Promise<void> {
  const { session, issue, installationId, workspacePath, output, exitCode, parsed } = options;

  if (!issue) return;

  // Check if agent is asking a question
  if (parsed?.type === 'question') {
    log.info({ sessionId: session.id }, 'Agent is asking a question');

    session.transition('question');

    const comment = await createIssueComment({
      installationId,
      owner: issue.repository_owner,
      repo: issue.repository_name,
      issueNumber: issue.issue_number,
      body: formatAgentQuestionComment(parsed.content, session.id),
    });

    session.setWaitingCommentId(comment.id);
    return;
  }

  // Check for errors
  if (exitCode !== 0 || parsed?.type === 'error') {
    const errorMessage = parsed?.content ?? `Exit code: ${exitCode}`;
    log.error({ sessionId: session.id, errorMessage }, 'Agent failed');

    session.transition('error', errorMessage);

    await createIssueComment({
      installationId,
      owner: issue.repository_owner,
      repo: issue.repository_name,
      issueNumber: issue.issue_number,
      body: formatAgentFailedComment(session.id, errorMessage),
    });

    issuesRepository.updateState(issue.id, 'failed');
    return;
  }

  // Agent completed successfully
  log.info({ sessionId: session.id }, 'Agent completed');
  session.transition('completing');

  let prUrl: string | null = parsed?.prUrl ?? null;

  // If no PR URL in output, try to create one
  if (!prUrl && session.branchName) {
    try {
      const defaultBranch = await getDefaultBranch(installationId, issue.repository_owner, issue.repository_name);

      const pr = await createPullRequest({
        installationId,
        owner: issue.repository_owner,
        repo: issue.repository_name,
        title: `[Agent] ${issue.title}`,
        body: formatPullRequestBody(issue.issue_number, session.id),
        head: session.branchName,
        base: defaultBranch,
      });

      prUrl = pr.html_url;
      log.info({ prUrl, sessionId: session.id }, 'Created pull request');
    } catch (error) {
      log.warn({ error, sessionId: session.id }, 'Failed to create PR (may not have changes)');
    }
  }

  session.transition('completed');
  issuesRepository.updateState(issue.id, 'completed');

  const tokenSummary = session.getTokenSummary();

  await createIssueComment({
    installationId,
    owner: issue.repository_owner,
    repo: issue.repository_name,
    issueNumber: issue.issue_number,
    body: formatAgentCompletedComment(session.id, prUrl, tokenSummary),
  });
}

export function stopAgent(sessionId: string): boolean {
  const process = activeProcesses.get(sessionId);

  if (process) {
    log.info({ sessionId }, 'Stopping agent');
    process.kill('SIGTERM');
    activeProcesses.delete(sessionId);
    return true;
  }

  return false;
}

export function isAgentRunning(sessionId: string): boolean {
  return activeProcesses.has(sessionId);
}
