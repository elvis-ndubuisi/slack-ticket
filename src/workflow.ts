/**
 * Workflow learning module for slack-ticket.
 *
 * Handles:
 * - Parsing a Markdown workflow file (optionally containing a JSON config block)
 * - Persisting learned workflows locally
 * - Selecting the correct workflow for a repo
 * - Non-blocking validation against GitHub (warnings only)
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import crypto from 'crypto'
import { readConfig, type Config, type LabelsConfig, type DefaultsConfig } from './config.js'
import { githubGraphQL, githubRequest, filterExistingLabels } from './github.js'

export interface WorkflowPromptOverrides {
  create?: string
  update?: string
}

export interface ProjectRoutingRule {
  pattern: string
  projectId: string
}

export interface LearnedWorkflow {
  id: string
  name?: string
  repos: string[]
  source: string
  createdAt: string
  updatedAt: string
  instructions?: string
  prompt?: WorkflowPromptOverrides
  labels?: Partial<LabelsConfig>
  defaults?: Partial<DefaultsConfig>
  defaultProject?: string
  projectRouting?: ProjectRoutingRule[]
  projectFields?: Record<string, string | number>
}

interface WorkflowStore {
  version: number
  workflows: LearnedWorkflow[]
}

const WORKFLOW_STORE_VERSION = 1

export function getWorkflowPath(): string {
  return path.join(os.homedir(), '.slack-ticket', 'workflows.json')
}

export function readWorkflows(): WorkflowStore {
  const filePath = getWorkflowPath()
  if (!fs.existsSync(filePath)) {
    return { version: WORKFLOW_STORE_VERSION, workflows: [] }
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WorkflowStore
    if (!raw || typeof raw !== 'object') {
      return { version: WORKFLOW_STORE_VERSION, workflows: [] }
    }
    if (raw.version !== WORKFLOW_STORE_VERSION || !Array.isArray(raw.workflows)) {
      return { version: WORKFLOW_STORE_VERSION, workflows: [] }
    }
    return raw
  } catch {
    return { version: WORKFLOW_STORE_VERSION, workflows: [] }
  }
}

export function writeWorkflows(store: WorkflowStore): void {
  const filePath = getWorkflowPath()
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8')
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600)
}

export function deleteWorkflows(): boolean {
  const filePath = getWorkflowPath()
  if (!fs.existsSync(filePath)) return false
  fs.unlinkSync(filePath)
  return true
}

export function selectWorkflowForRepo(owner: string, repo: string): LearnedWorkflow | null {
  const full = `${owner}/${repo}`.toLowerCase()
  const store = readWorkflows()

  // Exact match first
  for (const wf of store.workflows) {
    if (wf.repos?.some((r) => r.toLowerCase() === full)) return wf
  }

  // Wildcard match
  for (const wf of store.workflows) {
    if (wf.repos?.some((r) => r.trim() === '*')) return wf
  }

  return null
}

export async function fetchWorkflowSource(input: string): Promise<{ source: string; body: string }>
{
  const isUrl = /^https?:\/\//i.test(input)
  if (!isUrl) {
    const abs = path.resolve(process.cwd(), input)
    const body = fs.readFileSync(abs, 'utf-8')
    return { source: abs, body }
  }

  const url = normalizeGitHubUrl(input)
  const body = await httpGet(url)
  return { source: url, body }
}

function normalizeGitHubUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname === 'github.com') {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts.length >= 4 && parts[2] === 'blob') {
        const [owner, repo, _blob, branch, ...rest] = parts
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest.join('/')}`
      }
    }
  } catch {
    // fall through
  }
  return url
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const transport = u.protocol === 'https:' ? https : http
    const req = transport.request(
      {
        method: 'GET',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'slack-ticket-cli' },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          {
          // Follow redirects
          httpGet(res.headers.location).then(resolve).catch(reject)
          return
        }
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(data))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

export function parseWorkflowMarkdown(
  markdown: string,
  config: Config
): Omit<LearnedWorkflow, 'id' | 'createdAt' | 'updatedAt' | 'source'> {
  const configBlock = extractJsonConfigBlock(markdown)

  let parsedConfig: any = null
  if (configBlock) {
    try {
      parsedConfig = JSON.parse(configBlock)
    } catch {
      parsedConfig = null
    }
  }

  const instructions =
    parsedConfig?.instructions && typeof parsedConfig.instructions === 'string'
      ? parsedConfig.instructions
      : stripConfigBlock(markdown).trim() || undefined

  const repos: string[] = Array.isArray(parsedConfig?.repos)
    ? parsedConfig.repos
        .map((r: any) => String(r).trim())
        .filter((r: string) => r.length > 0)
    : []

  // Default scoping: apply to the user's configured default repo
  if (repos.length === 0) {
    repos.push(`${config.github.owner}/${config.github.defaultRepo}`)
  }

  return {
    name: parsedConfig?.name,
    repos,
    instructions,
    prompt: parsedConfig?.prompt,
    labels: parsedConfig?.labels,
    defaults: parsedConfig?.defaults,
    defaultProject: parsedConfig?.defaultProject,
    projectRouting: parsedConfig?.projectRouting,
    projectFields: parsedConfig?.projectFields,
  }
}

function extractJsonConfigBlock(markdown: string): string | null {
  const re = /```(?:slack-ticket|slackticket|json)\s*([\s\S]*?)```/i
  const m = markdown.match(re)
  if (!m) return null
  const body = m[1]?.trim() ?? ''
  if (!body.startsWith('{')) return null
  return body
}

function stripConfigBlock(markdown: string): string {
  return markdown.replace(/```(?:slack-ticket|slackticket|json)[\s\S]*?```/i, '').trim()
}

export async function validateWorkflow(
  workflow: LearnedWorkflow,
  config: Config
): Promise<string[]> {
  const warnings: string[] = []

  // Validate repos access
  for (const repoFull of workflow.repos) {
    if (repoFull.trim() === '*') continue
    const [owner, repo] = repoFull.split('/')
    if (!owner || !repo) {
      warnings.push(`Invalid repo format in workflow: '${repoFull}'. Expected owner/repo.`)
      continue
    }
    try {
      const { status } = await githubRequest(
        'GET',
        `/repos/${owner}/${repo}`,
        config.github.token
      )
      if (status !== 200) {
        warnings.push(`Repo not accessible or not found: ${owner}/${repo}.`)
      }
    } catch {
      warnings.push(`Could not validate repo access for ${owner}/${repo}.`)
    }
  }

  // Validate labels (best-effort)
  const allLabels = collectWorkflowLabels(workflow.labels)
  if (allLabels.length > 0) {
    const repoFull = workflow.repos.find((r) => r.includes('/'))
    const [owner, repo] = repoFull ? repoFull.split('/') : []
    if (owner && repo) {
      try {
        const existing = await filterExistingLabels(allLabels, owner, repo, config.github.token)
        const missing = allLabels.filter((l) => !existing.includes(l))
        if (missing.length > 0) {
          warnings.push(
            `Some labels do not exist in ${owner}/${repo}: ${missing.join(', ')}`
          )
        }
      } catch {
        warnings.push(`Could not validate labels against ${owner}/${repo}.`)
      }
    }
  }

  // Validate project IDs (best-effort)
  const projectIds = new Set<string>()
  if (workflow.defaultProject) projectIds.add(workflow.defaultProject)
  for (const rule of workflow.projectRouting ?? []) {
    if (rule?.projectId) projectIds.add(rule.projectId)
  }

  for (const projectId of projectIds) {
    try {
      const res = (await githubGraphQL(
        `query($id: ID!) { node(id: $id) { id } }`,
        { id: projectId },
        config.github.token
      )) as any
      if (res?.errors || !res?.data?.node) {
        warnings.push(`Project ID not found or inaccessible: ${projectId}`)
      }
    } catch {
      warnings.push(`Could not validate project ID: ${projectId}`)
    }
  }

  return warnings
}

function collectWorkflowLabels(labels?: Partial<LabelsConfig>): string[] {
  if (!labels) return []
  const out: string[] = []
  const add = (arr?: string[]) => {
    if (Array.isArray(arr)) out.push(...arr)
  }
  for (const key of Object.keys(labels.keywords ?? {})) {
    add(labels.keywords?.[key])
  }
  for (const key of Object.keys(labels.severity ?? {})) {
    add(labels.severity?.[key])
  }
  for (const key of Object.keys(labels.components ?? {})) {
    add(labels.components?.[key])
  }
  return [...new Set(out)]
}

export function upsertWorkflow(workflow: LearnedWorkflow): void {
  const store = readWorkflows()

  const newRepos = new Set((workflow.repos ?? []).map((r) => r.toLowerCase()))

  // Remove existing workflows that target the same repo(s)
  store.workflows = store.workflows.filter((w) => {
    if (w.id === workflow.id) return true
    const overlap = (w.repos ?? []).some((r) => newRepos.has(r.toLowerCase()))
    return !overlap
  })

  const idx = store.workflows.findIndex((w) => w.id === workflow.id)
  if (idx >= 0) store.workflows[idx] = workflow
  else store.workflows.push(workflow)

  writeWorkflows(store)
}

export function createWorkflowId(source: string): string {
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 10)
  return `workflow-${hash}`
}

export function mergeLabels(base: LabelsConfig, override?: Partial<LabelsConfig>): LabelsConfig {
  if (!override) return base

  return {
    keywords: { ...base.keywords, ...(override.keywords ?? {}) },
    severity: { ...base.severity, ...(override.severity ?? {}) },
    components: { ...base.components, ...(override.components ?? {}) },
  }
}

export function mergeDefaults(
  base: DefaultsConfig,
  override?: Partial<DefaultsConfig>
): DefaultsConfig {
  if (!override) return base
  return { ...base, ...override }
}

export function getWorkflowForRepo(owner: string, repo: string): LearnedWorkflow | null {
  return selectWorkflowForRepo(owner, repo)
}

export function listWorkflows(): LearnedWorkflow[] {
  return readWorkflows().workflows
}

export function findWorkflowsByIdOrRepo(input: string): LearnedWorkflow[] {
  const store = readWorkflows()
  const needle = input.toLowerCase().trim()
  if (!needle) return []

  if (needle.includes('/')) {
    return store.workflows.filter((w) =>
      (w.repos ?? []).some((r) => r.toLowerCase() === needle)
    )
  }

  return store.workflows.filter((w) => w.id.toLowerCase() === needle)
}

export function getEffectiveConfigForRepo(owner: string, repo: string): {
  config: Config
  workflow: LearnedWorkflow | null
} {
  const config = readConfig()
  const workflow = selectWorkflowForRepo(owner, repo)

  if (!workflow) return { config, workflow: null }

  const merged = { ...config }
  merged.labels = mergeLabels(config.labels, workflow.labels)
  merged.defaults = mergeDefaults(config.defaults, workflow.defaults)
  if (workflow.defaultProject) {
    merged.github = { ...config.github, defaultProject: workflow.defaultProject }
  }

  return { config: merged, workflow }
}
