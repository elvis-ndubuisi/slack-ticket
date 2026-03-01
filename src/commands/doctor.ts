import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../config.js';
import { slackGet } from '../slack.js';
import { githubRequest, githubGraphQL } from '../github.js';
import { callAI } from '../ai.js';

/**
 * doctor command implementation.
 * Runs a sequence of 6 checks to validate configuration and connectivity.
 */
export async function runDoctor(): Promise<void> {
    console.log(chalk.cyan('\nChecking your slack-ticket configuration...\n'));

    const config = readConfig();
    const spinner = ora();

    // 1. Slack Token — auth.test
    spinner.start('Checking Slack token...');
    try {
        const res = await slackGet('auth.test', {}, config.slack.botToken);
        if (!res.ok) throw new Error(res.error || 'Unknown Slack error');
        spinner.succeed(`Slack token:    ${chalk.green('✓ Valid')} (bot: ${res.bot_id})`);
    } catch (err: any) {
        spinner.fail(`Slack token:    ${chalk.red('✗ Invalid')}`);
        console.log(chalk.yellow(`    → Check your bot token in config or run 'slack-ticket setup'.`));
    }

    // 2. Slack Channel Access
    spinner.start('Checking Slack channel access...');
    try {
        // We use a dummy list call to see if we can at least list public channels
        const res = await slackGet('conversations.list', { limit: 1, types: 'public_channel' }, config.slack.botToken);
        if (!res.ok) throw new Error(res.error || 'Unknown Slack error');
        spinner.succeed(`Slack access:   ${chalk.green('✓ Valid')} (can list public channels)`);
    } catch (err: any) {
        spinner.fail(`Slack access:   ${chalk.red('✗ Limited')}`);
        console.log(chalk.yellow(`    → Ensure your bot has 'channels:read' scope.`));
    }

    // 3. GitHub Token — GET /user
    spinner.start('Checking GitHub token...');
    try {
        const { status, data } = await githubRequest('GET', '/user', config.github.token);
        if (status !== 200) throw new Error((data as any)?.message || `HTTP ${status}`);
        spinner.succeed(`GitHub token:   ${chalk.green('✓ Valid')} (user: ${(data as any).login})`);
    } catch (err: any) {
        spinner.fail(`GitHub token:   ${chalk.red('✗ Invalid')}`);
        console.log(chalk.yellow(`    → Check your GitHub token scopes (repo, project).`));
    }

    // 4. GitHub Repo Access
    spinner.start('Checking GitHub repo access...');
    try {
        const { status, data } = await githubRequest('GET', `/repos/${config.github.owner}/${config.github.defaultRepo}`, config.github.token);
        if (status !== 200) throw new Error((data as any)?.message || `HTTP ${status}`);
        spinner.succeed(`GitHub repo:    ${chalk.green('✓ Accessible')} (${config.github.owner}/${config.github.defaultRepo})`);
    } catch (err: any) {
        spinner.fail(`GitHub repo:    ${chalk.red('✗ Not found or inaccessible')}`);
        console.log(chalk.yellow(`    → Check owner/repo names in config.`));
    }

    // 5. GitHub Project Access (if configured)
    if (config.github.defaultProject) {
        spinner.start('Checking GitHub project access...');
        try {
            const query = `query($id: ID!) { node(id: $id) { id } }`;
            const res = await githubGraphQL(query, { id: config.github.defaultProject }, config.github.token) as any;
            if (res.errors || !res.data?.node) throw new Error('Project not found');
            spinner.succeed(`GitHub project: ${chalk.green('✓ Accessible')} (${config.github.defaultProject})`);
        } catch (err: any) {
            spinner.fail(`GitHub project: ${chalk.red('✗ Not found or inaccessible')}`);
            console.log(chalk.yellow(`    → Check your projectId in config.`));
        }
    } else {
        console.log(chalk.gray(`  GitHub project: Skipped (no projectId in config)`));
    }

    // 6. AI Provider
    spinner.start(`Checking AI provider (${config.ai.provider})...`);
    try {
        const res = await callAI('Respond with: ok', config.ai);
        if (!res.toLowerCase().includes('ok')) throw new Error('AI returned unexpected response');
        spinner.succeed(`AI provider:    ${chalk.green('✓ Responsive')} (${config.ai.provider} / ${config.ai.model})`);
    } catch (err: any) {
        spinner.fail(`AI provider:    ${chalk.red('✗ Connection failed')}`);
        console.log(chalk.yellow(`    → Check AI endpoint, model, and API key.`));
    }

    console.log(chalk.cyan('\nChecks complete.\n'));
}
