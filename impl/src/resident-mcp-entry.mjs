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
    // A host session that launches this bridge while the resident is mid-restart — the gap
    // between one `baton serve` dying and the next binding its socket and republishing the
    // connection — met the one-shot discovery refusal and EXITED, and the host then kept the
    // MCP surface closed for its whole session long after the resident returned (the root's
    // Claude Code session on 2026-09-25: CONNECTION_CLOSED at session start, Baton driven
    // through the CLI for the day). The startup open waits a bounded window for the
    // publication: the refusals that mean "no live resident connection yet" are retried with
    // backoff; any other refusal, and a window that lapses, fail the startup exactly as
    // before. BATON_MCP_WEB_STARTUP_WINDOW_MS (integer milliseconds, 0 restores the one-shot
    // open) bounds the window.
    const rawServer = await openWithStartupRetry(stateRoot, claudeRoot);
    const server = wrapProductionMcpServer(rawServer, { expandNative: true });
    const stopInput = () => { if (!process.stdin.destroyed) process.stdin.destroy(); };
    if (claudeRoot) attachClaudeRootChannel(server, {
      open: (onAttention) => rawServer.application.client.openRootAttention(onAttention),
      onClose: (error) => {
        process.stderr.write(`Baton root attachment closed${error ? `: ${error.code ?? error.message}` : ''}; reconnect the native MCP channel.\n`);
        stopInput();
      },
    });
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

const STARTUP_RETRY_WINDOW_MS_DEFAULT = 20_000;
const STARTUP_RETRY_BACKOFF_MS = 250;

/** Open the resident bridge, retrying the publication gap. The retryable family is the one the
 * resident's own restart produces: the application not ready yet (`application_unavailable`),
 * the socket still unbound mid-restart (`cli_transport_failed`), and the user connection
 * profile not published or not yet matching (`user_profile_*` causes). Every other refusal
 * fails the startup on its first sight. */
async function openWithStartupRetry(stateRoot, claudeRoot) {
  const declared = Number.parseInt(process.env.BATON_MCP_WEB_STARTUP_WINDOW_MS ?? '', 10);
  const windowMs = Number.isSafeInteger(declared) && declared >= 0
    ? declared : STARTUP_RETRY_WINDOW_MS_DEFAULT;
  const deadline = Date.now() + windowMs;
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
        // environment the deployment published this seat's bridge under. The Claude root
        // channel carries no seat coordinates and takes no swarm wake subscription.
        autoWake: claudeRoot ? null : wakeAutoSubscription(process.env),
      });
    } catch (error) {
      if (!transient(error) || Date.now() >= deadline) throw error;
      process.stderr.write(`baton-mcp-web: the resident connection is not open yet (${error.cause ?? error.code}); retrying within the startup window\n`);
      await new Promise((resolveRetry) => setTimeout(resolveRetry, STARTUP_RETRY_BACKOFF_MS));
    }
  }
}
