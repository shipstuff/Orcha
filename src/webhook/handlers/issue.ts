import { FastifyBaseLogger } from 'fastify';
import { getConfig } from '../../config/index.js';
import { issuesRepository } from '../../database/repositories/issues.js';
import { sessionsRepository } from '../../database/repositories/sessions.js';
import { jobsRepository } from '../../database/repositories/jobs.js';

interface IssuePayload {
  action: string;
  issue?: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    user: { login: string };
    labels: Array<{ name: string }>;
  };
  label?: {
    name: string;
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

export async function handleIssueEvent(payload: IssuePayload, log: FastifyBaseLogger): Promise<void> {
  const config = getConfig();
  const { action, issue, repository, label } = payload;

  if (!issue) {
    log.warn('Issue event received without issue data');
    return;
  }

  // Check if the trigger label was added
  if (action === 'labeled' && label?.name === config.triggerLabel) {
    log.info({ issue: issue.number, repo: repository.full_name }, 'Trigger label added');
    await handleLabeledEvent(payload, log);
    return;
  }

  // Check if the trigger label was removed
  if (action === 'unlabeled' && label?.name === config.triggerLabel) {
    log.info({ issue: issue.number, repo: repository.full_name }, 'Trigger label removed');
    await handleUnlabeledEvent(payload, log);
    return;
  }

  // Handle issue opened with trigger label already present
  if (action === 'opened') {
    const hasLabel = issue.labels.some((l) => l.name === config.triggerLabel);
    if (hasLabel) {
      log.info({ issue: issue.number, repo: repository.full_name }, 'Issue opened with trigger label');
      await handleLabeledEvent(payload, log);
    }
  }
}

async function handleLabeledEvent(payload: IssuePayload, log: FastifyBaseLogger): Promise<void> {
  const config = getConfig();
  const { issue, repository, sender } = payload;

  if (!issue) return;

  // Create or update the issue record
  const issueRecord = issuesRepository.create({
    github_issue_id: issue.id,
    repository_owner: repository.owner.login,
    repository_name: repository.name,
    issue_number: issue.number,
    title: issue.title,
    body: issue.body,
    author: issue.user.login,
  });

  // Check if user is pre-approved
  const isApproved = config.auth.approvedUsers.includes(sender.login) ||
                     config.auth.maintainers.includes(sender.login);

  if (isApproved) {
    log.info({ user: sender.login, issue: issue.number }, 'User is pre-approved, starting agent');
    issuesRepository.updateApproval(issueRecord.id, 'approved', sender.login);

    // Create session and queue job to start agent
    const session = sessionsRepository.create({
      issue_id: issueRecord.id,
      state: 'approved',
    });

    jobsRepository.create({
      issue_id: issueRecord.id,
      session_id: session.id,
      job_type: 'start_agent',
      payload: {
        installation_id: payload.installation?.id,
        clone_url: repository.clone_url,
      },
    });
  } else {
    log.info({ user: sender.login, issue: issue.number }, 'User requires approval');

    // Create session in waiting_approval state
    sessionsRepository.create({
      issue_id: issueRecord.id,
      state: 'waiting_approval',
    });

    // The orchestrator will post a comment asking for approval
  }
}

async function handleUnlabeledEvent(payload: IssuePayload, log: FastifyBaseLogger): Promise<void> {
  const { issue, repository } = payload;

  if (!issue) return;

  // Find the issue record
  const issueRecord = issuesRepository.findByRepoAndNumber(
    repository.owner.login,
    repository.name,
    issue.number
  );

  if (!issueRecord) {
    log.debug({ issue: issue.number }, 'Issue not tracked, ignoring unlabel');
    return;
  }

  // Find active session and stop it
  const session = sessionsRepository.findActiveSession(issueRecord.id);

  if (session) {
    log.info({ session: session.id, issue: issue.number }, 'Stopping agent due to label removal');

    jobsRepository.create({
      issue_id: issueRecord.id,
      session_id: session.id,
      job_type: 'stop_agent',
    });
  }
}
