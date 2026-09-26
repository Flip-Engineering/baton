import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from './coordination-store.mjs';
import { createBatonWebMcpServer, wakeAutoSubscription } from './mcp-web-bridge.mjs';
import { serveMcpStdio } from './mcp-northbound.mjs';
import { FRAME_LIMITS } from './limits.mjs';
import { assertCliMcpControlParity, normalizeControlSurfaceError } from './control-surface-unification.mjs';
import { wrapProductionMcpServer } from './production-mcp-complete.mjs';
import { assertUnifiedCapabilityCoverage } from './surface-capability-catalog.mjs';
import { assertSurfaceCapabilityNameClosure } from './surface-capability-resolution.mjs';
import { attachClaudeRootChannel } from './claude-root-channel.mjs';

export async function serveResidentMcp({ claudeRoot = false } = {}) {
  const stateRoot = mkdtempSync(join(tmpdir(), 'baton-resident-mcp-'));
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
        autoWake: claudeRoot ? null : wakeAutoSubscription(process.env),
      });
    })();
    const stopInput = () => { if (!process.stdin.destroyed) process.stdin.destroy(); };
    // Issue #592, OBSERVED 2026-09-26 on the real entry process: `attachClaudeRootChannel`
    // replaces `server.handle`. Attached to the WRAPPED server, that assignment lands on the
    // convergence proxy's target while the convergence wrapper keeps dispatching through the same
    // target property — so `initialize` re-enters the channel wrapper, and the entry dies with
    // `RangeError: Maximum call stack size exceeded` before it can greet the native client. No
    // root session could ever attach. The channel is attached to the raw server it dispatches
    // through, which keeps the convergence wrapper the outermost facade: it still augments the
    // greeting the channel composed, and it still forwards the tools the session is served.
    if (claudeRoot) attachClaudeRootChannel(rawServer, {
      open: (onAttention) => rawServer.application.client.openRootAttention(onAttention),
      onClose: (error) => {
        process.stderr.write(`Baton root attachment closed${error ? `: ${error.code ?? error.message}` : ''}; reconnect the native MCP channel.\n`);
        stopInput();
      },
    });
    const server = wrapProductionMcpServer(rawServer, { expandNative: true });
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
