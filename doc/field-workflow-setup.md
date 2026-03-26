---
title: Slack Ticket Workflow: Obtaining Github project/board details
description: This guide walks you through grabbing github project details for your slack-ticket learn workflow document.
publishDate: 2026-03-19
tags: [cli-tool, slack, support]
draft: false
featured: true
---

# Slack Ticket Workflow: Obtaining Github Project/Board Details

If you’re setting up the Field workflow for `slack-ticket`, you’ll need one thing from GitHub: the **Project v2 ID** and (optionally) the **Project field options**. This short guide walks you through the exact commands and common error fix.

## Step 1: Make sure your GitHub CLI has project access

If your `gh` token is missing scopes, you’ll see:

```
error: your authentication token is missing required scopes [read:project]
To request it, run:  gh auth refresh -s read:project
```

Fix it with:

```bash
gh auth refresh -s read:project
```

To confirm access:

```bash
gh auth status
```

## Step 2: Fetch the Project ID

You need the Project v2 ID for the workflow file.

```bash
gh project view 15 --owner fielded --format json
```

From the output, copy the `id` field:

```
"id": "PVT_kwDOAOaaZs4AlRIU"
```

Use it in your workflow file:

```json
"defaultProject": "PVT_kwDOAOaaZs4AlRIU"
```

## Step 3: Fetch Project Fields and Options

This is needed if you want to set Status, Iteration, Severity, etc.

```bash
gh project field-list 15 --owner fielded --format json
```

Use the field names exactly as returned (case‑sensitive) in `projectFields`.

Example:

```json
"projectFields": {
  "Status": "TODO",
  "Iteration": "latest",
  "Severity": "SEV 3",
  "UPS Score": 10,
  "Tenant": "ALL"
}
```

## Step 4: Learn the Workflow

Once your workflow file is ready:

```bash
slack-ticket learn FIELD_WORKFLOW.md
```

## Quick Summary
- Add GitHub scope: `read:project`
- Get Project ID: `gh project view`
- Get fields/options: `gh project field-list`
- Learn workflow: `slack-ticket learn`
