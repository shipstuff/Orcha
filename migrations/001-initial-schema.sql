-- Orcha Initial Schema

-- Issues being tracked
CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_issue_id INTEGER NOT NULL,
    repository_owner TEXT NOT NULL,
    repository_name TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    author TEXT NOT NULL,
    state TEXT DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'completed', 'failed', 'stopped')),
    approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    approved_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repository_owner, repository_name, issue_number)
);

-- Agent sessions (enables sleep/resume)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    issue_id INTEGER NOT NULL,
    claude_session_id TEXT,
    state TEXT DEFAULT 'created' CHECK (state IN (
        'created',
        'waiting_approval',
        'approved',
        'initializing',
        'running',
        'waiting',
        'completing',
        'completed',
        'failed',
        'stopped'
    )),
    workspace_path TEXT,
    branch_name TEXT,
    waiting_comment_id INTEGER,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

-- Token tracking
CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_cost_cents INTEGER DEFAULT 0,
    recorded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Job queue
CREATE TABLE IF NOT EXISTS job_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL,
    session_id TEXT,
    job_type TEXT NOT NULL CHECK (job_type IN ('start_agent', 'resume_agent', 'stop_agent')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    payload TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);

-- GitHub App installation tokens cache
CREATE TABLE IF NOT EXISTS installation_tokens (
    installation_id INTEGER PRIMARY KEY,
    token TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_issues_state ON issues(state);
CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repository_owner, repository_name);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
CREATE INDEX IF NOT EXISTS idx_sessions_issue ON sessions(issue_id);
CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status);
CREATE INDEX IF NOT EXISTS idx_job_queue_issue ON job_queue(issue_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);

-- Migration tracking
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT DEFAULT (datetime('now'))
);
