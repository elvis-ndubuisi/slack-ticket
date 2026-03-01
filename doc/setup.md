# Setup Guide: Obtaining Credentials

To use `slack-ticket`, you need credentials from three services: Slack (for reading threads), GitHub (for creating issues), and an AI provider (for structuring the content).

---

## 1. Slack Credentials

### Step 1: Create a Slack App
1. Go to the [Slack API Dashboard](https://api.slack.com/apps).
2. Click **Create New App** -> **From scratch**.
3. Name it (e.g., `slack-ticket`) and select your workspace.

### Step 2: Configure Scopes
1. In the sidebar, go to **OAuth & Permissions**.
2. Scroll down to **Scopes** -> **Bot Token Scopes**.
3. Add the following scopes:
   - `channels:history` (Public channel access)
   - `channels:read` (Public channel info)
   - `groups:history` (Private channel access)
   - `groups:read` (Private channel info)
   - `files:read` (Image attachment access)

### Step 3: Install and Get Token
1. Scroll to the top of **OAuth & Permissions** and click **Install to Workspace**.
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`). This is your **Slack Bot Token**.

### Step 4: Invite the Bot
- For any channel you want to use, type `/invite @slack-ticket` (or your app name) in that channel.

---

## 2. GitHub Credentials

### Step 1: Create a Personal Access Token (PAT)
1. Go to [GitHub Settings -> Developer settings -> Personal access tokens -> Tokens (classic)](https://github.com/settings/tokens).
2. Click **Generate new token** -> **Generate new token (classic)**.
3. Note: `slack-ticket`.
4. Select the following scopes:
   - `repo` (Full control of private repositories)
   - `project` (Read/write access to projects) - Required for Project v2 assignment.

### Step 2: Copy Token
1. Click **Generate token** and copy the `ghp_...` string.

---

## 3. AI Credentials

Choose one of the supported providers:

### OpenAI
1. Go to the [OpenAI Platform](https://platform.openai.com/).
2. Navigate to **API Keys** and click **Create new secret key**.
3. Copy the `sk-...` key.

### Anthropic
1. Go to the [Anthropic Console](https://console.anthropic.com/).
2. Navigate to **API Keys** and create a new key.

### Google Gemini
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key**.

---

## 4. GitHub Project ID (Optional)

To find your Project v2 ID:
1. Open your project on GitHub.
2. The URL will look like `https://github.com/orgs/my-org/projects/123`.
3. The Project ID itself is a global node ID (e.g., `PVT_abc123`). You can find this via GitHub CLI (`gh project view 123 --org my-org`) or the `slack-ticket setup` wizard might help you find it if you leave it for later.