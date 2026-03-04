# Usage Guide: slack-ticket CLI

This guide provides detailed instructions on how to use each command and option available in the `slack-ticket` CLI tool.

---

## Table of Contents
- [General Usage](#general-usage)
- [Command: setup](#command-setup)
- [Command: create](#command-create)
  - [Arguments](#create-arguments)
  - [Options](#create-options)
- [Command: update](#command-update)
  - [Arguments](#update-arguments)
  - [Options](#update-options)
- [Command: doctor](#command-doctor)
- [Config Commands](#config-commands)
  - [config view](#config-view)
  - [config edit](#config-edit)

---

<a name="general-usage"></a>
## General Usage

The basic syntax for the CLI is:
```bash
slack-ticket [command] [options]
```
You can always append `--help` to any command to see its available options and descriptions.

---

<a name="command-setup"></a>
## Command: `setup`

The `setup` command is an interactive wizard designed for first-time configuration. It walks you through setting up your Slack, GitHub, and AI provider tokens.

- **Usage**: `slack-ticket setup`
- **When to use**: Run this immediately after installation or whenever you need to update your API keys or default repository settings. It safely handles token entry and verifies connectivity during the process.

---

<a name="command-create"></a>
## Command: `create`

The `create` command is the core of the tool. It fetches a Slack thread, uses AI to analyze the conversation, and generates a structured GitHub issue.

- **Usage**: `slack-ticket create <slack-thread-url> [options]`

<a name="create-arguments"></a>
### Arguments
- `<slack-thread-url>`: **Required**. The full URL of the Slack message that starts the thread you want to convert. 
  - *Example*: `https://myworkspace.slack.com/archives/C12345/p1679090123456789`

<a name="create-options"></a>
### Options
- `--depth <n>`: Specifies how many messages from the thread to fetch (including the parent). Max is 10. Default is `3`.
- `--severity <level>`: Manually sets the issue severity. Accepted values: `low`, `medium`, `high`, `critical`. This helps the AI categorize the impact.
- `--component <name>`: Associates the issue with a specific component (e.g., `frontend`, `api`). This must match a key in your `labels.components` configuration to apply the correct GitHub label.
- `--repo <owner/repo>`: Overrides the default repository set during `setup`. Useful for cross-project reporting.
- `--project <project-id>`: Overrides the default GitHub Project v2 ID.
- `--no-project`: Disables adding the new issue to a GitHub Project for this specific run.
- `--no-image`: Disables fetching and attaching images from the Slack thread.
- `--labels <labels>`: A comma-separated list of extra labels to apply (e.g., `--labels "bug,urgent"`).
- `--yes`: Skips the interactive preview and confirmation step. Useful for automation.
- `--dry-run`: Performs the full AI analysis and displays the result but **does not** create the issue on GitHub. Great for testing your AI prompts or configuration.

---

<a name="command-update"></a>
## Command: `update`

The `update` command allows you to append new information from Slack to an existing GitHub issue.

- **Usage**: `slack-ticket update <issue-number> <slack-message-urls...> [options]`

<a name="update-arguments"></a>
### Arguments
- `<issue-number>`: **Required**. The numeric ID of the GitHub issue to update.
- `<slack-message-urls...>`: **Required**. One or more Slack message URLs containing the new information.

<a name="update-options"></a>
### Options
- `--repo <owner/repo>`: Overrides the default repository.
- `--comment`: Instead of appending the new information to the issue's main description (body), it posts the update as a new comment on the issue.
- `--yes`: Skips the confirmation prompt.
- `--dry-run`: Previews the update content without actually modifying the GitHub issue.

---

<a name="command-doctor"></a>
## Command: `doctor`

The `doctor` command runs a comprehensive diagnostic suite to verify your environment.

- **Usage**: `slack-ticket doctor`
- **What it checks**:
  - Slack token validity and bot channel access.
  - GitHub token validity and repository permissions.
  - AI provider responsiveness.
- **When to use**: Run this if you are getting "Authentication Failed" or "Permission Denied" errors during other commands.

---

<a name="config-commands"></a>
## Config Commands

Directly manage your `config.json` file.

<a name="config-view"></a>
### `config view`
Prints your current configuration values to the terminal. Sensitive data like Slack and GitHub tokens are automatically masked for security.

<a name="config-edit"></a>
### `config edit`
Attempts to open your configuration file in your system's default text editor (defined by the `$EDITOR` environment variable). This allows for quick manual adjustments to label mappings or thread depth defaults.
