import { getDatabase } from '../index.js';

export type JobType = 'start_agent' | 'resume_agent' | 'stop_agent';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: number;
  issue_id: number;
  session_id: string | null;
  job_type: JobType;
  status: JobStatus;
  payload: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobParams {
  issue_id: number;
  session_id?: string;
  job_type: JobType;
  payload?: Record<string, unknown>;
}

export class JobsRepository {
  create(params: CreateJobParams): Job {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO job_queue (issue_id, session_id, job_type, payload)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `);

    return stmt.get(
      params.issue_id,
      params.session_id ?? null,
      params.job_type,
      params.payload ? JSON.stringify(params.payload) : null
    ) as Job;
  }

  findById(id: number): Job | undefined {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM job_queue WHERE id = ?');
    return stmt.get(id) as Job | undefined;
  }

  findPending(): Job[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM job_queue WHERE status = ? ORDER BY created_at ASC');
    return stmt.all('pending') as Job[];
  }

  findNextPending(): Job | undefined {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM job_queue WHERE status = ? ORDER BY created_at ASC LIMIT 1');
    return stmt.get('pending') as Job | undefined;
  }

  findByIssueId(issueId: number): Job[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM job_queue WHERE issue_id = ? ORDER BY created_at DESC');
    return stmt.all(issueId) as Job[];
  }

  updateStatus(id: number, status: JobStatus, errorMessage?: string): void {
    const db = getDatabase();
    const stmt = db.prepare(
      "UPDATE job_queue SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?"
    );
    stmt.run(status, errorMessage ?? null, id);
  }

  claimJob(id: number): boolean {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE job_queue
      SET status = 'processing', updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  countByStatus(status: JobStatus): number {
    const db = getDatabase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM job_queue WHERE status = ?');
    const result = stmt.get(status) as { count: number };
    return result.count;
  }

  deleteCompleted(): number {
    const db = getDatabase();
    const stmt = db.prepare("DELETE FROM job_queue WHERE status IN ('completed', 'failed')");
    const result = stmt.run();
    return result.changes;
  }

  delete(id: number): void {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM job_queue WHERE id = ?');
    stmt.run(id);
  }
}

export const jobsRepository = new JobsRepository();
