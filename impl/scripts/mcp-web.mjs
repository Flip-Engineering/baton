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
// The startup window's default bounds the retry to well under a host's own MCP startup
// timeout (the descriptor entries declare 30s), and past the seconds a resident restart
// actually takes to republish.
const STARTUP_RETRY_WINDOW_MS_DEFAULT = 20_000;
const STARTUP_RETRY_BACKOFF_MS = 250;

/** Open the resident bridge, retrying the publication gap. The retryable family is the one the
 * resident's own restart produces: the application not ready yet (`application_unavailable`) and
 * the user connection profile not discoverable or not yet matching (`user_profile_*` causes).
 * Every other refusal — a bad invocation, a checkout with no repository metadata, registry
 * drift a `git pull` produced — fails the startup on its first sight. */
async function openResidentBridge(stateRoot) {
  const declared = Number.parseInt(process.env.BATON_MCP_WEB_STARTUP_WINDOW_MS ?? '', 10);
  const windowMs = Number.isSafeInteger(declared) && declared >= 0
    ? declared : STARTUP_RETRY_WINDOW_MS_DEFAULT;
  const deadline = Date.now() + windowMs;
  // The refusals that mean "no live resident connection yet": the user profile not published or
  // not yet matching (`user_profile_*`), the application not ready yet, and the resident's own
  // socket still unbound mid-restart (`cli_transport_failed`).
  const transient = (error) => error?.code === 'application_unavailable'
    || error?.code === 'cli_transport_failed'
    || (error?.code === 'cli_config_invalid' && typeof error?.cause === 'string'
      && error.cause.startsWith('user_profile_'));
  for (;;) {
    try {
      const coordination = new CoordinationStore(join(stateRoot, 'coordination'));
      // Issue #343: the bridge frame IS the declared wire.frame substrate row — the same ceiling
      // the resident narrows swarm.view answers against (web-northbound.mjs), so a narrowed
      // answer fits instead of tripping the oversize refusal. No number is re-declared here.
      return await createBatonWebMcpServer({
        coordination, cwd: process.cwd(), maxMessageBytes: FRAME_LIMITS['wire.frame'].value,
        // Issue #529 (docs/54 §4): the session's wake auto-subscription is derived from the
        // environment the deployment published this seat's bridge under — a seat's session
        // receives its own swarm's events, a session without seat coordinates receives every
        // event the deployment produces. It arrives as notifications/baton/wake with no tool call.
        autoWake: wakeAutoSubscription(process.env),
      });
    } catch (error) {
      if (!transient(error) || Date.now() >= deadline) throw error;
      process.stderr.write(`baton-mcp-web: the resident connection is not open yet (${error.cause ?? error.code}); retrying within the startup window\n`);
      await new Promise((resolveRetry) => setTimeout(resolveRetry, STARTUP_RETRY_BACKOFF_MS));
    }
  }
}
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
    // A host session that launches this bridge while the resident is mid-restart — the gap
    // between one `baton serve` dying and the next binding its socket and republishing the
    // connection — met the one-shot discovery refusal and EXITED, and the host then kept the
    // MCP surface closed for its whole session long after the resident returned (the root's
    // Claude Code session on 2026-09-25: CONNECTION_CLOSED at session start, Baton driven
    // through the CLI for the day). The startup open therefore waits a bounded window for the
    // publication: the refusals that mean "no live resident connection yet" — the not-yet-ready
    // application and the undiscovered or not-yet-matching user profile — are retried with
    // backoff. Any other refusal, and a window that lapses, fail the startup exactly as before.
    // BATON_MCP_WEB_STARTUP_WINDOW_MS (integer milliseconds, 0 restores the one-shot open)
    // bounds the window.
    const rawServer = await openResidentBridge(stateRoot);
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
