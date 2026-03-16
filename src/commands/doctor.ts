import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../config.js';
import { slackGet } from '../slack.js';
import { githubRequest, githubGraphQL } from '../github.js';
import { callAI } from '../ai.js';

/**
 * doctor command implementation (PRD §8.4).
 * Runs a sequence of 6 checks to validate configuration and connectivity.
 */
export async function runDoctor(): Promise<void> {
  console.log(chalk.cyan('\nStarting diagnostics...\n'));

  const config = readConfig();
  let allPassed = true;

  // 1. Slack Token
  const s1 = ora('1. Validating Slack bot token...').start();
  try {
    const res = await slackGet('auth.test', {}, config.slack.botToken);
    if (!res.ok) throw new Error(res.error || 'Unknown Slack error');
    s1.succeed(`1. Validating Slack bot token: ${chalk.green('✓ Pass')}`);
  } catch (err: any) {
    s1.fail(`1. Validating Slack bot token: ${chalk.red('✗ Fail')}`);
    console.log(
      chalk.yellow(`   ↳ Fix: Run 'slack-ticket setup' to re-enter a valid xoxb- token.`)
    );
    allPassed = false;
  }

  // 2. Slack Channel Access
  const s2 = ora('2. Checking Slack channel access...').start();
  try {
    // We do a list call to verify 'channels:read' scope as a proxy for basic access
    const res = await slackGet(
      'conversations.list',
      { limit: 1, types: 'public_channel' },
      config.slack.botToken
    );
    if (!res.ok) throw new Error(res.error || 'Unknown Slack error');
    s2.succeed(`2. Checking Slack channel access: ${chalk.green('✓ Pass')}`);
  } catch (err: any) {
    s2.fail(`2. Checking Slack channel access: ${chalk.red('✗ Fail')}`);
    console.log(
      chalk.yellow(
        `   ↳ Fix: Ensure your Slack app has 'channels:read', 'channels:history', 'chat:write' scopes.`
      )
    );
    allPassed = false;
  }

  // 3. GitHub Token
  const s3 = ora('3. Validating GitHub token...').start();
  try {
    const { status, data } = await githubRequest('GET', '/user', config.github.token);
    if (status !== 200) throw new Error((data as any)?.message || `HTTP ${status}`);
    s3.succeed(`3. Validating GitHub token: ${chalk.green('✓ Pass')}`);
  } catch (err: any) {
    s3.fail(`3. Validating GitHub token: ${chalk.red('✗ Fail')}`);
    console.log(chalk.yellow(`   ↳ Fix: Run 'slack-ticket setup' to re-enter a valid GitHub PAT.`));
    allPassed = false;
  }

  // 4. GitHub Repo Access
  const s4 = ora('4. Checking GitHub repo access...').start();
  try {
    const { status, data } = await githubRequest(
      'GET',
      `/repos/${config.github.owner}/${config.github.defaultRepo}`,
      config.github.token
    );
    if (status !== 200) throw new Error((data as any)?.message || `HTTP ${status}`);
    s4.succeed(`4. Checking GitHub repo access: ${chalk.green('✓ Pass')}`);
  } catch (err: any) {
    s4.fail(`4. Checking GitHub repo access: ${chalk.red('✗ Fail')}`);
    console.log(
      chalk.yellow(
        `   ↳ Fix: Token needs 'repo' scope, or verify '${config.github.owner}/${config.github.defaultRepo}' exists.`
      )
    );
    allPassed = false;
  }

  // 5. GitHub Project Access
  const s5 = ora('5. Checking GitHub Project v2 access...').start();
  if (!config.github.defaultProject) {
    s5.info(chalk.gray(`5. Checking GitHub Project v2 access: Skipped (Not configured)`));
  } else {
    try {
      const query = `query($id: ID!) { node(id: $id) { id } }`;
      const res = (await githubGraphQL(
        query,
        { id: config.github.defaultProject },
        config.github.token
      )) as any;
      if (res.errors || !res.data?.node) throw new Error('Project not found');
      s5.succeed(`5. Checking GitHub Project v2 access: ${chalk.green('✓ Pass')}`);
    } catch (err: any) {
      s5.fail(`5. Checking GitHub Project v2 access: ${chalk.red('✗ Fail')}`);
      console.log(
        chalk.yellow(
          `   ↳ Fix: Token needs 'project' scope, or verify project ID '${config.github.defaultProject}' is correct.`
        )
      );
      allPassed = false;
    }
  }

  // 6. AI Provider
  const s6 = ora(`6. Pinging AI provider (${config.ai.provider})...`).start();
  try {
    // Simple ping request to trigger a response and validate auth + network
    const res = await callAI('Respond with the exact word: "ok"', config.ai);
    if (!res.toLowerCase().includes('ok'))
      throw new Error('AI returned unexpected response format');
    s6.succeed(`6. Pinging AI provider: ${chalk.green('✓ Pass')}`);
  } catch (err: any) {
    s6.fail(`6. Pinging AI provider: ${chalk.red('✗ Fail')}`);
    console.log(
      chalk.yellow(`   ↳ Fix: Verify your AI API key and base URL in 'slack-ticket setup'.`)
    );
    allPassed = false;
  }

  console.log(chalk.gray('\n' + '─'.repeat(40)));

  if (allPassed) {
    console.log(chalk.green.bold('All systems operational! You are ready to create tickets.'));
  } else {
    console.log(chalk.red.bold('Some checks failed. Please fix the issues above and try again.'));
    process.exit(1);
  }
}
