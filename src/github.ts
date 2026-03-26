/**
 * GitHub integration module for slack-ticket.
 *
 * Handles:
 * - Issue creation via REST API
 * - Label resolution (keyword + severity + component + --labels flag)
 * - Image attachment via issue comment
 * - GitHub Project v2 assignment via GraphQL
 */

import https from 'https'
import fs from 'fs'
import { CLIError } from './error.js'
import type { Config, LabelsConfig } from './config.js'
import type { CreateAIOutput } from './ai.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CreatedIssue {
  number: number
  url: string
  nodeId: string
}

export interface LabelResolutionOptions {
  rawSlackText: string
  severity: string
  component: string | null
  extraLabels: string[]
  labelsConfig: LabelsConfig
}

// ─── HTTP Helpers ──────────────────────────────────────────────────────────────

/**
 * Internal helper for GitHub REST requests.
 */
export async function githubRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const payload = body ? JSON.stringify(body) : undefined

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'slack-ticket-cli',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(payload && {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          let parsed: unknown = data
          try {
            parsed = JSON.parse(data)
          } catch {
            /* leave as string */
          }
          resolve({ status: res.statusCode ?? 0, data: parsed })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * Internal helper for GitHub GraphQL requests.
 */
export async function githubGraphQL(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<unknown> {
  const payload = JSON.stringify({ query, variables })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: '/graphql',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'slack-ticket-cli',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve(data)
          }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function handleGitHubError(status: number, data: unknown, context: string): void {
  if (status === 401 || status === 403) {
    const requiredScopes = 'repo, project'
    throw new CLIError(
      `GitHub token lacks permissions for ${context}. Required scopes: ${requiredScopes}.`,
      5
    )
  }
  if (status === 404) {
    throw new CLIError(
      `GitHub repository not found (${context}). Check 'github.owner' and 'github.defaultRepo' in config.`,
      5
    )
  }
  if (status === 429) {
    const reset = (data as any)?.message ?? 'unknown'
    throw new CLIError(`GitHub rate limited (${context}). Reset at: ${reset}. Try again later.`, 5)
  }
  if (status >= 400) {
    const msg = (data as any)?.message ?? `HTTP ${status}`
    throw new CLIError(`GitHub API error during ${context}: ${msg}`, 5)
  }
}

// ─── Label Resolution (PRD §11.2) ─────────────────────────────────────────────

/**
 * Resolves labels from four independent sources, deduplicates, and returns the list.
 *
 * Order:
 * 1. Keyword match on raw Slack text
 * 2. Severity map from --severity flag or config default
 * 3. Component map from --component flag or config default
 * 4. --labels flag additions
 */
export function resolveLabels(opts: LabelResolutionOptions): string[] {
  const { rawSlackText, severity, component, extraLabels, labelsConfig } = opts
  const collected: string[] = []

  // 1. Keyword matching (case-insensitive, pipe-separated synonyms)
  for (const [pattern, labels] of Object.entries(labelsConfig.keywords ?? {})) {
    const regex = new RegExp(pattern, 'i')
    if (regex.test(rawSlackText)) {
      collected.push(...labels)
    }
  }

  // 2. Severity mapping
  const severityLabels = labelsConfig.severity?.[severity] ?? []
  collected.push(...severityLabels)

  // 3. Component mapping
  if (component) {
    const componentLabels = labelsConfig.components?.[component] ?? []
    collected.push(...componentLabels)
  }

  // 4. Extra --labels flag
  collected.push(...extraLabels)

  // Deduplicate maintaining first-seen order
  return [...new Set(collected)]
}

/**
 * Filters label list to only labels that exist in the GitHub repo.
 * Skips missing labels with a printed warning (per PRD §11.2).
 * Never auto-creates labels.
 */
export async function filterExistingLabels(
  labels: string[],
  owner: string,
  repo: string,
  token: string
): Promise<string[]> {
  if (labels.length === 0) return []

  // Fetch all labels in the repo (paginated, up to 100)
  const { status, data } = await githubRequest(
    'GET',
    `/repos/${owner}/${repo}/labels?per_page=100`,
    token
  )

  if (status !== 200) {
    // If we can't fetch labels (e.g. permissions), skip filtering
    return labels
  }

  const repoLabels = new Set(((data as any[]) ?? []).map((l) => (l.name as string).toLowerCase()))

  const valid: string[] = []
  for (const label of labels) {
    if (repoLabels.has(label.toLowerCase())) {
      valid.push(label)
    } else {
      process.stdout.write(`⚠  Label '${label}' not found in repo. Skipping.\n`)
    }
  }

  return valid
}

// ─── Issue Creation (PRD §11.1) ───────────────────────────────────────────────

/**
 * Assembles the full GitHub issue body from AI output + metadata.
 * Adapts structure based on issue_type (PRD §9.5).
 */
export function assembleIssueBody(
  ai: CreateAIOutput,
  severity: string,
  component: string | null,
  slackUrl: string
): string {
  const sections: string[] = []
  const isBug = ai.issue_type === 'bug_report'

  if (ai.summary) sections.push(`## Summary\n${ai.summary}`)

  if (ai.details) sections.push(`## Details\n${ai.details}`)

  // Bug-specific sections
  if (isBug) {
    if (ai.steps_to_reproduce) sections.push(`## Steps to Reproduce\n${ai.steps_to_reproduce}`)
    if (ai.expected_behavior) sections.push(`## Expected Behavior\n${ai.expected_behavior}`)
    if (ai.actual_behavior) sections.push(`## Actual Behavior\n${ai.actual_behavior}`)
  }

  // Screenshot note — simple Slack link, no downloads or broken data URLs
  if (ai.has_screenshot) {
    sections.push(
      `## Screenshot\n> 📸 A screenshot was shared in the original Slack message. [View in Slack](${slackUrl})`
    )
  }

  sections.push(`## Severity\n${severity}`)
  if (component) sections.push(`## Component\n${component}`)

  sections.push(
    `---\n**Type:** ${formatIssueType(ai.issue_type)}  \n**Slack Thread:** ${slackUrl}`
  )

  return sections.join('\n\n')
}

function formatIssueType(type: string): string {
  const map: Record<string, string> = {
    bug_report: 'Bug Report',
    data_request: 'Data Request',
    account_management: 'Account Management',
    billing_issue: 'Billing Issue',
    configuration_change: 'Configuration Change',
    access_issue: 'Access Issue',
    investigation: 'Investigation',
    feature_request: 'Feature Request',
    general: 'General',
  }
  return map[type] ?? type
}

/**
 * Creates a GitHub issue via REST API.
 */
export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[],
  token: string
): Promise<CreatedIssue> {
  const { status, data } = await githubRequest('POST', `/repos/${owner}/${repo}/issues`, token, {
    title,
    body,
    labels,
  })

  handleGitHubError(status, data, 'issue creation')

  const issue = data as any
  return {
    number: issue.number,
    url: issue.html_url,
    nodeId: issue.node_id,
  }
}

/**
 * Fetches the body of an existing issue (for `update`).
 */
export async function fetchIssueBody(
  owner: string,
  repo: string,
  issueNumber: number,
  token: string
): Promise<string> {
  const { status, data } = await githubRequest(
    'GET',
    `/repos/${owner}/${repo}/issues/${issueNumber}`,
    token
  )

  handleGitHubError(status, data, `issue #${issueNumber} fetch`)
  return (data as any).body ?? ''
}

/**
 * Appends text to an existing issue body.
 */
export async function appendToIssueBody(
  owner: string,
  repo: string,
  issueNumber: number,
  appendText: string,
  currentBody: string,
  token: string
): Promise<string> {
  const newBody = `${currentBody}\n\n---\n\n${appendText}`
  const { status, data } = await githubRequest(
    'PATCH',
    `/repos/${owner}/${repo}/issues/${issueNumber}`,
    token,
    { body: newBody }
  )

  handleGitHubError(status, data, `issue #${issueNumber} update`)
  return (data as any).html_url
}

// ─── Image Attachment (PRD §11.3) ─────────────────────────────────────────────

/**
 * Posts a follow-up comment with the local image path so the user can
 * drag-and-drop it into the GitHub issue via the web UI.
 *
 * WHY: GitHub's REST API has no public endpoint for uploading images to
 * issue bodies/comments — the upload endpoint is only for release assets.
 * Embedding a base64 data: URL is blocked by GitHub's Content Security Policy
 * and renders as a broken image. Posting the path is the only reliable approach.
 */
export async function postImageComment(
  owner: string,
  repo: string,
  issueNumber: number,
  imagePath: string,
  filename: string,
  token: string
): Promise<void> {
  const lines = [
    `### 📎 Screenshot from Slack`,
    ``,
    `A screenshot was extracted from the Slack thread and saved to your local machine:`,
    ``,
    `\`\`\``,
    `${imagePath}`,
    `\`\`\``,
    ``,
    `**To attach it to this issue:**`,
    `1. Open this issue in your browser`,
    `2. Click **Edit** on the issue body (pencil icon)`,
    `3. Drag-and-drop the file above into the editor area`,
    `4. Replace the placeholder in the **Screenshot** section with the uploaded image`,
  ]
  const body = lines.join('\n')

  const { status } = await githubRequest(
    'POST',
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    token,
    { body }
  )

  if (status >= 400) {
    process.stdout.write(
      `⚠  Could not post image instructions. Your image is saved at: ${imagePath}\n`
    )
  }
  // NOTE: Do NOT delete the temp file — the user still needs it to upload manually.
}

// ─── GitHub Project v2 Assignment (PRD §11.4) ─────────────────────────────────

/**
 * Adds an issue to a GitHub Project v2 and sets its Status to "Todo".
 * Any failure prints a warning and returns; it never throws or aborts the issue.
 */
export async function addToProject(
  projectId: string,
  issueNodeId: string,
  token: string,
  projectFields?: Record<string, string | number>
): Promise<void> {
  try {
    // Step 1: Add item to project
    const addResult = (await githubGraphQL(
      `mutation AddItem($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }`,
      { projectId, contentId: issueNodeId },
      token
    )) as any

    if (addResult?.errors) {
      process.stdout.write(`⚠  Could not add to project. Issue was still created.\n`)
      return
    }

    const itemId = addResult?.data?.addProjectV2ItemById?.item?.id
    if (!itemId) {
      process.stdout.write(`⚠  Could not add to project. Issue was still created.\n`)
      return
    }

    // Step 2: Apply project fields (best-effort)
    const fieldUpdates = { ...projectFields }
    if (!fieldUpdates || Object.keys(fieldUpdates).length === 0) {
      fieldUpdates.Status = 'TODO'
    } else if (!('Status' in fieldUpdates)) {
      fieldUpdates.Status = 'TODO'
    }

    await applyProjectFieldUpdates(projectId, itemId, fieldUpdates, token)
  } catch {
    process.stdout.write(`⚠  Could not add to project. Issue was still created.\n`)
  }
}

async function applyProjectFieldUpdates(
  projectId: string,
  itemId: string,
  fieldUpdates: Record<string, string | number>,
  token: string
): Promise<void> {
  const projectResult = (await githubGraphQL(
    `query GetProjectFields($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              __typename
              id
              name
              ... on ProjectV2SingleSelectField {
                options { id name }
              }
              ... on ProjectV2IterationField {
                configuration {
                  iterations {
                    id
                    title
                    startDate
                  }
                }
              }
              ... on ProjectV2Field {
                dataType
              }
            }
          }
        }
      }
    }`,
    { projectId },
    token
  )) as any

  const fields: any[] = projectResult?.data?.node?.fields?.nodes ?? []
  const fieldByName = new Map<string, any>()
  for (const f of fields) fieldByName.set(String(f.name).toLowerCase(), f)

  const entries = Object.entries(fieldUpdates)
  entries.sort((a, b) => {
    const aIsStatus = a[0].toLowerCase() === 'status'
    const bIsStatus = b[0].toLowerCase() === 'status'
    if (aIsStatus && !bIsStatus) return -1
    if (!aIsStatus && bIsStatus) return 1
    return 0
  })

  for (const [name, rawValue] of entries) {
    const field = fieldByName.get(name.toLowerCase())
    if (!field) {
      process.stdout.write(`⚠  Project field not found: ${name}\n`)
      continue
    }

    let value: any = null

    if (field.__typename === 'ProjectV2SingleSelectField') {
      const option = field.options?.find(
        (o: any) => String(o.name).toLowerCase() === String(rawValue).toLowerCase()
      )
      if (!option) {
        process.stdout.write(`⚠  Option not found for ${name}: ${rawValue}\n`)
        continue
      }
      value = { singleSelectOptionId: option.id }
    } else if (field.__typename === 'ProjectV2IterationField') {
      const iterations: any[] = field.configuration?.iterations ?? []
      let selected: any | null = null
      const raw = String(rawValue).toLowerCase()
      if (raw === 'latest' || raw === 'current') {
        selected = iterations
          .filter((i) => i.startDate)
          .sort((a, b) => (a.startDate > b.startDate ? -1 : 1))[0]
      } else {
        selected = iterations.find(
          (i) => String(i.title).toLowerCase() === String(rawValue).toLowerCase()
        )
      }
      if (!selected) {
        process.stdout.write(`⚠  Iteration not found for ${name}: ${rawValue}\n`)
        continue
      }
      value = { iterationId: selected.id }
    } else if (field.__typename === 'ProjectV2Field') {
      const dataType = String(field.dataType ?? '').toUpperCase()
      if (dataType === 'NUMBER') {
        const num = Number(rawValue)
        if (Number.isNaN(num)) {
          process.stdout.write(`⚠  Invalid number for ${name}: ${rawValue}\n`)
          continue
        }
        value = { number: num }
      } else if (dataType === 'DATE') {
        value = { date: String(rawValue) }
      } else {
        value = { text: String(rawValue) }
      }
    }

    if (!value) continue

    try {
      await githubGraphQL(
        `mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: $value
          }) { projectV2Item { id } }
        }`,
        {
          projectId,
          itemId,
          fieldId: field.id,
          value,
        },
        token
      )
    } catch {
      process.stdout.write(`⚠  Could not set project field: ${name}\n`)
      continue
    }
  }
}

// ─── Post comment (for update --comment mode) ─────────────────────────────────

export async function postIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  token: string
): Promise<string> {
  const { status, data } = await githubRequest(
    'POST',
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    token,
    { body }
  )

  handleGitHubError(status, data, `comment on issue #${issueNumber}`)
  return `https://github.com/${owner}/${repo}/issues/${issueNumber}`
}
