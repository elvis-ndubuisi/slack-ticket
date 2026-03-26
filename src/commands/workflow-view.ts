import chalk from 'chalk'
import { findWorkflowsByIdOrRepo } from '../workflow.js'

/**
 * workflow view command implementation.
 */
export async function runWorkflowView(idOrRepo: string): Promise<void> {
  const matches = findWorkflowsByIdOrRepo(idOrRepo)

  if (matches.length === 0) {
    console.log(chalk.yellow('\nNo matching workflow found.'))
    console.log(`  Hint: Use ${chalk.cyan('slack-ticket workflow list')} to see IDs.`)
    return
  }

  for (const wf of matches) {
    console.log(chalk.gray('\n' + '─'.repeat(60)))
    console.log(chalk.bold(`  WORKFLOW: ${wf.id}`))
    console.log(chalk.gray('─'.repeat(60)))
    if (wf.name) console.log(`  ${chalk.bold('Name:')}      ${wf.name}`)
    console.log(`  ${chalk.bold('Repos:')}     ${wf.repos.join(', ')}`)
    console.log(`  ${chalk.bold('Source:')}    ${wf.source}`)
    console.log(`  ${chalk.bold('Created:')}   ${wf.createdAt}`)
    console.log(`  ${chalk.bold('Updated:')}   ${wf.updatedAt}`)
    if (wf.defaultProject)
      console.log(`  ${chalk.bold('Project:')}   ${wf.defaultProject}`)

    if (wf.projectRouting?.length) {
      console.log(`\n  ${chalk.bold('Project Routing:')}`)
      for (const rule of wf.projectRouting) {
        console.log(`  - /${rule.pattern}/ -> ${rule.projectId}`)
      }
    }

    if (wf.defaults) {
      console.log(`\n  ${chalk.bold('Defaults:')}`)
      console.log(`  - severity: ${wf.defaults.severity ?? '(unchanged)'}`)
      console.log(`  - component: ${wf.defaults.component ?? '(unchanged)'}`)
      console.log(`  - threadDepth: ${wf.defaults.threadDepth ?? '(unchanged)'}`)
      console.log(`  - imageHandling: ${wf.defaults.imageHandling ?? '(unchanged)'}`)
    }

    if (wf.labels) {
      console.log(`\n  ${chalk.bold('Labels:')}`)
      const keywords = Object.entries(wf.labels.keywords ?? {})
      const severity = Object.entries(wf.labels.severity ?? {})
      const components = Object.entries(wf.labels.components ?? {})

      if (keywords.length) {
        console.log(`  - keywords:`)
        for (const [k, v] of keywords) {
          console.log(`    "${k}" -> [${(v ?? []).join(', ')}]`)
        }
      }
      if (severity.length) {
        console.log(`  - severity:`)
        for (const [k, v] of severity) {
          console.log(`    ${k} -> [${(v ?? []).join(', ')}]`)
        }
      }
      if (components.length) {
        console.log(`  - components:`)
        for (const [k, v] of components) {
          console.log(`    ${k} -> [${(v ?? []).join(', ')}]`)
        }
      }
    }

    if (wf.instructions) {
      console.log(`\n  ${chalk.bold('Instructions:')}`)
      console.log(
        wf.instructions
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n')
      )
    }

    if (wf.prompt?.create || wf.prompt?.update) {
      console.log(`\n  ${chalk.bold('Prompt Overrides:')}`)
      if (wf.prompt.create) {
        console.log(`  - create:\n${indentBlock(wf.prompt.create, 4)}`)
      }
      if (wf.prompt.update) {
        console.log(`  - update:\n${indentBlock(wf.prompt.update, 4)}`)
      }
    }
  }
}

function indentBlock(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((l) => `${pad}${l}`)
    .join('\n')
}
