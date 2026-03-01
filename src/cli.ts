#!/usr/bin/env node

/**
 * slack-ticket CLI entry point
 * Registers all top-level commands and wires them to their handlers.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';

// ─── Node.js version guard ────────────────────────────────────────────────────
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
    console.error(
        `Error: slack-ticket requires Node.js >= 18.0.0. You are running v${process.versions.node}.\nUpgrade: https://nodejs.org`
    );
    process.exit(1);
}

// ─── Package version ──────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = (require(path.join(__dirname, '..', 'package.json')) as { version: string });

// ─── Program definition ───────────────────────────────────────────────────────
const program = new Command();

program
    .name('slack-ticket')
    .description('Convert Slack threads into structured GitHub issues')
    .version(pkg.version, '-v, --version', 'Output the current version');

import { CLIError } from './error.js';

/**
 * Strips sensitive tokens from error messages before logging.
 */
function maskSensitiveData(text: string): string {
    if (!text) return text;
    // Mask Slack bot tokens (xoxb-... or xoxp-...)
    let safeText = text.replace(/xox[bp]-[A-Za-z0-9-]+/g, '[REDACTED_SLACK_TOKEN]');
    // Mask GitHub PATs (ghp_... or github_pat_...)
    safeText = safeText.replace(/(ghp|github_pat)_[A-Za-z0-9_]+/g, '[REDACTED_GITHUB_TOKEN]');
    return safeText;
}

/**
 * Wraps an async command handler to catch and handle errors gracefully.
 * Specifically handles 'ExitPromptError' from Inquirer (SIGINT).
 */
async function wrapAction(fn: () => Promise<void>) {
    try {
        await fn();
    } catch (error: any) {
        // Check for ExitPromptError (user pressed Ctrl+C)
        if (error.name === 'ExitPromptError' || error.message?.includes('force closed')) {
            console.log(chalk.yellow('\n\nAborted.'));
            process.exit(0);
        }

        // Map other errors if they have a 'code' property or match specific types
        const exitCode = (error instanceof CLIError || typeof error.exitCode === 'number') ? error.exitCode : 1;
        const rawMessage = error.message || 'An unknown error occurred.';
        const safeMessage = maskSensitiveData(rawMessage);

        console.error(chalk.red(`\nError: ${safeMessage}`));

        if (exitCode === 1 && !error.message?.includes('Aborted')) {
            // Uncomment to debug unclassified errors locally:
            // console.error(maskSensitiveData(error.stack || ''));
        }

        process.exit(exitCode);
    }
}

// ─── setup ────────────────────────────────────────────────────────────────────
program
    .command('setup')
    .description('Interactive first-time configuration. Safe to re-run to update values.')
    .action(() => wrapAction(async () => {
        const { runSetup } = await import('./commands/setup.js');
        await runSetup();
    }));

// ─── create ───────────────────────────────────────────────────────────────────
program
    .command('create <slack-thread-url>')
    .description('Fetch a Slack thread and create a GitHub issue')
    .option('--depth <n>', 'Number of thread messages to fetch (1–10)', '3')
    .option('--severity <level>', 'low | medium | high | critical')
    .option('--component <name>', 'Component name matching a key in config labels.components')
    .option('--repo <owner/repo>', 'Override target repo (owner/repo or just repo)')
    .option('--project <project-id>', 'Override GitHub Project v2 ID')
    .option('--no-project', 'Skip project assignment for this run')
    .option('--no-image', 'Skip image handling for this run')
    .option('--labels <labels>', 'Comma-separated list of additional labels to apply')
    .option('--yes', 'Skip confirmation prompt')
    .option('--dry-run', 'Full preview without creating a GitHub issue')
    .action((slackUrl: string, options) => wrapAction(async () => {
        const { runCreate } = await import('./commands/create.js');
        await runCreate(slackUrl, options);
    }));

// ─── update ───────────────────────────────────────────────────────────────────
program
    .command('update <issue-number> <slack-message-url...>')
    .description('Append new Slack messages to an existing GitHub issue')
    .option('--repo <owner/repo>', 'Override repo')
    .option('--comment', 'Append as a new issue comment (default: append to body)')
    .option('--yes', 'Skip confirmation prompt')
    .option('--dry-run', 'Preview without updating the issue')
    .action((issueNumber: string, slackUrls: string[], options) => wrapAction(async () => {
        const { runUpdate } = await import('./commands/update.js');
        await runUpdate(Number(issueNumber), slackUrls, options);
    }));

// ─── doctor ───────────────────────────────────────────────────────────────────
program
    .command('doctor')
    .description('Validate all configured tokens and permissions')
    .action(() => wrapAction(async () => {
        const { runDoctor } = await import('./commands/doctor.js');
        await runDoctor();
    }));

// ─── config ───────────────────────────────────────────────────────────────────
const configCmd = program.command('config').description('View or edit the configuration file');

configCmd
    .command('view')
    .description('Print current config with tokens masked')
    .action(() => wrapAction(async () => {
        const { runConfigView } = await import('./commands/config-view.js');
        await runConfigView();
    }));

configCmd
    .command('edit')
    .description('Open config in $EDITOR for manual editing')
    .action(() => wrapAction(async () => {
        const { runConfigEdit } = await import('./commands/config-edit.js');
        await runConfigEdit();
    }));

// ─── Run ──────────────────────────────────────────────────────────────────────
program.parse(process.argv);

