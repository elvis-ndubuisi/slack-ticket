import chalk from 'chalk'
import { confirm } from '@inquirer/prompts'
import { deleteWorkflows, getWorkflowPath } from '../workflow.js'

/**
 * unlearn command implementation.
 */
export async function runUnlearn(options: { yes?: boolean } = {}): Promise<void> {
  if (!options.yes) {
    const ok = await confirm({
      message: 'This will remove all learned workflows and reset to defaults. Continue?',
      default: false,
    })
    if (!ok) {
      console.log(chalk.yellow('\nAborted.'))
      return
    }
  }

  const removed = deleteWorkflows()
  if (removed) {
    console.log(chalk.green('\n✓ Learned workflows removed.'))
  } else {
    console.log(chalk.yellow('\nNo learned workflows found.'))
  }
  console.log(`  Path: ${chalk.cyan(getWorkflowPath())}`)
}
