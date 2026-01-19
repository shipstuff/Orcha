import { jobQueue } from './queue.js';
import { Job } from '../database/repositories/jobs.js';
import { issuesRepository } from '../database/repositories/issues.js';
import { sessionsRepository } from '../database/repositories/sessions.js';
import { AgentSession } from '../agent/session.js';
import { runAgent, stopAgent } from '../agent/runner.js';
import { createWorkspace, deleteWorkspace, cleanupOldWorkspaces } from '../workspace/manager.js';
import { createIssueComment, formatApprovalRequestComment, formatAgentStoppedComment } from '../github/comments.js';
import pino from 'pino';

const log = pino({ name: 'orchestrator' });

class Orchestrator {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    log.info('Starting orchestrator');

    // Register job handlers
    jobQueue.registerHandler('start_agent', this.handleStartAgent.bind(this));
    jobQueue.registerHandler('resume_agent', this.handleResumeAgent.bind(this));
    jobQueue.registerHandler('stop_agent', this.handleStopAgent.bind(this));

    // Start the job queue
    jobQueue.start();

    // Process sessions waiting for approval
    this.checkWaitingApprovals();

    // Start cleanup interval (every hour)
    this.cleanupInterval = setInterval(() => {
      cleanupOldWorkspaces(24);
    }, 60 * 60 * 1000);

    // Run initial cleanup
    cleanupOldWorkspaces(24);
  }

  stop(): void {
    log.info('Stopping orchestrator');

    jobQueue.stop();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async checkWaitingApprovals(): Promise<void> {
    // Find sessions waiting for approval that haven't had a comment posted
    const waitingSessions = sessionsRepository.findByState('waiting_approval');

    for (const sessionData of waitingSessions) {
      const issue = issuesRepository.findById(sessionData.issue_id);

      if (!issue) {
        continue;
      }

      // TODO: Post approval request comment if not already posted
      // This would require tracking whether the comment was posted
      log.debug({ sessionId: sessionData.id, issue: issue.issue_number }, 'Session waiting for approval');
    }
  }

  private async handleStartAgent(job: Job): Promise<void> {
    const payload = job.payload ? JSON.parse(job.payload) : {};
    const { installation_id, clone_url } = payload;

    if (!installation_id || !clone_url) {
      throw new Error('Missing installation_id or clone_url in job payload');
    }

    const issue = issuesRepository.findById(job.issue_id);

    if (!issue) {
      throw new Error(`Issue not found: ${job.issue_id}`);
    }

    const session = job.session_id ? AgentSession.findById(job.session_id) : null;

    if (!session) {
      throw new Error(`Session not found: ${job.session_id}`);
    }

    log.info({
      sessionId: session.id,
      issue: issue.issue_number,
      repo: `${issue.repository_owner}/${issue.repository_name}`,
    }, 'Starting agent');

    // Transition to initializing
    session.transition('start');

    // Create workspace
    const workspace = await createWorkspace({
      sessionId: session.id,
      installationId: installation_id,
      owner: issue.repository_owner,
      repo: issue.repository_name,
      cloneUrl: clone_url,
      issueNumber: issue.issue_number,
    });

    session.setWorkspace(workspace.path, workspace.branchName);

    // Build the prompt from issue details
    const prompt = buildPromptFromIssue(issue);

    // Run the agent
    try {
      await runAgent({
        session,
        installationId: installation_id,
        workspacePath: workspace.path,
        prompt,
      });
    } catch (error) {
      log.error({ error, sessionId: session.id }, 'Agent failed');
      // State transition handled in runAgent
    }
  }

  private async handleResumeAgent(job: Job): Promise<void> {
    const payload = job.payload ? JSON.parse(job.payload) : {};
    const { reply_text, installation_id } = payload;

    if (!reply_text || !installation_id) {
      throw new Error('Missing reply_text or installation_id in job payload');
    }

    const session = job.session_id ? AgentSession.findById(job.session_id) : null;

    if (!session) {
      throw new Error(`Session not found: ${job.session_id}`);
    }

    if (session.state !== 'waiting') {
      log.warn({ sessionId: session.id, state: session.state }, 'Cannot resume session not in waiting state');
      return;
    }

    const issue = issuesRepository.findById(job.issue_id);

    if (!issue) {
      throw new Error(`Issue not found: ${job.issue_id}`);
    }

    log.info({ sessionId: session.id, issue: issue.issue_number }, 'Resuming agent');

    // Clear the waiting comment ID
    session.setWaitingCommentId(null);

    // Transition to running
    session.transition('answer');

    // Resume the agent with the reply
    try {
      await runAgent({
        session,
        installationId: installation_id,
        workspacePath: session.workspacePath!,
        prompt: reply_text,
        resume: true,
        replyText: reply_text,
      });
    } catch (error) {
      log.error({ error, sessionId: session.id }, 'Agent resume failed');
    }
  }

  private async handleStopAgent(job: Job): Promise<void> {
    const session = job.session_id ? AgentSession.findById(job.session_id) : null;

    if (!session) {
      throw new Error(`Session not found: ${job.session_id}`);
    }

    const issue = issuesRepository.findById(job.issue_id);

    if (!issue) {
      throw new Error(`Issue not found: ${job.issue_id}`);
    }

    log.info({ sessionId: session.id, issue: issue.issue_number }, 'Stopping agent');

    // Stop the running process
    stopAgent(session.id);

    // Transition to stopped
    session.transition('stop');

    // Update issue state
    issuesRepository.updateState(issue.id, 'stopped');

    // Clean up workspace
    if (session.workspacePath) {
      deleteWorkspace(session.workspacePath);
    }

    // Get installation_id from most recent job
    const jobs = (await import('../database/repositories/jobs.js')).jobsRepository.findByIssueId(job.issue_id);
    const startJob = jobs.find((j) => j.job_type === 'start_agent' && j.payload);
    const payload = startJob?.payload ? JSON.parse(startJob.payload) : {};

    if (payload.installation_id) {
      await createIssueComment({
        installationId: payload.installation_id,
        owner: issue.repository_owner,
        repo: issue.repository_name,
        issueNumber: issue.issue_number,
        body: formatAgentStoppedComment(session.id, 'system'),
      });
    }
  }

  getStats(): {
    queue: { pending: number; processing: number; active: number };
  } {
    return {
      queue: jobQueue.getStats(),
    };
  }
}

function buildPromptFromIssue(issue: ReturnType<typeof issuesRepository.findById>): string {
  if (!issue) {
    return '';
  }

  let prompt = `# Task: ${issue.title}\n\n`;

  if (issue.body) {
    prompt += `## Description\n\n${issue.body}\n\n`;
  }

  prompt += `## Instructions

Please complete the task described above. After making your changes:

1. Stage and commit all changes with a descriptive commit message
2. Push the branch to origin
3. Create a pull request with a summary of your changes

If you have any questions or need clarification, ask before proceeding.`;

  return prompt;
}

export const orchestrator = new Orchestrator();
