import { getInstallationOctokit } from './client.js';

export interface CreateCommentParams {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

export interface CreateCommentResult {
  id: number;
  html_url: string;
}

export async function createIssueComment(params: CreateCommentParams): Promise<CreateCommentResult> {
  const octokit = await getInstallationOctokit(params.installationId);

  const response = await octokit.issues.createComment({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    body: params.body,
  });

  return {
    id: response.data.id,
    html_url: response.data.html_url,
  };
}

export async function updateIssueComment(
  installationId: number,
  owner: string,
  repo: string,
  commentId: number,
  body: string
): Promise<void> {
  const octokit = await getInstallationOctokit(installationId);

  await octokit.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
}

export async function deleteIssueComment(
  installationId: number,
  owner: string,
  repo: string,
  commentId: number
): Promise<void> {
  const octokit = await getInstallationOctokit(installationId);

  await octokit.issues.deleteComment({
    owner,
    repo,
    comment_id: commentId,
  });
}

export function formatAgentQuestionComment(question: string, sessionId: string): string {
  return `## 🤖 Agent Question

${question}

---
*Reply to this comment to provide your answer.*
*Session ID: \`${sessionId}\`*`;
}

export function formatApprovalRequestComment(author: string, title: string): string {
  return `## 🔐 Approval Required

User **@${author}** has requested agent work on this issue.

A maintainer must approve before the agent can start.

**Commands:**
- \`/approve\` - Approve and start the agent
- \`/reject\` - Reject the request

---
*Issue: ${title}*`;
}

export function formatAgentStartedComment(sessionId: string): string {
  return `## 🚀 Agent Started

The agent has begun working on this issue.

**Session ID:** \`${sessionId}\`

**Commands:**
- \`/stop\` - Stop the agent
- \`/restart\` - Restart with a fresh session

---
*I'll post updates as I make progress.*`;
}

export function formatAgentCompletedComment(
  sessionId: string,
  prUrl: string | null,
  tokenSummary: { input: number; output: number; costCents: number }
): string {
  const prSection = prUrl
    ? `**Pull Request:** ${prUrl}`
    : '*No pull request was created.*';

  const costDollars = (tokenSummary.costCents / 100).toFixed(2);

  return `## ✅ Agent Completed

${prSection}

**Token Usage:**
- Input: ${tokenSummary.input.toLocaleString()}
- Output: ${tokenSummary.output.toLocaleString()}
- Cost: $${costDollars}

**Session ID:** \`${sessionId}\`

---
*To make changes, comment \`/restart\` to start a new session.*`;
}

export function formatAgentFailedComment(sessionId: string, error: string): string {
  return `## ❌ Agent Failed

The agent encountered an error and could not complete the task.

**Error:**
\`\`\`
${error}
\`\`\`

**Session ID:** \`${sessionId}\`

---
*Comment \`/restart\` to try again with a fresh session.*`;
}

export function formatAgentStoppedComment(sessionId: string, stoppedBy: string): string {
  return `## ⏹️ Agent Stopped

The agent was stopped by **@${stoppedBy}**.

**Session ID:** \`${sessionId}\`

---
*Comment \`/restart\` to start a new session.*`;
}
