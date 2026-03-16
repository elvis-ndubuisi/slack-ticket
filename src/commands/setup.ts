/**
 * `slack-ticket setup`
 *
 * Interactive first-time configuration. Safe to re-run to update values.
 * Walks the user through 14 prompts (PRD §8.1), validates tokens, and saves config.
 */

import { input, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import https from 'https';
import { writeConfig, getConfigPath, maskToken, type Config } from '../config.js';

// ─── Provider base URL map (PRD §8.1) ─────────────────────────────────────────
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  local: 'http://localhost:11434/v1',
  custom: '',
};

// ─── Provider default model suggestions ───────────────────────────────────────
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-1.5-pro',
  local: 'llama3',
  custom: '',
};

// ─── Validation helpers ────────────────────────────────────────────────────────

async function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
    setTimeout(() => req.destroy(new Error('timeout')), 10000);
    req.write(body);
    req.end();
  });
}

async function httpsGet(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on('error', reject);
    setTimeout(() => req.destroy(new Error('timeout')), 10000);
    req.end();
  });
}

/**
 * Validate Slack bot token via auth.test
 */
async function validateSlack(token: string): Promise<boolean> {
  try {
    const res = await httpsPost(
      'https://slack.com/api/auth.test',
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      '{}'
    );
    const data = JSON.parse(res.body) as { ok: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Validate GitHub token + verify repo exists.
 */
async function validateGitHub(
  token: string,
  owner: string,
  repo: string
): Promise<{ userOk: boolean; repoOk: boolean }> {
  try {
    const userRes = await httpsGet('https://api.github.com/user', {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'slack-ticket-cli',
      Accept: 'application/vnd.github+json',
    });
    if (userRes.status !== 200) return { userOk: false, repoOk: false };

    const repoRes = await httpsGet(`https://api.github.com/repos/${owner}/${repo}`, {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'slack-ticket-cli',
      Accept: 'application/vnd.github+json',
    });
    return { userOk: true, repoOk: repoRes.status === 200 };
  } catch {
    return { userOk: false, repoOk: false };
  }
}

/**
 * Validate AI provider with a minimal completion request.
 */
async function validateAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  provider: string
): Promise<boolean> {
  try {
    const endpoint =
      provider === 'anthropic' ? `${baseUrl}/v1/messages` : `${baseUrl}/chat/completions`;

    const body =
      provider === 'anthropic'
        ? JSON.stringify({
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Respond with: ok' }],
          })
        : JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'Respond with: ok' }],
            max_tokens: 10,
          });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await httpsPost(endpoint, headers, body);
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

// ─── Main setup flow ───────────────────────────────────────────────────────────

export async function runSetup(): Promise<void> {
  console.log(chalk.bold('\n👋 Welcome to slack-ticket setup!\n'));
  console.log(
    "You'll be prompted for your tokens and preferences. Press Enter to accept defaults.\n"
  );

  // ── 1. Slack bot token ──
  const slackBotToken = await input({
    message: 'Slack Bot Token (xoxb-...):',
    validate: (v: string) => (v.startsWith('xoxb-') ? true : 'Must start with xoxb-'),
  });

  // ── 2. GitHub PAT ──
  const githubToken = await input({
    message: 'GitHub Personal Access Token (ghp_...):',
    validate: (v: string) => (v.length > 10 ? true : 'Token looks too short'),
  });

  // ── 3. GitHub owner ──
  const githubOwner = await input({
    message: 'GitHub Owner (org or username):',
    validate: (v: string) => (v.trim().length > 0 ? true : 'Required'),
  });

  // ── 4. Default repo ──
  const defaultRepo = await input({
    message: 'Default GitHub Repository name:',
    validate: (v: string) => (v.trim().length > 0 ? true : 'Required'),
  });

  // ── 5. GitHub Project ID (optional) ──
  const defaultProject = await input({
    message: 'GitHub Project v2 ID (optional — press Enter to skip):',
  });

  // ── 6. AI provider ──
  const provider = await select<string>({
    message: 'AI Provider:',
    choices: [
      { name: 'OpenAI', value: 'openai' },
      { name: 'Anthropic', value: 'anthropic' },
      { name: 'Gemini', value: 'gemini' },
      { name: 'Local (Ollama)', value: 'local' },
      { name: 'Custom (OpenAI-compatible)', value: 'custom' },
    ],
  });

  // ── 7. AI base URL (pre-filled) ──
  const baseUrl = await input({
    message: 'AI Base URL:',
    default: PROVIDER_BASE_URLS[provider] ?? '',
    validate: (v: string) => (v.trim().length > 0 ? true : 'Required'),
  });

  // ── 8. AI API key ──
  const aiApiKey = await input({
    message: 'AI API Key:',
    validate: (v: string) => (v.trim().length > 0 ? true : 'Required'),
  });

  // ── 9. AI model ──
  const aiModel = await input({
    message: 'AI Model name:',
    default: PROVIDER_DEFAULT_MODELS[provider] ?? '',
    validate: (v: string) => (v.trim().length > 0 ? true : 'Required'),
  });

  // ── 10. AI timeout ──
  const timeoutInput = await input({
    message: 'AI request timeout (ms):',
    default: '20000',
    validate: (v: string) =>
      !isNaN(Number(v)) && Number(v) > 0 ? true : 'Must be a positive number',
  });

  // ── 11. Image handling ──
  const imageHandling = await confirm({
    message: 'Enable image handling (attach Slack screenshots to GitHub issues)?',
    default: true,
  });

  // ── 12. Default thread depth ──
  const threadDepthInput = await input({
    message: 'Default thread depth — opening messages to fetch (1–20):',
    default: '3',
    validate: (v: string) => {
      const n = Number(v);
      return n >= 1 && n <= 20 ? true : 'Must be between 1 and 20';
    },
  });

  // ── 13. Default severity ──
  const severity = await select<'low' | 'medium' | 'high' | 'critical'>({
    message: 'Default severity:',
    choices: [
      { name: 'Low', value: 'low' },
      { name: 'Medium (default)', value: 'medium' },
      { name: 'High', value: 'high' },
      { name: 'Critical', value: 'critical' },
    ],
    default: 'medium',
  });

  // ── 14. Default component ──
  const component = await input({
    message: 'Default component (optional — press Enter to skip):',
  });

  // ── Token validation ──────────────────────────────────────────────────────────
  console.log('\n' + chalk.bold('Validating tokens...'));

  let slackOk = false;
  let githubUserOk = false;
  let githubRepoOk = false;
  let aiOk = false;

  const spinner = ora('Checking Slack...').start();
  slackOk = await validateSlack(slackBotToken);
  spinner.stopAndPersist({
    symbol: slackOk ? chalk.green('✓') : chalk.red('✗'),
    text: slackOk ? `Slack: validated` : `Slack: ${chalk.red('validation failed')}`,
  });

  spinner.start('Checking GitHub...');
  const ghResult = await validateGitHub(githubToken, githubOwner, defaultRepo);
  githubUserOk = ghResult.userOk;
  githubRepoOk = ghResult.repoOk;
  spinner.stopAndPersist({
    symbol: githubUserOk && githubRepoOk ? chalk.green('✓') : chalk.red('✗'),
    text:
      githubUserOk && githubRepoOk
        ? `GitHub: validated (${githubOwner}/${defaultRepo})`
        : `GitHub: ${chalk.red(
            !githubUserOk ? 'token invalid' : `repo '${githubOwner}/${defaultRepo}' not found`
          )}`,
  });

  spinner.start('Checking AI provider...');
  aiOk = await validateAI(baseUrl, aiApiKey, aiModel, provider);
  spinner.stopAndPersist({
    symbol: aiOk ? chalk.green('✓') : chalk.red('✗'),
    text: aiOk
      ? `AI: validated (${provider} / ${aiModel})`
      : `AI: ${chalk.red('validation failed')}`,
  });

  const allValid = slackOk && githubUserOk && githubRepoOk && aiOk;

  if (!allValid) {
    const saveAnyway = await confirm({
      message: chalk.yellow('⚠  Some validations failed. Save config anyway?'),
      default: false,
    });
    if (!saveAnyway) {
      console.log(chalk.red('\nSetup cancelled. No config saved.'));
      process.exit(0);
    }
  }

  // ── Build config object ───────────────────────────────────────────────────────
  const config: Config = {
    configVersion: 1,
    slack: { botToken: slackBotToken },
    github: {
      token: githubToken,
      owner: githubOwner,
      defaultRepo,
      ...(defaultProject.trim() ? { defaultProject: defaultProject.trim() } : {}),
    },
    ai: {
      provider: provider as Config['ai']['provider'],
      baseUrl,
      apiKey: aiApiKey,
      model: aiModel,
      timeoutMs: Number(timeoutInput),
    },
    defaults: {
      severity,
      component: component.trim() || null,
      threadDepth: Number(threadDepthInput),
      imageHandling,
    },
    labels: {
      keywords: {
        'login|sign in|auth|sso': ['auth', 'backend'],
        'payment|billing|checkout': ['billing', 'backend'],
        'ui|button|layout|display': ['app:frontend'],
        'crash|error|exception': ['bug'],
        'slow|performance|timeout': ['performance'],
      },
      severity: {
        low: ['priority:low'],
        medium: ['priority:medium'],
        high: ['priority:high'],
        critical: ['priority:critical'],
      },
      components: {
        auth: ['component:auth'],
        payments: ['component:payments'],
        dashboard: ['component:dashboard'],
      },
    },
  };

  writeConfig(config);

  // ── Post-save summary ──────────────────────────────────────────────────────────
  const configPath = getConfigPath();
  console.log(`\n${chalk.green('✓')} Config saved to ${chalk.cyan(configPath)}\n`);
  console.log(
    `  Slack:        ${slackOk ? chalk.green('validated ✓') : chalk.red('not validated ✗')}`
  );
  console.log(
    `  GitHub:       ${
      githubUserOk && githubRepoOk
        ? chalk.green(`validated ✓  (${githubOwner}/${defaultRepo})`)
        : chalk.red('not validated ✗')
    }`
  );
  console.log(
    `  AI:           ${aiOk ? chalk.green(`validated ✓  (${provider} / ${aiModel})`) : chalk.red('not validated ✗')}`
  );
  if (defaultProject.trim()) {
    console.log(`  Project:      ${defaultProject.trim()}`);
  }
  console.log(`  Images:       ${imageHandling ? 'enabled' : 'disabled'}`);
  console.log(`  Thread depth: ${threadDepthInput} messages`);
  console.log(`  Severity:     ${severity}`);
  console.log(
    `\nRun ${chalk.cyan("'slack-ticket doctor'")} at any time to re-validate your setup.\n`
  );
}
