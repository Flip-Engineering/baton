#!/usr/bin/env node

import { serveResidentMcp } from '../src/resident-mcp-entry.mjs';
import { BatonControlError } from '../src/holistic-runtime.mjs';
import { normalizeControlSurfaceError } from '../src/control-surface-unification.mjs';

/** The typed refusal an argument meets: the bridge discovers its own connection, so a descriptor
 * (or any other argument) is never reinterpreted here — the message names the headless entry that
 * does take one. */
function refusalForArgument(argument) {
  return new BatonControlError(
    'cli_invalid',
    `baton-mcp-web takes no arguments (got ${JSON.stringify(argument)}): the resident bridge `
    + 'discovers the published connection itself and derives the principal from it. For a host '
    + 'without a resident, the descriptor-launched headless entry is: '
    + 'node impl/scripts/mcp-stdio.mjs <descriptor.json>',
    { field: 'arguments', action: 're-run with no arguments, or use mcp-stdio.mjs' },
  );
}

// Issue #314 lane 4 (docs/49 §4): the two entries have one story each. `baton-mcp-web` is the
// RESIDENT bridge — it discovers the published connection exactly as the CLI does, so it takes no
// arguments and no descriptor: the principal IS the connection's session identity. The descriptor
// is the headless mode's document, read by `mcp-stdio.mjs` alone. An argument here is refused
// typed (never silently reinterpreted as a descriptor), naming the headless entry.
const args = process.argv.slice(2);
if (args.length > 0) {
  const envelope = normalizeControlSurfaceError(refusalForArgument(args[0]));
  process.stderr.write('usage: baton-mcp-web\n');
  process.stderr.write(`baton-mcp-web startup failed: ${envelope.error.code}: ${envelope.error.message}\n`);
  process.exitCode = 2;
} else {
  await serveResidentMcp();
}
