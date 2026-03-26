import chalk from 'chalk'
import ora from 'ora'
import { readConfig } from '../config.js'
import {
  fetchWorkflowSource,
  parseWorkflowMarkdown,
  createWorkflowId,
  upsertWorkflow,
  validateWorkflow,
} from '../workflow.js'

/**
 * learn command implementation.
 */
export async function runLearn(sourceInput: string): Promise<void> {
  const config = readConfig()
  const spinner = ora()

  spinner.start('Loading workflow source...')
  const { source, body } = await fetchWorkflowSource(sourceInput)
  spinner.succeed('Workflow source loaded.')

  spinner.start('Parsing workflow...')
  const parsed = parseWorkflowMarkdown(body, config)
  spinner.succeed('Workflow parsed.')

  const now = new Date().toISOString()
  const workflow = {
    id: createWorkflowId(source),
    source,
    createdAt: now,
    updatedAt: now,
    ...parsed,
  }

  spinner.start('Validating workflow (best-effort)...')
  const warnings = await validateWorkflow(workflow, config)
  spinner.succeed('Workflow validation complete.')

  upsertWorkflow(workflow)

  console.log(chalk.green('\n✓ Workflow learned successfully.'))
  console.log(`  Source: ${chalk.cyan(source)}`)
  console.log(`  Repos:  ${workflow.repos.join(', ')}`)

  if (warnings.length > 0) {
    console.log(chalk.yellow('\nWarnings:'))
    for (const w of warnings) {
      console.log(chalk.yellow(`- ${w}`))
    }
  }
}
