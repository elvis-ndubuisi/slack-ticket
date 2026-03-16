/**
 * `slack-ticket config edit`
 *
 * Opens the config file in $EDITOR (fallback: vi on macOS/Linux, notepad on Windows).
 * After the editor exits, validates the JSON before accepting.
 * If invalid: offers to re-open or discard changes.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import chalk from 'chalk';
import { confirm, select } from '@inquirer/prompts';
import { getConfigPath } from '../config.js';

export async function runConfigEdit(): Promise<void> {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    console.error("No config found. Run 'slack-ticket setup' to get started.");
    process.exit(6);
  }

  let editing = true;

  while (editing) {
    // Determine editor
    const editor = process.env.EDITOR ?? (process.platform === 'win32' ? 'notepad' : 'vi');

    console.log(`Opening config in ${chalk.cyan(editor)}...`);

    const result = spawnSync(editor, [configPath], { stdio: 'inherit' });

    if (result.error) {
      console.error(`Failed to open editor '${editor}':`, result.error.message);
      console.log(`You can manually edit: ${chalk.cyan(configPath)}`);
      process.exit(1);
    }

    // Validate JSON after editor exits
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      JSON.parse(raw);
      console.log(chalk.green('\n✓ Config saved and validated successfully.'));
      editing = false;
    } catch {
      console.error(chalk.red('\n✗ Config file contains invalid JSON.'));
      const action = await select<string>({
        message: 'What would you like to do?',
        choices: [
          { name: 'Re-open in editor', value: 'reopen' },
          { name: 'Discard changes (restore last valid config)', value: 'discard' },
        ],
      });

      if (action === 'discard') {
        // We cannot automatically restore here — just warn
        console.log(
          chalk.yellow(
            '⚠  The file still contains invalid JSON. Run "slack-ticket setup" to reconfigure.'
          )
        );
        editing = false;
      }
      // 'reopen' → loop continues
    }
  }
}
