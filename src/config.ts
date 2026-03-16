/**
 * Configuration module for slack-ticket.
 *
 * Handles:
 * - Reading / writing ~/.slack-ticket/config.json
 * - Config versioning and migration
 * - TypeScript types for the full config schema
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Current config version ────────────────────────────────────────────────────
export const CURRENT_CONFIG_VERSION = 1

// ─── Config schema types ───────────────────────────────────────────────────────

export interface SlackConfig {
  botToken: string
}

export interface GitHubConfig {
  token: string
  owner: string
  defaultRepo: string
  defaultProject?: string
}

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'local' | 'custom'
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

export interface DefaultsConfig {
  severity: 'low' | 'medium' | 'high' | 'critical'
  component: string | null
  threadDepth: number
  imageHandling: boolean
}

export interface LabelsConfig {
  keywords: Record<string, string[]>
  severity: Record<string, string[]>
  components: Record<string, string[]>
}

export interface Config {
  configVersion: number
  slack: SlackConfig
  github: GitHubConfig
  ai: AIConfig
  defaults: DefaultsConfig
  labels: LabelsConfig
}

// ─── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the config file.
 * Uses os.homedir() + path.join() — never hardcoded.
 */
export function getConfigPath(): string {
  return path.join(os.homedir(), '.slack-ticket', 'config.json')
}

/**
 * Returns the config directory path.
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.slack-ticket')
}

// ─── Config read ───────────────────────────────────────────────────────────────

/**
 * Reads, parses, and validates the config file.
 * Handles all versioning scenarios from PRD §7.4.
 * Exits with code 6 on unrecoverable config errors.
 */
export function readConfig(): Config {
  const configPath = getConfigPath()

  // File missing
  if (!fs.existsSync(configPath)) {
    console.error("No config found. Run 'slack-ticket setup' to get started.")
    process.exit(6)
  }

  // Invalid JSON
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    console.error("Config file is corrupted. Run 'slack-ticket setup' to reconfigure.")
    process.exit(6)
  }

  const cfg = raw as Partial<Config> & { configVersion?: number }

  // Missing configVersion — treat as v0
  if (cfg.configVersion === undefined) {
    console.warn(
      '⚠  Config configVersion is missing — treating as version 0. ' +
        "Run 'slack-ticket setup' to upgrade."
    )
    // Continue — allow use of config
  } else if (cfg.configVersion > CURRENT_CONFIG_VERSION) {
    // Config is from a newer version of the tool
    console.error('Your config was created by a newer version of slack-ticket. Please upgrade.')
    process.exit(6)
  } else if (cfg.configVersion < CURRENT_CONFIG_VERSION) {
    // Auto-migrate if safe (currently v0 → v1 is safe: just add the version field)
    console.warn(
      `⚠  Config version ${cfg.configVersion} detected. Auto-migrating to version ${CURRENT_CONFIG_VERSION}...`
    )
    cfg.configVersion = CURRENT_CONFIG_VERSION
    writeConfig(cfg as Config)
    console.log('✓ Config migrated successfully.')
  }

  return cfg as Config
}

// ─── Config write ──────────────────────────────────────────────────────────────

/**
 * Writes the config object to disk.
 * Creates the config directory if it doesn't exist.
 * Sets file permissions to 0600 on macOS/Linux.
 */
export function writeConfig(config: Config): void {
  const configDir = getConfigDir()
  const configPath = getConfigPath()

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

  // Apply secure permissions on non-Windows platforms
  if (process.platform !== 'win32') {
    fs.chmodSync(configPath, 0o600)
  }
}

// ─── Token masking ─────────────────────────────────────────────────────────────

/**
 * Masks a sensitive token string.
 * Shows first 4 + **** + last 4 characters.
 * Returns the full string if it's too short to mask meaningfully.
 */
export function maskToken(token: string): string {
  if (!token || token.length <= 8) return '****'
  return `${token.slice(0, 4)}****${token.slice(-4)}`
}
