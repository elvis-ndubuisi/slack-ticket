import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { readConfig, Config } from '../config.js';
import { parseSlackUrl, fetchSingleMessage } from '../slack.js';
import { generateIssueUpdate } from '../ai.js';
import { fetchIssueBody, appendToIssueBody, postIssueComment } from '../github.js';

/**
 * update command implementation (PRD §8.3).
 */
export async function runUpdate(
  issueNumber: number,
  slackUrls: string[],
  options: Record<string, any>
): Promise<void> {
  const config = readConfig();
  const spinner = ora();

  if (isNaN(issueNumber) || issueNumber <= 0) {
    console.error(chalk.red('Error: Invalid issue number.'));
    process.exit(1);
  }

  // 1. Resolve repo
  const [owner, repo] = resolveRepo(options.repo, config);

  // 2. Fetch existing issue body
  spinner.start(`Fetching issue #${issueNumber} from GitHub...`);
  const existingBody = await fetchIssueBody(owner, repo, issueNumber, config.github.token);
  spinner.succeed(`Fetched existing issue body.`);

  // 3. Fetch Slack messages
  spinner.start(`Fetching ${slackUrls.length} Slack message(s)...`);
  const slackTexts: string[] = [];
  for (const url of slackUrls) {
    const parsed = parseSlackUrl(url);
    const msg = await fetchSingleMessage(parsed, config.slack.botToken);
    if (msg.text) slackTexts.push(msg.text);
  }
  spinner.succeed(`Fetched ${slackTexts.length} Slack messages.`);

  if (slackTexts.length === 0) {
    console.log(chalk.yellow('No text found in provided Slack messages. Aborting update.'));
    return;
  }

  const combinedNewText = slackTexts.join('\n\n');

  // 4. Generate AI update
  spinner.start('Generating update content with AI...');
  const aiOutput = await generateIssueUpdate(existingBody, combinedNewText, config.ai);
  spinner.succeed('Update content generated.');

  if (!aiOutput.update_summary && !aiOutput.new_information) {
    console.log(chalk.yellow('AI determined there is no new actionable information to add.'));
    return;
  }

  // Assemble update content
  const updateContent = [
    aiOutput.update_summary ? `**Update:** ${aiOutput.update_summary}` : '',
    aiOutput.new_information ? `\n${aiOutput.new_information}` : '',
    `\n---\n*Sources:*`,
    ...slackUrls.map((url) => `- ${url}`),
  ]
    .filter(Boolean)
    .join('\n');

  // 5. Preview
  printUpdatePreview({
    issueNumber,
    owner,
    repo,
    summary: aiOutput.update_summary ?? '(none)',
    content: updateContent,
    isComment: !!options.comment,
  });

  // 6. Confirmation
  if (!options.yes && !options.dryRun) {
    const ok = await confirm({
      message: 'Apply this update?',
      default: true,
    });
    if (!ok) {
      console.log(chalk.yellow('\nAborted.'));
      return;
    }
  }

  // Dry-run
  if (options.dryRun) {
    console.log(chalk.cyan('\n[Dry run complete] No issue updated.'));
    return;
  }

  // 7. Apply update
  let finalUrl: string;
  if (options.comment) {
    spinner.start('Posting update as comment...');
    finalUrl = await postIssueComment(owner, repo, issueNumber, updateContent, config.github.token);
    spinner.succeed('Comment posted.');
  } else {
    spinner.start('Appending to issue body...');
    finalUrl = await appendToIssueBody(
      owner,
      repo,
      issueNumber,
      updateContent,
      existingBody,
      config.github.token
    );
    spinner.succeed('Issue body updated.');
  }

  // 8. Print URL
  console.log(`\n${chalk.bold('Success!')} Issue URL: ${chalk.cyan(finalUrl)}`);
}

/**
 * Resolves [owner, repo] from the --repo flag or config defaults.
 */
function resolveRepo(repoFlag: string | undefined, config: Config): [string, string] {
  if (!repoFlag) return [config.github.owner, config.github.defaultRepo];
  if (repoFlag.includes('/')) {
    const [owner, repo] = repoFlag.split('/');
    return [owner, repo];
  }
  return [config.github.owner, repoFlag];
}

/**
 * Prints the update preview block.
 */
function printUpdatePreview(p: {
  issueNumber: number;
  owner: string;
  repo: string;
  summary: string;
  content: string;
  isComment: boolean;
}) {
  console.log(chalk.gray('\n' + '─'.repeat(60)));
  console.log(chalk.bold('  UPDATE PREVIEW'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(`  ${chalk.bold('Target:')}     ${p.owner}/${p.repo}#${p.issueNumber}`);
  console.log(`  ${chalk.bold('Mode:')}       ${p.isComment ? 'New Comment' : 'Append to Body'}`);
  console.log(`  ${chalk.bold('Summary:')}    ${p.summary}`);

  console.log('\n  ' + chalk.bold('Content:'));
  console.log(chalk.gray('  ' + '┄'.repeat(50)));
  console.log(
    p.content
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n')
  );
  console.log(chalk.gray('  ' + '┄'.repeat(50)));
  console.log(chalk.gray('─'.repeat(60)) + '\n');
}
