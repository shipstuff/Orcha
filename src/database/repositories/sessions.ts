import { getDatabase } from '../index.js';
import { randomUUID } from 'node:crypto';

export type SessionState =
  | 'created'
  | 'waiting_approval'
  | 'approved'
  | 'initializing'
  | 'running'
  | 'waiting'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface Session {
  id: string;
  issue_id: number;
  claude_session_id: string | null;
  state: SessionState;
  workspace_path: string | null;
  branch_name: string | null;
  waiting_comment_id: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionParams {
  issue_id: number;
  state?: SessionState;
}

export class SessionsRepository {
  create(params: CreateSessionParams): Session {
    const db = getDatabase();
    const id = randomUUID();
    const stmt = db.prepare(`
      INSERT INTO sessions (id, issue_id, state)
      VALUES (?, ?, ?)
      RETURNING *
    `);

    return stmt.get(id, params.issue_id, params.state ?? 'created') as Session;
  }

  findById(id: string): Session | undefined {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(id) as Session | undefined;
  }

  findByIssueId(issueId: number): Session | undefined {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1');
    return stmt.get(issueId) as Session | undefined;
  }

  findByState(state: SessionState): Session[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions WHERE state = ?');
    return stmt.all(state) as Session[];
  }

  findActiveSession(issueId: number): Session | undefined {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM sessions
      WHERE issue_id = ?
        AND state NOT IN ('completed', 'failed', 'stopped')
      ORDER BY created_at DESC
      LIMIT 1
    `);
    return stmt.get(issueId) as Session | undefined;
  }

  findByWaitingCommentId(commentId: number): Session | undefined {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM sessions WHERE waiting_comment_id = ? AND state = ?');
    return stmt.get(commentId, 'waiting') as Session | undefined;
  }

  updateState(id: string, state: SessionState, errorMessage?: string): void {
    const db = getDatabase();
    const stmt = db.prepare(
      "UPDATE sessions SET state = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?"
    );
    stmt.run(state, errorMessage ?? null, id);
  }

  updateClaudeSessionId(id: string, claudeSessionId: string): void {
    const db = getDatabase();
    const stmt = db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?");
    stmt.run(claudeSessionId, id);
  }

  updateWorkspace(id: string, workspacePath: string, branchName: string): void {
    const db = getDatabase();
    const stmt = db.prepare(
      "UPDATE sessions SET workspace_path = ?, branch_name = ?, updated_at = datetime('now') WHERE id = ?"
    );
    stmt.run(workspacePath, branchName, id);
  }

  updateWaitingCommentId(id: string, commentId: number | null): void {
    const db = getDatabase();
    const stmt = db.prepare("UPDATE sessions SET waiting_comment_id = ?, updated_at = datetime('now') WHERE id = ?");
    stmt.run(commentId, id);
  }

  countByState(states: SessionState[]): number {
    const db = getDatabase();
    const placeholders = states.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE state IN (${placeholders})`);
    const result = stmt.get(...states) as { count: number };
    return result.count;
  }

  delete(id: string): void {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }
}

export const sessionsRepository = new SessionsRepository();
