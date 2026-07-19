// Provider-facing presentation of Baton's verifier contract.
//
// Verification can be either a legacy shell command or a closed executable/argv
// tuple. Do not collapse the latter into a shell string: doing so changes both
// its meaning and its trust boundary, and omitting argv tells workers to run a
// different check from the one the referee will enforce.

export function renderVerificationExecution(verification = {}) {
  if (typeof verification.command !== 'string' || verification.command.length === 0) return '';

  const cwd = typeof verification.cwd === 'string' && verification.cwd.length > 0
    ? verification.cwd
    : '.';
  const expectExit = Number.isSafeInteger(verification.expectExit)
    ? verification.expectExit
    : 0;

  if (Array.isArray(verification.arguments)) {
    return [
      'Execution mode: direct executable and argv (no shell)',
      `Executable (JSON string): ${JSON.stringify(verification.command)}`,
      `Arguments (JSON array, in order): ${JSON.stringify(verification.arguments)}`,
      `Working directory (relative to the assigned worktree): ${JSON.stringify(cwd)}`,
      `Expected exit code: ${expectExit}`,
    ].join('\n');
  }

  return [
    'Execution mode: legacy shell command',
    `Command: ${verification.command}`,
    `Working directory (relative to the assigned worktree): ${JSON.stringify(cwd)}`,
    `Expected exit code: ${expectExit}`,
  ].join('\n');
}
