# PRD: Slack‑Ticket Backend Service (Full CLI Parity)

## Summary
Build a backend service that exposes Slack commands and shortcuts to run the existing `slack-ticket` flows without local installs, matching CLI behavior. Built with HonoJS.

## Goals
- Full parity with CLI features and outcomes.
- Zero local setup for QA/Support users.
- Secure handling of Slack/GitHub/AI tokens.
- Fast response in Slack with asynchronous processing where needed.

## Non‑Goals
- Replacing the CLI.
- Building a full UI dashboard (phase later).
- Supporting non‑GitHub issue trackers.

## Personas
- QA/Support staff: want one‑click ticket creation inside Slack.
- Team leads: configure workflows once for everyone.
- Engineers: need consistent, structured issue creation.

## Functional Requirements

### Slack Entry Points
- Slash commands:
  - `/ticket create` (uses selected thread by default)
  - `/ticket update`
  - `/ticket learn <url-or-file>`
  - `/ticket unlearn`
  - `/ticket workflow list`
  - `/ticket workflow view <id-or-repo>`
- Message shortcut:
  - “Create GitHub Ticket” from a message or thread.
- Optional: Global shortcut “Create Ticket”.

### CLI Parity Features
- Slack thread parsing and depth options.
- AI prompt generation and validation.
- Label resolution (keyword + severity + component + custom).
- GitHub issue creation.
- Project v2 assignment with field updates (Status, Iteration, Severity, UPS Score, etc.).
- Learn/unlearn workflow stored per org/workspace, not per user.
- Workflow list/view.
- Dry‑run mode (returns preview only).

### Workflow Learning
- Supports Markdown ingestion from URL.
- JSON block (`slack-ticket`) for structured config.
- Applies workflow overrides for all users in a Slack workspace or selected channels.

### Project Fields
- Must support:
  - Single select fields.
  - Iteration (latest or by title).
  - Number fields.
- Best‑effort updates with warnings.

### Image Handling
- Default: no auto upload to GitHub.
- If Slack message includes image: mention “screenshot exists” in issue body.

### Notifications
- Success message includes:
  - Issue URL
  - Project board and status
- Failure message includes actionable error.

## API & Slack Flow

### Slack → Backend
- Verify Slack signatures on all requests.
- Parse payload based on command/shortcut type.
- Fetch thread details via Slack API.
- Run AI + GitHub pipeline.
- Post result back to Slack.

### Backend → Slack
- Use response URL for async replies.
- Use ephemeral messages for confirmation and previews.
- Use blocks for preview formatting.

## Data & Storage

### Configuration Store
- Store per workspace/team:
  - Tokens for Slack, GitHub, AI
  - Default repo, project, label mappings
  - Workflow JSON
- Recommended store: Postgres or DynamoDB.
- Encrypt tokens at rest.

### Schema (high level)
- `workspaces`: workspace_id, name, created_at
- `secrets`: workspace_id, slack_bot_token, github_token, ai_key
- `workflow`: workspace_id, workflow_json, updated_at
- `audit_logs`: workspace_id, user_id, action, status, metadata

## Security
- Slack signature verification required.
- Token scope restriction:
  - Slack: `channels:read`, `channels:history`, `chat:write`
  - GitHub: `repo`, `project`
- Encrypt all secrets.
- Request timeouts and rate limits.

## Performance
- Initial Slack response within 3 seconds.
- Async pipeline for AI/GitHub calls.
- Max request timeout: 30 seconds.

## Observability
- Request logging (action, workspace, latency).
- Error tracking per command.
- Audit log for ticket creation.

## Milestones
1. **MVP (Slash Command Create)**
   - `/ticket create` on thread
   - Issue created + Slack reply
2. **Full CLI Parity**
   - Update, learn/unlearn, workflow list/view
   - Project fields + label resolution
3. **Polish**
   - Templated Slack block previews
   - Admin setup UI (optional)

## Open Questions
- Should workflows be per workspace or per channel?
- Does the team want a Slack‑based “setup wizard” to configure tokens?
- Should we support multiple repos per command?

## Assumptions
- GitHub Project v2 is used.
- The existing prompt and label logic are reused.
- HonoJS will run on Node 18+.
