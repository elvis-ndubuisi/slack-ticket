# Technical Design: Slack‑Ticket Backend Service (HonoJS)

## Architecture Overview
- **API Layer**: HonoJS routes for Slack commands and events.
- **Core Service**: Reuses existing modules (`slack`, `ai`, `github`, `workflow`) from CLI with minimal wrappers.
- **Storage**: Workspace‑scoped configuration + workflow store.
- **Queue/Async**: Optional background processing for long AI calls.

## Components

### 1) HonoJS App
Routes:
- `POST /slack/commands`  
  Handles slash commands (create, update, learn, unlearn, workflow list/view).
- `POST /slack/shortcuts`  
  Handles message shortcuts.
- `POST /slack/interactions`  
  For confirmation dialogs and previews.
- `GET /health`  
  Basic health check.

### 2) Slack Adapter
Responsibilities:
- Verify `X-Slack-Signature` + timestamp.
- Parse command/shortcut payloads.
- Post ephemeral messages to response URL.
- Fetch thread messages.

### 3) Workflow Manager
Responsibilities:
- Store per‑workspace workflow JSON.
- Apply workflow overrides on create/update.
- Support learn/unlearn/list/view.

### 4) GitHub Adapter
Responsibilities:
- Create issues.
- Add to Project v2.
- Set Project fields (single‑select, iteration, number).

### 5) AI Adapter
Responsibilities:
- Build prompts with workflow instructions.
- Call provider.
- Validate outputs.

## Data Model

### Tables (or collections)
- `workspaces`
  - `id` (Slack workspace ID)
  - `name`
  - `created_at`
- `secrets`
  - `workspace_id`
  - `slack_bot_token`
  - `github_token`
  - `ai_key`
  - `ai_base_url`
  - `ai_model`
- `workflow`
  - `workspace_id`
  - `workflow_json`
  - `updated_at`
- `audit_logs`
  - `workspace_id`
  - `user_id`
  - `action`
  - `status`
  - `metadata`
  - `created_at`

## Key Flows

### Slash Command: `/ticket create`
1. Receive command payload.
2. Ack with “Working on it…” (ephemeral).
3. Fetch Slack thread by message URL or channel+ts.
4. Apply workflow overrides.
5. Generate issue body via AI.
6. Create GitHub issue.
7. Add to project + set fields.
8. Post result to Slack.

### Slash Command: `/ticket learn`
1. Receive markdown URL (or raw text).
2. Fetch markdown content.
3. Parse workflow JSON block.
4. Store workflow JSON for workspace.
5. Confirm success in Slack.

### Shortcuts
1. Extract message context.
2. Run create flow with thread info.

## Security
- Slack signature verification required.
- Enforce workspace‑scoped secrets.
- Encrypt secrets at rest.
- Rate limit by workspace.

## Deployment
Recommended:
- Node 18+ runtime.
- Containerized deployment (Docker).
- Secrets via environment variables or KMS.
- Optional queue (e.g., Redis + BullMQ).

## Error Handling
Common categories:
- Slack API errors
- GitHub API errors
- AI provider errors
- Validation errors

All errors should be turned into actionable Slack messages.

## Observability
Metrics:
- Command count by type
- Success/failure rate
- Latency by stage

Logs:
- Correlation ID per request
- Error tracebacks
