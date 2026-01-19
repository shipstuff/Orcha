import { getDatabase } from '../index.js';

export interface Issue {
  id: number;
  github_issue_id: number;
  repository_owner: string;
  repository_name: string;
  issue_number: number;
  title: string;
  body: string | null;
  author: string;
  state: 'pending' | 'active' | 'completed' | 'failed' | 'stopped';
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIssueParams {
  github_issue_id: number;
  repository_owner: string;
  repository_name: string;
  issue_number: number;
  title: string;
  body?: string | null;
  author: string;
}

export class IssuesRepository {
  create(params: CreateIssueParams): Issue {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO issues (github_issue_id, repository_owner, repository_name, issue_number, title, body, author)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repository_owner, repository_name, issue_number) DO UPDATE SET
        github_issue_id = excluded.github_issue_id,
        title = excluded.title,
        body = excluded.body,
        updated_at = datetime('now')
      RETURNING *
    `);

    return stmt.get(
      params.github_issue_id,
      params.repository_owner,
      params.repository_name,
      params.issue_number,
      params.title,
      params.body ?? null,
      params.author
    ) as Issue;
  }

  findById(id: number): Issue | undefined {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM issues WHERE id = ?');
    return stmt.get(id) as Issue | undefined;
  }

  findByRepoAndNumber(owner: string, repo: string, number: number): Issue | undefined {
    const db = getDatabase();
    const stmt = db.prepare(
      'SELECT * FROM issues WHERE repository_owner = ? AND repository_name = ? AND issue_number = ?'
    );
    return stmt.get(owner, repo, number) as Issue | undefined;
  }

  findByState(state: Issue['state']): Issue[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM issues WHERE state = ?');
    return stmt.all(state) as Issue[];
  }

  updateState(id: number, state: Issue['state']): void {
    const db = getDatabase();
    const stmt = db.prepare("UPDATE issues SET state = ?, updated_at = datetime('now') WHERE id = ?");
    stmt.run(state, id);
  }

  updateApproval(id: number, status: Issue['approval_status'], approvedBy?: string): void {
    const db = getDatabase();
    const stmt = db.prepare(
      "UPDATE issues SET approval_status = ?, approved_by = ?, updated_at = datetime('now') WHERE id = ?"
    );
    stmt.run(status, approvedBy ?? null, id);
  }

  delete(id: number): void {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM issues WHERE id = ?');
    stmt.run(id);
  }
}

export const issuesRepository = new IssuesRepository();
