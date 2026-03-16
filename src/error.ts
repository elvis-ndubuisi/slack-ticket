/**
 * Custom error class for CLI operations.
 * Allows passing an explicit exit code that maps to the PRD definitions:
 * 1 = General / unclassified
 * 2 = Slack API error
 * 3 = AI error
 * 4 = AI validation failure
 * 5 = GitHub error
 * 6 = Config error
 */
export class CLIError extends Error {
  public exitCode: number

  constructor(message: string, exitCode: number = 1) {
    super(message)
    this.name = 'CLIError'
    this.exitCode = exitCode
  }
}
