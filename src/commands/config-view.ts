/**
 * `slack-ticket config view`
 *
 * Prints current config with all tokens masked.
 * Token masking: first 4 + **** + last 4 characters.
 */

import chalk from 'chalk';
import { readConfig, maskToken } from '../config.js';

export async function runConfigView(): Promise<void> {
    const config = readConfig();

    console.log(chalk.bold('\n⚙  slack-ticket configuration\n'));

    console.log(chalk.underline('Slack'));
    console.log(`  Bot Token:      ${maskToken(config.slack.botToken)}`);

    console.log(chalk.underline('\nGitHub'));
    console.log(`  Token:          ${maskToken(config.github.token)}`);
    console.log(`  Owner:          ${config.github.owner}`);
    console.log(`  Default Repo:   ${config.github.defaultRepo}`);
    console.log(`  Default Project:${config.github.defaultProject ? ` ${config.github.defaultProject}` : ' (none)'}`);

    console.log(chalk.underline('\nAI'));
    console.log(`  Provider:       ${config.ai.provider}`);
    console.log(`  Base URL:       ${config.ai.baseUrl}`);
    console.log(`  API Key:        ${maskToken(config.ai.apiKey)}`);
    console.log(`  Model:          ${config.ai.model}`);
    console.log(`  Timeout:        ${config.ai.timeoutMs}ms`);

    console.log(chalk.underline('\nDefaults'));
    console.log(`  Severity:       ${config.defaults.severity}`);
    console.log(`  Component:      ${config.defaults.component ?? '(none)'}`);
    console.log(`  Thread Depth:   ${config.defaults.threadDepth}`);
    console.log(`  Image Handling: ${config.defaults.imageHandling ? 'enabled' : 'disabled'}`);

    console.log(chalk.underline('\nLabel Keywords'));
    for (const [pattern, labels] of Object.entries(config.labels.keywords)) {
        console.log(`  "${pattern}" → [${labels.join(', ')}]`);
    }
    console.log();
}
