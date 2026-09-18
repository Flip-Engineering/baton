#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { coordinationReplayFailure } from '../src/coordination-store.mjs';
import {
  BatonWebClient, batonCliHelp, discoverBatonConnection, inspectBatonConnection,
  parseBatonCli, projectBatonCliResult, runBatonCli, setupBatonConnection,
} from '../src/application-cli.mjs';
import { BATON_TOP_HELP, runBatonTop } from '../src/baton-top.mjs';
import { BatonWebHost, SignalLifecycleOwner, describeDrainWait, signalIntentLine } from '../src/application-host.mjs';
import { flipAnnounce, flipLine } from '../src/brand.mjs';
import { callConfiguredMcpTool } from '../src/configured-mcp-client.mjs';
import { assertCliMcpControlParity, normalizeControlSurfaceError } from '../src/control-surface-unification.mjs';
import { openBaton } from '../src/index.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';
import {
  formatKimiCredentialInstallResult, KIMI_CREDENTIAL_HELP, promptAndInstallKimiCredential,
} from '../src/kimi-credential-setup.mjs';
import { ProductionConvergenceRuntime, wrapProductionDeployment } from '../src/production-convergence.mjs';
import { wrapProductionCliClient } from '../src/production-cli-convergence.mjs';
import {
  UNIFIED_SURFACE_CLI_HELP,
  executeUnifiedSurfaceCli,
  parseUnifiedSurfaceCli,
} from '../src/surface-cli.mjs';
import { assertUnifiedCapabilityCoverage } from '../src/surface-capability-catalog.mjs';
import {
  assertSurfaceCapabilityNameClosure,
  resolveSurfaceCapability,
} from '../src/surface-capability-resolution.mjs';

const TTY = process.stderr.isTTY === true;
const surfaceRuntime = new ProductionConvergenceRuntime({ repoRoot: process.cwd() });

function integer(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw Object.assign(new Error('positive integer environment value required'), { code: 'cli_config_invalid' });
  return parsed;
}

function clientFor(connection) {
  const client = new BatonWebClient({
    baseUrl: connection.baseUrl,
    origin: connection.origin,
    repoId: connection.repoId,
    token: connection.token,
    // The wake attachment (client.wakes) rides the same owner-only socket the commands ride; the
    // fetch wrapper below carries it for commands, the client needs it by name for the stream.
    ...(connection.transport === 'local' ? { socketPath: connection.socketPath } : {}),
    commandTimeoutMs: integer(process.env.BATON_COMMAND_TIMEOUT_MS, 30_000),
    pollMs: integer(process.env.BATON_COMMAND_POLL_MS, 250),
    fetchImpl: connection.transport === 'local'
      ? createLocalSocketFetch({ socketPath: connection.socketPath, baseUrl: connection.baseUrl })
      : globalThis.fetch,
    clock: Date.now,
    sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  });
  return wrapProductionCliClient(client, { runtime: surfaceRuntime });
}


async function serveDeployment(rawDeployment) {
  const deployment = rawDeployment?.convergence ? rawDeployment : wrapProductionDeployment(rawDeployment, { repoRoot: process.cwd() });
  if (!deployment || typeof deployment.host !== 'function' || typeof deployment.close !== 'function') {
    throw Object.assign(new Error('serve deployment factory returned an invalid deployment'), {
      code: 'cli_config_invalid',
    });
  }
  // #276(1)/(2): the operator's line at signal receipt, then the drain's own narration (the
  // deployment's host writes its stages), then one exit line. The receipt line is written before
  // `deployment.close()` — before any drain wait — and the count comes from the deployment's own
  // `runs.list` projection of the participants this process still owns (never a wire call).
  let announced = null;
  const narration = (trigger) => {
    // Issue #351 lane 2: the durable request is the handler's FIRST act — appended synchronously
    // through the deployment's own writer path (one bounded row, deduped against the drain)
    // before the narration read a busy loop could postpone it behind.
    try {
      const requestedLine = typeof deployment.recordStopRequested === 'function'
        ? deployment.recordStopRequested(trigger.kind) : null;
      if (requestedLine) {
        process.stderr.write(`${flipAnnounce('draining', requestedLine, { tty: TTY, color: TTY })}\n`);
      }
    } catch { /* the stop narrates without the row rather than wedging the handler */ }
    const readRuns = typeof deployment.runs?.list === 'function'
      ? () => deployment.runs.list()
      : () => { throw Object.assign(new Error('this deployment publishes no run list'), { code: 'application_host_narration_unavailable' }); };
    announced = (async () => signalIntentLine(trigger, readRuns))().then(
      (line) => { process.stderr.write(`${flipAnnounce('draining', `baton serve: ${line}`, { tty: TTY, color: TTY })}\n`); },
      (error) => {
        process.stderr.write(`${flipAnnounce('draining', `baton serve: signal received; draining participants (narration failed: ${error?.code ?? error?.name ?? 'error'}) (${trigger.kind})`, { tty: TTY, color: TTY })}\n`);
      },
    );
    return announced;
  };
  const lifecycle = new SignalLifecycleOwner({
    signalEmitter: process,
    shutdown: async () => { await announced; return deployment.close(); },
    announce: narration,
  });
  // Issue #383: a resident never dies silently. An exception nobody caught (the EPIPE that took
  // two residents down on 2026-09-18 before the per-connection handler existed) is narrated with
  // its code and stack head, recorded as the stop request's trigger through the deployment's own
  // writer path, and routed through the SAME stop path a signal takes — workers reaped, leases
  // released, the ledger told — instead of Node's bare exit.
  let crashing = false;
  const lastResort = (label) => (error) => {
    if (crashing) return;
    crashing = true;
    const code = error?.code ?? error?.name ?? 'error';
    const head = String(error?.stack ?? error?.message ?? error).split('\n').slice(0, 3).join(' | ');
    process.stderr.write(`${flipAnnounce('failed', `baton serve: ${label} (${code}): ${head} — stopping through the drain`, { tty: TTY, color: TTY })}\n`);
    try { deployment.recordStopRequested?.(`${label}:${code}`); } catch { /* the stop narrates without the row */ }
    process.exitCode = 1;
    process.emit('SIGTERM');
  };
  const onUncaught = lastResort('uncaught_exception');
  const onUnhandled = lastResort('unhandled_rejection');
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUnhandled);
  let outcome;
  try {
    outcome = await lifecycle.run(async ({ signal }) => {
      const hosted = await deployment.host();
      // Issue #351 lane 2: the ONE line at the flip — the publication exists and the loop was
      // free enough to answer the self-check; the row says how long the startup took (replay
      // included) and what the ledger held, so "published" is never a guess about readiness.
      const report = typeof deployment.startupReport === 'function' ? deployment.startupReport() : null;
      const flip = report === null ? 'answering'
        : `answering (open ${report.openElapsedMs}ms; ${report.rows ?? 0} rows on the ledger; replayed ${report.replayedEvents ?? 0}; checkpoint ${report.checkpoint ?? 'unknown'})`;
      process.stderr.write(`${flipAnnounce('hosted', `baton serve: ${flip}`, { tty: TTY, color: TTY })}\n`);
      process.stderr.write(`${flipAnnounce('hosted', `baton serve: ${JSON.stringify(hosted)}`, { tty: TTY, color: TTY })}\n`);
      await new Promise((resolveSignal) => {
        if (signal.aborted) resolveSignal();
        else signal.addEventListener('abort', resolveSignal, { once: true });
      });
      return hosted;
    });
  } catch (error) {
    // #276(2): the last line before the refusal names what the host could not drain, so an exit
    // that is not 0 is never a bare failure.
    const wait = describeDrainWait(error?.detail);
    const summary = wait === null
      ? (error?.code ?? error?.name ?? 'error')
      : `${error?.code ?? error?.name ?? 'error'} — drain did not converge: ${wait}`;
    process.stderr.write(`${flipAnnounce('failed', `baton serve: exit non-zero; ${summary}`, { tty: TTY, color: TTY })}\n`);
    throw error;
  }
  process.stderr.write(`${flipAnnounce(outcome.closed?.state, `baton serve: ${JSON.stringify(outcome.closed)}`, { tty: TTY, color: TTY })}\n`);
  if (outcome.closed.state !== 'closed') process.exitCode = 1;
}

function unifiedNeedsWebClient(command) {
  if (command.mcpConfig !== null) return false;
  if (command.kind === 'surface_snapshot' || command.kind === 'surface_watch' || command.kind === 'surface_visualize') return true;
  if (command.kind !== 'surface_invoke') return false;
  const capability = resolveSurfaceCapability(command.name);
  return capability.operatorFacing === true
    && capability.hostLocal !== true
    && (capability.kind === 'application_operation'
      || capability.surfaces?.cli?.direct === true
      || capability.surfaces?.web?.reachable === true);
}

try {
  assertCliMcpControlParity();
  assertUnifiedCapabilityCoverage();
  assertSurfaceCapabilityNameClosure();
  const argv = process.argv.slice(2);
  // Both CLI parses are PURE, parse-time decisions: they run before any connection discovery, so
  // an unknown verb refuses without a transport (2026-09-14 audit, U-E8 — a wrong guess must
  // never cost a provider Run; the surface-conformance R6/PT-8 pin reads this order).
  const unified = parseUnifiedSurfaceCli(argv);
  const parsed = unified === null ? parseBatonCli(argv) : null;
  if (unified !== null) {
    const surface = Object.hasOwn(unified, 'mcpConfig')
      && unified.mcpConfig === null
      && typeof process.env.BATON_MCP_CONFIG === 'string'
      && process.env.BATON_MCP_CONFIG.length > 0
      ? Object.freeze({ ...unified, mcpConfig: process.env.BATON_MCP_CONFIG })
      : unified;
    if (surface.kind === 'surface_help') {
      process.stdout.write(`${UNIFIED_SURFACE_CLI_HELP}\n`);
    } else {
      const result = await executeUnifiedSurfaceCli(surface, {
        client: unifiedNeedsWebClient(surface) ? clientFor(discoverBatonConnection()) : null,
        mcpCall: callConfiguredMcpTool,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } else {
    if (parsed.kind === 'help' || parsed.name === 'application.help') {
      const helpTopic = parsed.topic ?? parsed.args?.topic;
      if ((helpTopic === undefined || helpTopic === 'application') && TTY) process.stderr.write(`${flipLine('baton — reflexive multi-agent orchestration', { color: TTY })}\n`);
      process.stdout.write(`${batonCliHelp(parsed.topic ?? parsed.args.topic)}\n`);
    } else if (parsed.kind === 'credential-help') {
      process.stdout.write(`${KIMI_CREDENTIAL_HELP}\n`);
    } else if (parsed.kind === 'credential-install') {
      const result = await promptAndInstallKimiCredential();
      process.stdout.write(`${formatKimiCredentialInstallResult(result)}\n`);
    } else if (parsed.kind === 'setup') {
      const result = await setupBatonConnection({ profile: parsed.profile });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (parsed.kind === 'doctor') {
      const local = inspectBatonConnection({ depth: parsed.depth });
      if (!parsed.check || local.state !== 'configured') {
        // U-F9 (issue #288): the local outline reports `needs_setup` both for "nothing is published
        // yet" and for "the publication is unusable" — and for the second case the ONE refusal that
        // knows why (protocol drift names BOTH registry digests and the remedy) was swallowed by
        // inspectBatonConnection's catch, leaving `next: baton setup`, which cannot fix drift. When
        // the outline says the published connection is unusable, run the real discovery and carry
        // its refusal verbatim (`code`, `message`, `field`, `detail`) beside the outline.
        const refusal = unusableAuthority(local) ? publishedConnectionRefusal() : null;
        // Issue #304: when the deployment is in the refused-startup state — the resident is
        // gone or was never reachable — the doctor runs the REAL startup against this
        // checkout's coordination ledger (read-only probe, no writer lease) so the operator
        // sees the offending row (seq, kind, code, message) and the quarantine remedy here,
        // instead of a bare `stale` that loops back to a `baton serve` that cannot start.
        const coordination = checkoutCoordinationReplayFailure();
        const projected = refusal === null && coordination === null ? local : Object.freeze({
          ...local,
          ...(refusal === null ? {} : { refusal }),
          ...(coordination === null ? {} : { coordination }),
          next: Object.freeze(coordination !== null
            ? [{
              action: 'quarantine',
              command: `quarantine coordination seq ${coordination.seq} (the coordination quarantine verb, issue #290) and restart with \`baton serve\``,
              reason: coordination.remedy,
            }]
            : [{
              action: 'repair_authority', command: 'baton serve',
              reason: refusal.detail?.remedy ?? refusal.message,
            }]),
        });
        process.stdout.write(`${JSON.stringify(projected, null, 2)}\n`);
        if ((parsed.check && local.state !== 'configured') || coordination !== null) process.exitCode = 1;
      } else {
        const remote = await clientFor(discoverBatonConnection()).doctor();
        const result = {
          schemaVersion: 1, state: remote.ready === true ? 'ready' : 'not_ready',
          depth: parsed.depth, outline: { ...local.outline, credential: 'accepted', remote: remote.ready === true ? 'ready' : 'not_ready' },
          deployment: remote.deployment,
          routes: remote.routes,
          briefing: remote.briefing ?? null,
          application: remote.application,
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (remote.ready !== true) process.exitCode = 1;
      }
    } else if (parsed.kind === 'top_help') {
      process.stdout.write(`${BATON_TOP_HELP}\n`);
    } else if (parsed.kind === 'top') {
      // docs/38 — `baton top` is the operator seat: explicit human output through the existing
      // authenticated resident client (surfaceSnapshot seam); ordinary commands keep machine-clean
      // JSON, so no JSON projection is appended here.
      const connection = discoverBatonConnection();
      await runBatonTop(parsed, {
        client: clientFor(connection),
        stdout: process.stdout,
        stdin: process.stdin,
        clock: Date.now,
        // The resident connection the seat attaches its ONE wake stream to (docs/38,
        // issue #315): the timeline consumes GET /v1/wakes through the wake module.
        connection,
      });
    } else if (parsed.kind === 'serve') {
      if (parsed.configPath === null) {
        await serveDeployment(await openBaton({ repo: process.cwd() }));
      } else {
        const module = await import(pathToFileURL(resolve(parsed.configPath)).href);
        const factory = module.createBatonDeployment ?? module.createBatonWebHost ?? module.default;
        if (typeof factory !== 'function') throw Object.assign(new Error('serve config must export default, createBatonDeployment(), or createBatonWebHost()'), { code: 'cli_config_invalid' });
        const configured = await factory();
        if (configured && typeof configured.host === 'function' && typeof configured.close === 'function') {
          await serveDeployment(configured);
        } else {
          const host = configured instanceof BatonWebHost ? configured : new BatonWebHost(configured);
          const outcome = await host.serve(process, (listening) => {
            process.stderr.write(`${flipAnnounce('hosted', `baton serve: ${JSON.stringify(listening)}`, { tty: TTY, color: TTY })}\n`);
          });
          process.stderr.write(`${flipAnnounce(outcome.closed?.state, `baton serve: ${JSON.stringify(outcome.closed)}`, { tty: TTY, color: TTY })}\n`);
          if (outcome.closed.state !== 'closed') process.exitCode = 1;
        }
      }
    } else {
      const connection = discoverBatonConnection();
      const client = clientFor(connection);
      let followPages = 0;
      const streaming = parsed.kind === 'follow' || parsed.kind === 'wake_watch' || (parsed.kind === 'stream' && parsed.follow);
      // A watch is an attachment, not a request: SIGINT/SIGTERM stop it the way a caller stops a
      // process (the attachment closes, the run's own wake ends, and the process exits 0) instead
      // of leaving a resident-side connection dangling until the socket is reaped.
      const controller = streaming ? new AbortController() : null;
      const stopOnSignal = () => controller.abort();
      if (controller !== null) {
        process.on('SIGINT', stopOnSignal);
        process.on('SIGTERM', stopOnSignal);
      }
      let result;
      try {
        result = await runBatonCli(parsed, client, streaming ? {
          signal: controller.signal,
          onFollowPage: async (page) => {
            followPages += 1;
            process.stdout.write(`${JSON.stringify(projectBatonCliResult(parsed, page))}\n`);
          },
        } : {});
      } finally {
        if (controller !== null) {
          process.off('SIGINT', stopOnSignal);
          process.off('SIGTERM', stopOnSignal);
        }
      }
      if (followPages === 0) process.stdout.write(`${JSON.stringify(projectBatonCliResult(parsed, result), null, 2)}\n`);
    }
  }
} catch (error) {
  const envelope = normalizeControlSurfaceError(error);
  process.stderr.write(`${flipAnnounce('refused', `baton: ${envelope.error.code}: ${envelope.error.message}`, { tty: TTY, color: TTY })}\n`);
  if (envelope.error.detail !== undefined && envelope.error.detail !== null) process.stderr.write(`${JSON.stringify(envelope.error.detail)}\n`);
  // Exit-code buckets (contract PT-6): a parse-time refusal is a usage error (2), everything else
  // is a runtime failure (1). Written as the pinned literal the parser suite scans for.
  process.exitCode = error?.code === 'cli_invalid' || error?.code === 'cli_config_invalid' || error?.code === 'cli_command_unavailable' ? 2 : 1;
}


// ── doctor-verb helpers ───────────────────────────────────────────────────────────────────────
// Declared after the entry block on purpose: function declarations hoist, so the doctor verb above
// calls these, while the file order keeps stating the U-E8/PT-8 contract — no connection discovery
// call site precedes the parse. Both are reached only from `baton doctor`, after parseBatonCli.
/** True when the local outline reports a PUBLISHED connection it judged unusable — the case whose
 * refusal discovery can name. "Nothing published yet" keeps the ordinary first-run guidance. */
function unusableAuthority(local) {
  return local?.outline?.connection === 'invalid' || local?.outline?.profile === 'invalid';
}

/** The typed refusal discovery raises for the published connection, or null when discovery
 * succeeds (or fails for a reason the local outline already states). */
function publishedConnectionRefusal() {
  try {
    discoverBatonConnection();
    return null;
  } catch (error) {
    return normalizeControlSurfaceError(error).error;
  }
}

/** Issue #304: the coordination ledger probe behind `baton doctor`'s coordination row. The
 * deployment root mirrors the layout application-deployment.mjs owns (the git common dir's
 * `baton/application-v3/state`); the probe runs only when a ledger is actually there, so a
 * machine with no deployment never has directories created under it. Returns the typed replay
 * refusal a restart would die with, or null when the ledger replays clean (or is absent). */
function checkoutCoordinationReplayFailure({ cwd = process.cwd() } = {}) {
  let commonDir;
  try {
    commonDir = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
    }).trim();
  } catch { return null; }
  if (commonDir.length === 0) return null;
  const coordinationRoot = join(resolve(cwd, commonDir), 'baton', 'application-v3', 'state', 'coordination');
  if (!existsSync(join(coordinationRoot, 'events.jsonl'))) return null;
  return coordinationReplayFailure(coordinationRoot);
}
