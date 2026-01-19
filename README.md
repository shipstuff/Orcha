# Orcha

GitHub issue-to-agent orchestrator using Claude Code instances.

Orcha monitors GitHub issues for a trigger label and automatically spawns Claude Code agents to work on them. It handles the full lifecycle: approval workflows, agent execution, question/answer interactions, and PR creation.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  GitHub Webhook │────▶│  Orchestrator │────▶│  Agent Runner   │
└─────────────────┘     │  (queue/state)│     │  (Claude Code)  │
                        └──────────────┘     └─────────────────┘
                               │                      │
                               ▼                      ▼
                        ┌──────────────┐     ┌─────────────────┐
                        │  GitHub API  │◀────│ Workspace Mgr   │
                        │  (comments,  │     │ (branches, PRs) │
                        │   PRs)       │     └─────────────────┘
                        └──────────────┘
```

## Features

- **Automatic agent spawning** when issues are labeled with `agent-work`
- **Approval workflow** for non-trusted users
- **Concurrent agent management** with configurable limits
- **Session persistence** for sleep/resume capabilities
- **Question handling** - agents can ask questions via GitHub comments
- **Automatic PR creation** when work is complete
- **Token usage tracking** with cost estimation
- **Docker deployment** with persistent storage

## Prerequisites

- Node.js 20+
- A GitHub App with the following permissions:
  - Issues: Read & Write
  - Pull Requests: Read & Write
  - Contents: Read & Write
- Anthropic API key for Claude Code
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)

## Installation

### Local Development

```bash
# Clone the repository
git clone https://github.com/your-org/orcha.git
cd orcha

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
# See Configuration section below

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

### Docker Deployment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your credentials

# Build and start
docker-compose up -d

# View logs
docker-compose logs -f
```

## Configuration

Create a `.env` file with the following variables:

```bash
# GitHub App Configuration
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-...

# Server
PORT=3000
HOST=0.0.0.0

# Database (SQLite)
DATABASE_PATH=./data/orcha.db

# Workspace directory for cloned repos
WORKSPACE_DIR=./workspaces

# Authorization
# Users who can trigger agents directly (comma-separated)
APPROVED_USERS=alice,bob
# Users who can /approve, /stop, /restart (comma-separated)
MAINTAINERS=alice

# Agent Configuration
MAX_CONCURRENT_AGENTS=3
AGENT_TIMEOUT_MINUTES=60

# Label that triggers agent work
TRIGGER_LABEL=agent-work
```

## GitHub App Setup

1. Create a new GitHub App at https://github.com/settings/apps/new
2. Configure the following:
   - **Webhook URL**: `https://your-server.com/webhook/github`
   - **Webhook Secret**: Generate a secure secret
   - **Permissions**:
     - Issues: Read & Write
     - Pull Requests: Read & Write
     - Contents: Read & Write
   - **Subscribe to events**:
     - Issues
     - Issue comment
3. Generate and download a private key
4. Install the app on your repositories

## Usage

### Triggering an Agent

1. Create an issue describing the work to be done
2. Add the `agent-work` label (or your configured trigger label)
3. If you're an approved user, the agent starts immediately
4. If not, a maintainer must comment `/approve`

### Commands

Comment these on any tracked issue:

| Command | Description | Who can use |
|---------|-------------|-------------|
| `/approve` | Approve and start the agent | Maintainers |
| `/reject` | Reject the request | Maintainers |
| `/stop` | Stop the running agent | Maintainers, Approved Users |
| `/restart` | Start a fresh agent session | Maintainers, Approved Users |

### Agent Lifecycle

```
CREATED → WAITING_APPROVAL (if not approved user)
        → APPROVED (if approved user)

WAITING_APPROVAL → APPROVED (on /approve)
                 → REJECTED (on /reject)

APPROVED → INITIALIZING → RUNNING

RUNNING → WAITING (agent asks question)
        → COMPLETING (agent done)
        → FAILED (error)

WAITING → RUNNING (comment reply received)

COMPLETING → COMPLETED (PR created)

Any state → STOPPED (on /stop)
COMPLETED/FAILED/STOPPED → INITIALIZING (on /restart)
```

### Agent Questions

When an agent needs clarification, it posts a comment on the issue. Reply to that comment to provide your answer, and the agent will resume.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/webhook/github` | POST | GitHub webhook receiver |

## Project Structure

```
orcha/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Fastify server
│   ├── config/               # Configuration
│   ├── database/             # SQLite + repositories
│   ├── webhook/              # GitHub webhook handling
│   ├── orchestrator/         # Job queue + state machine
│   ├── agent/                # Claude Code runner
│   ├── github/               # GitHub API client
│   └── workspace/            # Git operations
├── migrations/               # Database migrations
├── Dockerfile
└── docker-compose.yml
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Build for production
npm run build

# Start production server
npm start
```

## Database

Orcha uses SQLite for simplicity. The database is created automatically on first run.

To reset the database:
```bash
rm -rf ./data/orcha.db
npm run migrate
```

## Troubleshooting

### Agent not starting

1. Check that the trigger label matches `TRIGGER_LABEL`
2. Verify the user is in `APPROVED_USERS` or a maintainer approved
3. Check server logs for errors

### Webhook not receiving events

1. Verify the webhook URL is accessible from GitHub
2. Check that `GITHUB_WEBHOOK_SECRET` matches the app configuration
3. Ensure the app is installed on the repository

### Agent timing out

Increase `AGENT_TIMEOUT_MINUTES` or break the task into smaller issues.

## License

MIT
