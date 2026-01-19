import { getDatabase } from '../index.js';

export interface TokenUsage {
  id: number;
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_cents: number;
  recorded_at: string;
}

export interface RecordTokenUsageParams {
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_cents: number;
}

export interface TokenSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cents: number;
}

export class TokensRepository {
  record(params: RecordTokenUsageParams): TokenUsage {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO token_usage (session_id, input_tokens, output_tokens, total_cost_cents)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `);

    return stmt.get(
      params.session_id,
      params.input_tokens,
      params.output_tokens,
      params.total_cost_cents
    ) as TokenUsage;
  }

  findBySessionId(sessionId: string): TokenUsage[] {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM token_usage WHERE session_id = ? ORDER BY recorded_at ASC');
    return stmt.all(sessionId) as TokenUsage[];
  }

  getSummaryBySessionId(sessionId: string): TokenSummary {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_cost_cents), 0) as total_cost_cents
      FROM token_usage
      WHERE session_id = ?
    `);
    return stmt.get(sessionId) as TokenSummary;
  }

  getTotalUsage(): TokenSummary {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(total_cost_cents), 0) as total_cost_cents
      FROM token_usage
    `);
    return stmt.get() as TokenSummary;
  }

  deleteBySessionId(sessionId: string): void {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM token_usage WHERE session_id = ?');
    stmt.run(sessionId);
  }
}

export const tokensRepository = new TokensRepository();
