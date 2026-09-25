#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CoordinationStore, createBatonWebMcpServer, serveMcpStdio, wakeAutoSubscription,
} from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { BatonControlError } from '../src/holistic-runtime.mjs';
import { assertCliMcpControlParity, normalizeControlSurfaceError } from '../src/control-surface-unification.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';
import { assertUnifiedCapabilityCoverage } from '../src/surface-capability-catalog.mjs';
import { assertSurfaceCapabilityNameClosure } from '../src/surface-capability-resolution.mjs';

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
  const stateRoot = mkdtempSync(join(tmpdir(), 'baton-kimi-orchestrator-mcp-'));
  try {
    assertCliMcpControlParity();
    assertUnifiedCapabilityCoverage();
    assertSurfaceCapabilityNameClosure();
    const rawServer = await (async () => {
      const coordination = new CoordinationStore(join(stateRoot, 'coordination'));
      // Issue #343: the bridge frame IS the declared wire.frame substrate row — the same ceiling
      // the resident narrows swarm.view answers against (web-northbound.mjs), so a narrowed
      // answer fits instead of tripping the oversize refusal. No number is re-declared here.
      return createBatonWebMcpServer({
        coordination, cwd: process.cwd(), maxMessageBytes: FRAME_LIMITS['wire.frame'].value,
        // Issue #529 (docs/54 §4): the session's wake auto-subscription is derived from the
        // environment the deployment published this seat's bridge under — a seat's session
        // receives its own swarm's events, a session without seat coordinates receives every
        // event the deployment produces. It arrives as notifications/baton/wake with no tool call.
        autoWake: wakeAutoSubscription(process.env),
      });
    })();
    const server = wrapProductionMcpServer(rawServer, { expandNative: true });
    const stopInput = () => { if (!process.stdin.destroyed) process.stdin.destroy(); };
    process.on('SIGINT', stopInput);
    process.on('SIGTERM', stopInput);
    try {
      await serveMcpStdio(server);
    } finally {
      process.off('SIGINT', stopInput);
      process.off('SIGTERM', stopInput);
    }
  } catch (error) {
    const envelope = normalizeControlSurfaceError(error);
    process.stderr.write(`baton-mcp-web startup failed: ${envelope.error.code}: ${envelope.error.message}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}
