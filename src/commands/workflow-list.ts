import chalk from 'chalk'
import { listWorkflows } from '../workflow.js'

/**
 * workflow list command implementation.
 */
export async function runWorkflowList(): Promise<void> {
  const workflows = listWorkflows()

  if (workflows.length === 0) {
    console.log(chalk.yellow('\nNo learned workflows found.'))
    return
  }

  console.log(chalk.bold('\nLearned Workflows\n'))

  for (const wf of workflows) {
    console.log(`${chalk.bold(wf.id)}${wf.name ? `  ${chalk.gray(`(${wf.name})`)}` : ''}`)
    console.log(`  Repos:   ${wf.repos.join(', ')}`)
    console.log(`  Source:  ${wf.source}`)
    console.log(`  Updated: ${wf.updatedAt}`)
    console.log('')
  }
}
