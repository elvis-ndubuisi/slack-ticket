/**
 * AI integration module for slack-ticket.
 *
 * Handles:
 * - Provider-agnostic callAI() abstraction (OpenAI, Anthropic, Gemini, Ollama, custom)
 * - `create` and `update` prompt templates
 * - Response parsing and validation with retry + field stripping
 */

import https from 'https'
import http from 'http'
import { CLIError } from './error.js'
import type { AIConfig } from './config.js'
import type { LearnedWorkflow } from './workflow.js'

// ─── AI Output Types ───────────────────────────────────────────────────────────

export interface CreateAIOutput {
  title: string
  issue_type: string
  summary: string | null
  details: string | null
  steps_to_reproduce: string | null
  expected_behavior: string | null
  actual_behavior: string | null
  has_screenshot: boolean
}

export interface UpdateAIOutput {
  update_summary: string | null
  new_information: string | null
}

// ─── Prompt Templates (PRD §9.3) ──────────────────────────────────────────────

function buildCreatePrompt(threadText: string, workflow?: LearnedWorkflow | null): string {
  const workflowSection = buildWorkflowSection('create', workflow)
  return `You are a support ticket specialist. Your job is to convert a Slack conversation into a well-structured GitHub issue ticket.

Return ONLY a valid JSON object. No markdown fences. No preamble. No commentary.

Schema:
{
  "title": "Short, specific ticket title (max 80 chars)",
  "issue_type": "One of: bug_report | data_request | account_management | billing_issue | configuration_change | access_issue | investigation | feature_request | general",
  "summary": "1–3 sentence neutral description of what is being requested or reported",
  "details": "Any additional context, IDs, account names, URLs, or specifics mentioned that are relevant",
  "steps_to_reproduce": "Numbered steps IF this is a bug_report and steps can be inferred. Otherwise null.",
  "expected_behavior": "What should happen IF this is a bug_report and it can be inferred. Otherwise null.",
  "actual_behavior": "What is actually happening IF this is a bug_report and it can be inferred. Otherwise null.",
  "has_screenshot": "true if the message mentions an image, screenshot, attachment, or photo. Otherwise false."
}

issue_type guide:
- bug_report: Something is broken, not working, or behaving unexpectedly
- data_request: Request for data, reports, statements, or confirmation of information
- account_management: Transfer, reassign, create, or update an account or user
- billing_issue: Invoice, payment, credit note, or pricing discrepancy
- configuration_change: Delete, update settings, or change system configuration
- access_issue: Login problems, blank screens, dashboard not loading, permissions
- investigation: Mismatch, discrepancy, or unclear situation that needs root cause analysis
- feature_request: New capability or enhancement request
- general: Does not clearly fit any of the above

Rules:
- Do NOT suggest labels, assignees, severity, milestones, or projects
- Do NOT reference the reporter's name, @mentions, or Slack-specific context
- Do NOT include any field not in the schema above
- If a field cannot be reasonably inferred, set it to null (or false for booleans)
- Be neutral and professional — this ticket may be read by engineers, QA, or support staff
- This tool is used across many companies and industries — do not assume specific domain knowledge

${workflowSection}

Slack Thread:
---
${threadText}
---`
}

function buildUpdatePrompt(
  existingBody: string,
  newText: string,
  workflow?: LearnedWorkflow | null
): string {
  const workflowSection = buildWorkflowSection('update', workflow)
  return `You are a QA documentation specialist. A GitHub issue exists and new information has been shared in Slack. Generate a structured update.

Return ONLY a valid JSON object. No markdown fences. No preamble. No commentary.

Schema:
{
  "update_summary": "One-line summary of what is new",
  "new_information": "Markdown-formatted details. Avoid repeating what is already in the existing issue."
}

Rules:
- Do NOT suggest labels, assignees, severity, milestones, or projects
- Do NOT repeat information already present in the existing issue body
- Set fields to null if there is nothing meaningful to add

${workflowSection}

Existing Issue Body:
---
${existingBody}
---

New Slack Messages:
---
${newText}
---`
}

function buildWorkflowSection(type: 'create' | 'update', workflow?: LearnedWorkflow | null): string {
  if (!workflow) return ''
  const parts: string[] = []
  if (workflow.instructions) {
    parts.push(`Team Workflow Rules:\n${workflow.instructions}`)
  }
  const extra = type === 'create' ? workflow.prompt?.create : workflow.prompt?.update
  if (extra) {
    parts.push(`Additional ${type} instructions:\n${extra}`)
  }
  if (parts.length === 0) return ''
  return `\n${parts.join('\n\n')}\n`
}

// ─── Core callAI() ─────────────────────────────────────────────────────────────

/**
 * Single entry point for all AI calls.
 * Maps provider to the correct endpoint and request format.
 * Returns the raw text response from the AI model.
 */
export async function callAI(prompt: string, config: AIConfig): Promise<string> {
  const { provider, baseUrl, apiKey, model, timeoutMs } = config

  const isAnthropic = provider === 'anthropic'
  const endpoint = isAnthropic ? `${baseUrl}/v1/messages` : `${baseUrl}/chat/completions`

  const body = isAnthropic
    ? JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      })
    : JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
      })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body)),
  }

  if (isAnthropic) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const rawResponse = await makeRequest(endpoint, headers, body, timeoutMs)

  // Extract text from response based on provider format
  let content: string
  try {
    const parsed = JSON.parse(rawResponse)
    if (isAnthropic) {
      // Anthropic: { content: [{ type: 'text', text: '...' }] }
      content = parsed?.content?.[0]?.text ?? ''
    } else {
      // OpenAI-compatible: { choices: [{ message: { content: '...' } }] }
      content = parsed?.choices?.[0]?.message?.content ?? ''
    }
  } catch {
    throw new CLIError(`AI provider returned non-JSON response. Check your AI configuration.`, 3)
  }

  if (!content) {
    const err = new Error(`AI provider returned an empty response.`);
    (err as any).exitCode = 3
    throw err
  }

  return content
}

function makeRequest(
  endpoint: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)
    const isHttps = url.protocol === 'https:'
    const transport = isHttps ? https : http

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            const err = new Error(
              `AI API authentication failed (HTTP ${res.statusCode}). Check your API key.`
            );
            (err as any).exitCode = 3
            reject(err)
            return
          }
          if (res.statusCode && res.statusCode >= 400) {
            if (res.statusCode === 429) {
              reject(new CLIError(`AI provider rate limited (HTTP 429). Try again later.`, 3))
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              reject(
                new CLIError(
                  `AI provider authentication failed (HTTP ${res.statusCode}). Check your API key.`,
                  3
                )
              )
            } else {
              reject(new CLIError(`AI provider returned HTTP ${res.statusCode}: ${data}`, 3))
            }
            return
          }
          resolve(data)
        })
      }
    )

    // Timeout handling
    const timer = setTimeout(() => {
      req.destroy()
      reject(
        new CLIError(
          `AI request timed out after ${timeoutMs}ms. Consider increasing 'ai.timeoutMs' in your config.`,
          3
        )
      )
    }, timeoutMs)

    req.on('close', () => clearTimeout(timer))
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(new CLIError(`AI request failed: ${e.message}`, 3))
    })

    req.write(body)
    req.end()
  })
}

// ─── Output Validation (PRD §9.4) ─────────────────────────────────────────────

const FORBIDDEN_FIELDS_RE = /^(labels?|assignee|severity|milestone|project):/im

const CREATE_REQUIRED_FIELDS: (keyof CreateAIOutput)[] = ['title', 'summary']
const UPDATE_REQUIRED_FIELDS: (keyof UpdateAIOutput)[] = ['update_summary', 'new_information']

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
}

function tryParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function stripForbiddenContent(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && FORBIDDEN_FIELDS_RE.test(value)) {
      cleaned[key] = null
    } else {
      cleaned[key] = value
    }
  }
  return cleaned
}

/**
 * Parses and validates the AI response for the `create` command.
 * Strips markdown fences and retries once on parse failure.
 * Exits with code 4 on persistent failure.
 */
export function parseCreateOutput(raw: string): CreateAIOutput {
  const ALLOWED_KEYS = new Set<string>([
    'title',
    'issue_type',
    'summary',
    'details',
    'steps_to_reproduce',
    'expected_behavior',
    'actual_behavior',
    'has_screenshot',
  ])

  let parsed = tryParse(raw) ?? tryParse(stripMarkdownFences(raw))

  if (!parsed || typeof parsed !== 'object') {
    const msg = formatAIValidationError(raw)
    throw new CLIError(msg, 4)
  }

  let obj = parsed as Record<string, unknown>

  // Strip disallowed keys
  obj = Object.fromEntries(Object.entries(obj).filter(([k]) => ALLOWED_KEYS.has(k)))

  // Strip forbidden content
  obj = stripForbiddenContent(obj)

  // Validate required fields
  for (const field of CREATE_REQUIRED_FIELDS) {
    if (obj[field] === undefined || obj[field] === '') {
      const msg = formatAIValidationError(raw, `Required field '${field}' is missing or empty.`)
      throw new CLIError(msg, 4)
    }
  }

  return {
    title: String(obj.title ?? '').slice(0, 80),
    issue_type: String(obj.issue_type ?? 'general'),
    summary: (obj.summary as string | null) ?? null,
    details: (obj.details as string | null) ?? null,
    steps_to_reproduce: (obj.steps_to_reproduce as string | null) ?? null,
    expected_behavior: (obj.expected_behavior as string | null) ?? null,
    actual_behavior: (obj.actual_behavior as string | null) ?? null,
    has_screenshot: Boolean(obj.has_screenshot ?? false),
  }
}

/**
 * Parses and validates the AI response for the `update` command.
 */
export function parseUpdateOutput(raw: string): UpdateAIOutput {
  const ALLOWED_KEYS = new Set<string>(['update_summary', 'new_information'])

  let parsed = tryParse(raw) ?? tryParse(stripMarkdownFences(raw))

  if (!parsed || typeof parsed !== 'object') {
    const msg = formatAIValidationError(raw)
    throw new CLIError(msg, 4)
  }

  let obj = parsed as Record<string, unknown>
  obj = Object.fromEntries(Object.entries(obj).filter(([k]) => ALLOWED_KEYS.has(k)))
  obj = stripForbiddenContent(obj)

  for (const field of UPDATE_REQUIRED_FIELDS) {
    if (obj[field] === undefined) {
      obj[field] = null
    }
  }

  return {
    update_summary: (obj.update_summary as string | null) ?? null,
    new_information: (obj.new_information as string | null) ?? null,
  }
}

function formatAIValidationError(raw: string, detail?: string): string {
  return `AI output validation failed.${detail ? ' ' + detail : ''}\nRaw AI response:\n---\n${raw}\n---`
}

// ─── Public Convenience Functions ─────────────────────────────────────────────

/**
 * Full pipeline for `create`: call AI → validate → return typed output.
 */
export async function generateIssueFromThread(
  threadText: string,
  config: AIConfig,
  workflow?: LearnedWorkflow | null
): Promise<CreateAIOutput> {
  const prompt = buildCreatePrompt(threadText, workflow)
  const raw = await callAI(prompt, config)
  return parseCreateOutput(raw)
}

/**
 * Full pipeline for `update`: call AI → validate → return typed output.
 */
export async function generateIssueUpdate(
  existingBody: string,
  newText: string,
  config: AIConfig,
  workflow?: LearnedWorkflow | null
): Promise<UpdateAIOutput> {
  const prompt = buildUpdatePrompt(existingBody, newText, workflow)
  const raw = await callAI(prompt, config)
  return parseUpdateOutput(raw)
}
