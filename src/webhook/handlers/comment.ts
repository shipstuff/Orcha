import { FastifyBaseLogger } from 'fastify';
import { getConfig } from '../../config/index.js';
import { issuesRepository } from '../../database/repositories/issues.js';
import { sessionsRepository } from '../../database/repositories/sessions.js';
import { jobsRepository } from '../../database/repositories/jobs.js';
import { parseCommand, Command } from '../../orchestrator/approval.js';

interface CommentPayload {
  action: string;
  issue?: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    user: { login: string };
    labels: Array<{ name: string }>;
  };
  comment?: {
    id: number;
    body: string;
    user: { login: string };
    in_reply_to_id?: number;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    clone_url: string;
  };
  installation?: {
    id: number;
  };
  sender: {
    login: string;
  };
}

export async function handleCommentEvent(payload: CommentPayload, log: FastifyBaseLogger): Promise<void> {
  const { action, comment, issue, repository, sender } = payload;

  if (action !== 'created' || !comment || !issue) {
    return;
  }

  log.debug({ comment: comment.id, issue: issue.number }, 'Processing comment');

  // Find the tracked issue
  const issueRecord = issuesRepository.findByRepoAndNumber(
    repository.owner.login,
    repository.name,
    issue.number
  );

  if (!issueRecord) {
    log.debug({ issue: issue.number }, 'Issue not tracked');
    return;
  }

  // Check for commands (/approve, /stop, /restart)
  const command = parseCommand(comment.body);

  if (command) {
    await handleCommand(command, issueRecord.id, sender.login, payload, log);
    return;
  }

  // Check if this is a reply to a waiting comment (agent question)
  const session = sessionsRepository.findActiveSession(issueRecord.id);

  if (session && session.state === 'waiting' && session.waiting_comment_id) {
    // Check if this comment is a reply to the agent's question
    // GitHub's in_reply_to_id indicates the comment being replied to
    if (comment.in_reply_to_id === session.waiting_comment_id) {
      log.info({ session: session.id, comment: comment.id }, 'Received reply to agent question');

      jobsRepository.create({
        issue_id: issueRecord.id,
        session_id: session.id,
        job_type: 'resume_agent',
        payload: {
          reply_text: comment.body,
          installation_id: payload.installation?.id,
        },
      });
    }
  }
}

async function handleCommand(
  command: Command,
  issueId: number,
  sender: string,
  payload: CommentPayload,
  log: FastifyBaseLogger
): Promise<void> {
  const config = getConfig();

  // Check if sender is authorized
  const isMaintainer = config.auth.maintainers.includes(sender);
  const isApprovedUser = config.auth.approvedUsers.includes(sender);
  const isAuthorized = isMaintainer || isApprovedUser;

  if (!isAuthorized) {
    log.info({ sender, command: command.type }, 'Unauthorized command attempt');
    return;
  }

  const session = sessionsRepository.findActiveSession(issueId);
  const issueRecord = issuesRepository.findById(issueId);

  switch (command.type) {
    case 'approve':
      if (!session || session.state !== 'waiting_approval') {
        log.debug({ session: session?.id }, 'No session waiting for approval');
        return;
      }

      log.info({ session: session.id, approver: sender }, 'Agent approved');

      issuesRepository.updateApproval(issueId, 'approved', sender);
      sessionsRepository.updateState(session.id, 'approved');

      jobsRepository.create({
        issue_id: issueId,
        session_id: session.id,
        job_type: 'start_agent',
        payload: {
          installation_id: payload.installation?.id,
          clone_url: payload.repository.clone_url,
        },
      });
      break;

    case 'reject':
      if (!session || session.state !== 'waiting_approval') {
        log.debug({ session: session?.id }, 'No session waiting for approval');
        return;
      }

      log.info({ session: session.id, rejector: sender }, 'Agent rejected');

      issuesRepository.updateApproval(issueId, 'rejected', sender);
      sessionsRepository.updateState(session.id, 'stopped');
      break;

    case 'stop':
      if (!session || ['completed', 'failed', 'stopped'].includes(session.state)) {
        log.debug({ session: session?.id }, 'No active session to stop');
        return;
      }

      log.info({ session: session.id, stopper: sender }, 'Stopping agent');

      jobsRepository.create({
        issue_id: issueId,
        session_id: session.id,
        job_type: 'stop_agent',
      });
      break;

    case 'restart':
      log.info({ issueId, restarter: sender }, 'Restarting agent');

      // Create a new session
      const newSession = sessionsRepository.create({
        issue_id: issueId,
        state: 'approved',
      });

      jobsRepository.create({
        issue_id: issueId,
        session_id: newSession.id,
        job_type: 'start_agent',
        payload: {
          installation_id: payload.installation?.id,
          clone_url: payload.repository.clone_url,
        },
      });
      break;
  }
}
