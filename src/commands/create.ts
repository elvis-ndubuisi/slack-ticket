import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { readConfig, Config } from '../config.js';
import { parseSlackUrl, fetchThread, combineMessageText } from '../slack.js';
import { generateIssueFromThread } from '../ai.js';
import {
  resolveLabels,
  filterExistingLabels,
  assembleIssueBody,
  createIssue,
  postImageComment,
  addToProject,
} from '../github.js';

/**
 * create command implementation (PRD §8.2).
 */
export async function runCreate(slackUrl: string, options: Record<string, any>): Promise<void> {
  const config = readConfig();
  const spinner = ora();

  // 1. Validate Slack URL
  const parsedUrl = parseSlackUrl(slackUrl);

  // 2-4. Fetch thread, extract text, and collect images
  spinner.start('Fetching Slack thread...');
  const depth = options.depth ? parseInt(options.depth, 10) : config.defaults.threadDepth;
  const thread = await fetchThread(
    parsedUrl,
    depth,
    config.slack.botToken,
    !options.noImage && config.defaults.imageHandling
  );
  spinner.succeed(`Fetched ${thread.messages.length} messages from Slack.`);

  const combinedText = combineMessageText(thread.messages);

  // 5. Resolve labels
  spinner.start('Resolving labels...');
  const severity = options.severity || config.defaults.severity;
  const component = options.component || config.defaults.component;
  const extraLabels = options.labels ? options.labels.split(',').map((l: string) => l.trim()) : [];

  let labels = resolveLabels({
    rawSlackText: combinedText,
    severity,
    component,
    extraLabels,
    labelsConfig: config.labels,
  });

  const [owner, repo] = resolveRepo(options.repo, config);
  labels = await filterExistingLabels(labels, owner, repo, config.github.token);
  spinner.succeed(`Resolved ${labels.length} labels.`);

  // 6-7. AI generation and validation
  spinner.start('Generating issue content with AI...');
  const aiOutput = await generateIssueFromThread(combinedText, config.ai);
  spinner.succeed('AI content generated.');

  // 8. Assemble final body (issue_type-aware; screenshot reference handled via has_screenshot in AI output)
  const finalBody = assembleIssueBody(aiOutput, severity, component, slackUrl);

  // 9. Display preview
  printPreview({
    title: aiOutput.title,
    owner,
    repo,
    severity,
    component,
    labels,
    projectId: options.project || config.github.defaultProject,
    body: finalBody,
    imageInfo: thread.imageInfo,
  });

  // 10. Confirmation
  if (!options.yes && !options.dryRun) {
    const ok = await confirm({
      message: 'Create this issue?',
      default: true,
    });
    if (!ok) {
      console.log(chalk.yellow('\nAborted.'));
      return;
    }
  }

  // 11. Dry-run?
  if (options.dryRun) {
    console.log(chalk.cyan('\n[Dry run complete] No issue created.'));
    return;
  }

  // 12. Create issue
  spinner.start('Creating GitHub issue...');
  const issue = await createIssue(
    owner,
    repo,
    aiOutput.title,
    finalBody,
    labels,
    config.github.token
  );
  spinner.succeed(`Issue created: ${chalk.green(issue.url)}`);

  // 13. Post image comment
  if (thread.imageInfo.downloaded) {
    spinner.start('Attaching image...');
    await postImageComment(
      owner,
      repo,
      issue.number,
      thread.imageInfo.downloaded.filePath,
      thread.imageInfo.downloaded.filename,
      config.github.token
    );
    spinner.succeed('Image attached.');
  }

  // 14. Add to Project
  const projectId = options.project || config.github.defaultProject;
  if (projectId && !options.noProject) {
    spinner.start('Adding to GitHub Project...');
    await addToProject(projectId, issue.nodeId, config.github.token);
    spinner.succeed('Added to project.');
  }

  // 15. Final URL
  console.log(`\n${chalk.bold('Success!')} Issue URL: ${chalk.cyan(issue.url)}`);
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
 * Prints the issue preview block (PRD §8.2.1).
 */
function printPreview(p: {
  title: string;
  owner: string;
  repo: string;
  severity: string;
  component: string | null;
  labels: string[];
  projectId?: string;
  body: string;
  imageInfo: { totalCount: number; downloaded: any };
}) {
  console.log(chalk.gray('\n' + '─'.repeat(60)));
  console.log(chalk.bold('  ISSUE PREVIEW'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(`  ${chalk.bold('Title:')}      ${p.title}`);
  console.log(`  ${chalk.bold('Repo:')}       ${p.owner}/${p.repo}`);
  console.log(`  ${chalk.bold('Severity:')}   ${p.severity}`);
  console.log(`  ${chalk.bold('Component:')}  ${p.component || chalk.gray('(none)')}`);
  console.log(`  ${chalk.bold('Labels:')}     ${p.labels.join(', ') || chalk.gray('(none)')}`);
  console.log(`  ${chalk.bold('Project:')}    ${p.projectId || chalk.gray('(none)')}`);

  console.log('\n  ' + chalk.bold('Body:'));
  console.log(chalk.gray('  ' + '┄'.repeat(50)));
  console.log(
    p.body
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n')
  );
  console.log(chalk.gray('  ' + '┄'.repeat(50)));

  if (p.imageInfo.totalCount > 1) {
    console.log(
      chalk.yellow(`  ⚠  ${p.imageInfo.totalCount} images found. Only the first will be attached.`)
    );
  } else if (p.imageInfo.totalCount === 1 && !p.imageInfo.downloaded) {
    console.log(chalk.red(`  ⚠  1 image found but download failed.`));
  }
  console.log(chalk.gray('─'.repeat(60)) + '\n');
}
