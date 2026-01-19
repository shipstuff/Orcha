import { sessionsRepository, Session, SessionState } from '../database/repositories/sessions.js';
import { tokensRepository } from '../database/repositories/tokens.js';
import { canTransition, StateEvent } from '../orchestrator/state-machine.js';
import pino from 'pino';

const log = pino({ name: 'session' });

export class AgentSession {
  private session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  static create(issueId: number, state?: SessionState): AgentSession {
    const session = sessionsRepository.create({ issue_id: issueId, state });
    return new AgentSession(session);
  }

  static findById(id: string): AgentSession | null {
    const session = sessionsRepository.findById(id);
    return session ? new AgentSession(session) : null;
  }

  static findByIssueId(issueId: number): AgentSession | null {
    const session = sessionsRepository.findByIssueId(issueId);
    return session ? new AgentSession(session) : null;
  }

  static findActive(issueId: number): AgentSession | null {
    const session = sessionsRepository.findActiveSession(issueId);
    return session ? new AgentSession(session) : null;
  }

  get id(): string {
    return this.session.id;
  }

  get issueId(): number {
    return this.session.issue_id;
  }

  get state(): SessionState {
    return this.session.state;
  }

  get claudeSessionId(): string | null {
    return this.session.claude_session_id;
  }

  get workspacePath(): string | null {
    return this.session.workspace_path;
  }

  get branchName(): string | null {
    return this.session.branch_name;
  }

  get waitingCommentId(): number | null {
    return this.session.waiting_comment_id;
  }

  get errorMessage(): string | null {
    return this.session.error_message;
  }

  transition(event: StateEvent, errorMessage?: string): boolean {
    const newState = canTransition(this.session.state, event);

    if (!newState) {
      log.warn({
        sessionId: this.session.id,
        currentState: this.session.state,
        event,
      }, 'Invalid state transition attempted');
      return false;
    }

    log.info({
      sessionId: this.session.id,
      from: this.session.state,
      to: newState,
      event,
    }, 'State transition');

    sessionsRepository.updateState(this.session.id, newState, errorMessage);
    this.session.state = newState;
    this.session.error_message = errorMessage ?? null;

    return true;
  }

  setClaudeSessionId(claudeSessionId: string): void {
    sessionsRepository.updateClaudeSessionId(this.session.id, claudeSessionId);
    this.session.claude_session_id = claudeSessionId;
  }

  setWorkspace(workspacePath: string, branchName: string): void {
    sessionsRepository.updateWorkspace(this.session.id, workspacePath, branchName);
    this.session.workspace_path = workspacePath;
    this.session.branch_name = branchName;
  }

  setWaitingCommentId(commentId: number | null): void {
    sessionsRepository.updateWaitingCommentId(this.session.id, commentId);
    this.session.waiting_comment_id = commentId;
  }

  recordTokenUsage(inputTokens: number, outputTokens: number, costCents: number): void {
    tokensRepository.record({
      session_id: this.session.id,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_cost_cents: costCents,
    });
  }

  getTokenSummary(): { input: number; output: number; costCents: number } {
    const summary = tokensRepository.getSummaryBySessionId(this.session.id);
    return {
      input: summary.total_input_tokens,
      output: summary.total_output_tokens,
      costCents: summary.total_cost_cents,
    };
  }

  refresh(): void {
    const fresh = sessionsRepository.findById(this.session.id);
    if (fresh) {
      this.session = fresh;
    }
  }

  toJSON(): Session {
    return { ...this.session };
  }
}
