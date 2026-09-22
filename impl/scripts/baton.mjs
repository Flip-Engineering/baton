#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CoordinationRefusal, coordinationReplayFailure, quarantineCoordinationLedgerEvent,
} from '../src/coordination-store.mjs';
import {
  BatonWebClient, batonCliHelp, discoverBatonConnection, inspectBatonConnection,
  isReadOnlyCliDispatch, parseBatonCli, projectBatonCliResult, runBatonCli, setupBatonConnection,
} from '../src/application-cli.mjs';
import { BATON_TOP_HELP, runBatonTop } from '../src/baton-top.mjs';
import { reincarnationProcessAlive } from '../src/application-deployment.mjs';
import { BatonWebHost, SignalLifecycleOwner, describeDrainWait, signalIntentLine } from '../src/application-host.mjs';
import { flipAnnounce, flipLine } from '../src/brand.mjs';
import { callConfiguredMcpTool } from '../src/configured-mcp-client.mjs';
import { assertCliMcpControlParity, normalizeControlSurfaceError } from '../src/control-surface-unification.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
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


// Issue #351 lane 3: a signal that arrives while the deployment is still OPENING used to hit
// Node's default disposition — the process died mid-open with no stop row, no drain, no lease
// release (the measured `SIGTERM ignored for ten minutes` was its other face: a handler that
// never got a turn). These handlers stand in for the lifecycle's own admission during the
// open: they keep the process alive and remember the first trigger; serveDeployment admits it
// the moment the lifecycle owns signal admission, and the stop row lands through the
// deployment's own writer path.
function admitOpenSignals() {
  const state = { kind: null };
  const admit = (kind) => {
    if (state.kind !== null) return;
    state.kind = kind;
    process.stderr.write(`${flipAnnounce('draining', `baton serve: ${kind} received during open; the stop row lands once the ledger writer exists`, { tty: TTY, color: TTY })}\n`);
  };
  process.on('SIGINT', admit);
  process.on('SIGTERM', admit);
  process.on('SIGHUP', admit);
  return {
    release() {
      process.off('SIGINT', admit);
      process.off('SIGTERM', admit);
      process.off('SIGHUP', admit);
    },
    pendingTrigger() {
      return state.kind;
    },
  };
}

// Issue #471: a `baton serve` a test spawned is never an orphan. The fixture helper
// (impl/test/fixtures/fixture-resident.mjs) — and nothing else — sets BATON_SERVE_PARENT_PID to
// the pid of the process that spawned the resident; when that pid is gone the resident stops
// through the path a signal takes (the durable request row first, then the same
// `deployment.close()`), so the ledger names why it ended instead of the resident serving a
// repository nobody can reach. A resident started without the variable behaves exactly as today.

/** The pid named by BATON_SERVE_PARENT_PID, or null when the variable is absent or malformed (a
 * resident started by hand keeps today's behavior). */
function declaredServeParentPid(env = process.env) {
  const raw = env.BATON_SERVE_PARENT_PID;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

// The same cadence the successor's own predecessor watch polls at, for the same observation (a
// process that is gone). `reincarnationProcessAlive` is that watch's primitive: `false` is the
// only reading that ends this watch — an unanswerable reading (`null`) keeps waiting, never a
// guess. The timer is unref'd, so a watch nobody ends never holds the loop open by itself.
const PARENT_EXIT_POLL_MS = 100;

function watchDeclaredParent(pid, onExit) {
  let ended = false;
  const poll = () => {
    if (ended) return true;
    if (reincarnationProcessAlive(pid) !== false) return false;
    ended = true;
    onExit();
    return true;
  };
  if (poll()) return () => {};
  const timer = setInterval(() => { if (poll()) clearInterval(timer); }, PARENT_EXIT_POLL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => { ended = true; clearInterval(timer); };
}

async function serveDeployment(rawDeployment, admittedTrigger = null) {
  const deployment = rawDeployment?.convergence ? rawDeployment : wrapProductionDeployment(rawDeployment, { repoRoot: process.cwd() });
  if (!deployment || typeof deployment.host !== 'function' || typeof deployment.close !== 'function') {
    throw Object.assign(new Error('serve deployment factory returned an invalid deployment'), {
      code: 'cli_config_invalid',
    });
  }
  // #276(1)/(2): the operator's line at signal receipt, then the drain's own narration (the
  // deployment's host writes its stages), then one exit line. The receipt line is written before
  // `deployment.close()` — before any drain wait — and the count comes from the projection the
  // resident ALREADY holds: the deployment's live coordinator rows (#437), never a `runs.list`
  // that re-derives review targets across the ledger. A deployment that publishes only a run list
  // is still counted from it, and a read that REFUSES is named with its code — and recorded once —
  // instead of leaving the operator with an unexplained "count unavailable".
  let announced = null;
  // Issue #468: this incarnation's OWN serve log. `deployment.host()` opens `resident/
  // serve.<incarnation>.log` at open and every host line lands in it; the lines THIS script writes
  // (the open's replay marker, the flip, the stop's exit lines) are the same incarnation's
  // narration, so they are written to the same file — a `baton serve` started by hand keeps
  // stdout/stderr exactly as today AND writes the file, and the successor's narration no longer
  // depends on a predecessor's process holding a pipe open.
  const logLine = (line) => {
    try { process.stderr.write(`${line}\n`); } catch { /* a broken sink never breaks the stop */ }
    try { deployment.serveLog?.()?.write(line); } catch { /* a missing line, never a missing stop */ }
  };
  const narration = (trigger) => {
    // Issue #351 lane 2: the durable request is the handler's FIRST act — appended synchronously
    // through the deployment's own writer path (one bounded row, deduped against the drain)
    // before the narration read a busy loop could postpone it behind.
    try {
      const requestedLine = typeof deployment.recordStopRequested === 'function'
        ? deployment.recordStopRequested(trigger.kind) : null;
      if (requestedLine) {
        logLine(flipAnnounce('draining', requestedLine, { tty: TTY, color: TTY }));
      }
    } catch { /* the stop narrates without the row rather than wedging the handler */ }
    const source = typeof deployment.ownedParticipantCount === 'function'
      ? { read: 'coordinator.participants', run: () => deployment.ownedParticipantCount() }
      : typeof deployment.runs?.list === 'function'
        ? { read: 'runs.list', run: () => deployment.runs.list() }
        : { read: null, run: () => { throw Object.assign(new Error('this deployment publishes no run list'), { code: 'application_host_narration_unavailable' }); } };
    const refused = (refusal) => {
      try {
        const recorded = typeof deployment.recordNarrationRefused === 'function' ? deployment.recordNarrationRefused(refusal) : null;
        if (recorded?.line) logLine(flipAnnounce('draining', recorded.line, { tty: TTY, color: TTY }));
      } catch { /* the line below is still written */ }
    };
    announced = (async () => signalIntentLine(trigger, source, { onRefused: refused }))().then(
      (line) => { logLine(flipAnnounce('draining', `baton serve: ${line}`, { tty: TTY, color: TTY })); },
      (error) => {
        logLine(flipAnnounce('draining', `baton serve: signal received; draining participants (narration failed: ${error?.code ?? error?.name ?? 'error'}) (${trigger.kind})`, { tty: TTY, color: TTY }));
      },
    );
    return announced;
  };
  // Issue #471: the declared parent's exit is a stop like a signal's — the durable request row
  // comes first, the line names the trigger, and the shutdown below is the same ordinary
  // `deployment.close()`. A resident started without the variable never builds this watch.
  const parentPid = declaredServeParentPid();
  let admitParentExit = null;
  const parentExited = parentPid === null ? null : new Promise((resolve) => { admitParentExit = resolve; });
  const stopParentWatch = parentPid === null ? null : watchDeclaredParent(parentPid, () => {
    try {
      const requested = typeof deployment.recordStopRequested === 'function'
        ? deployment.recordStopRequested('parent_exited', { parentPid }) : null;
      if (requested !== null) logLine(flipAnnounce('draining', requested, { tty: TTY, color: TTY }));
    } catch { /* the stop narrates without the row rather than staying an orphan */ }
    logLine(flipAnnounce('draining', `baton serve: the declared parent (pid ${parentPid}) is gone; stopping`, { tty: TTY, color: TTY }));
    admitParentExit();
  });
  // Issue #482: the incarnation's OWN stop, as the serve loop's third end. A handoff schedules this
  // incarnation's close itself (`reincarnate`), so neither a signal nor the declared parent's exit
  // ever arrives: the loop waits, every handle goes over to the successor, and the loop drains under
  // an unsettled top-level await — Node then ends the process with exit 13 and "Detected unsettled
  // top-level await", which a supervisor reads as a failure. The wait is the deployment's own
  // (`whenStopped`), so it settles on the SAME withdrawal the signal path reads first, in the same
  // act. Built before the host starts, so a stop that lands during the open is never missed; a
  // deployment that publishes no such read keeps today's behavior (there is nothing to watch).
  const stopSettled = typeof deployment.whenStopped === 'function' ? deployment.whenStopped() : null;
  const lifecycle = new SignalLifecycleOwner({
    signalEmitter: process,
    shutdown: async () => { await announced; return deployment.close(); },
    announce: narration,
    // Issue #461: a SIGTERM to an incarnation that has already withdrawn (its handoff completed)
    // exits at once — the signal path reads the incarnation's state first and drains nothing.
    withdrawn: () => deployment.withdrawn?.() === true,
    // #351 lane 3: a signal received during the open is admitted here, the moment the
    // lifecycle owns signal admission — the announce above then writes the stop row through
    // the deployment's own writer path and the usual shutdown runs.
    ...(admittedTrigger !== null ? { admittedTrigger } : {}),
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
    logLine(flipAnnounce('failed', `baton serve: ${label} (${code}): ${head} — stopping through the drain`, { tty: TTY, color: TTY }));
    // Issue #468: the code AND the stack head ride the durable trigger row. The narration line
    // above can be written into a stream that just failed (the 13:36Z EPIPE was reported on the
    // very pipe that was gone); the row cannot — so the ledger, not a lost pipe, names the stream
    // and the frame next time.
    try { deployment.recordStopRequested?.(`${label}:${code}`, { code, stackHead: head }); } catch { /* the stop narrates without the row */ }
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
      // Issue #351 lane 3: the replaying→published sequence in the operator's log. The
      // replay's own marker precedes the flip line for any ledger at the registry's chunk
      // bound or above — the size a replay was audible (loop-blocking) at before this lane.
      const pre = typeof deployment.startupReport === 'function' ? deployment.startupReport() : null;
      if (pre !== null && (pre.rows ?? 0) >= FRAME_LIMITS['view.wake_replay.items'].value) {
        logLine(flipAnnounce('hosted', `baton serve: replayed (open ${pre.openElapsedMs}ms; ${pre.rows} rows on the ledger; replayed ${pre.replayedEvents ?? 0}; checkpoint ${pre.checkpoint ?? 'unknown'})`, { tty: TTY, color: TTY }));
      }
      // An already-admitted signal skips the host start: the stop is the operation's outcome.
      if (signal.aborted) return null;
      const hosted = await deployment.host();
      // Issue #351 lane 2: the ONE line at the flip — the publication exists and the loop was
      // free enough to answer the self-check; the row says how long the startup took (replay
      // included) and what the ledger held, so "published" is never a guess about readiness.
      const report = typeof deployment.startupReport === 'function' ? deployment.startupReport() : null;
      // #397: a refused checkpoint never appears without its reason and the compared values.
      const checkpointText = report === null ? 'unknown'
        : `${report.checkpoint ?? 'unknown'}${report.reason ? ` (${report.reason}${report.detail ? ` ${JSON.stringify(report.detail)}` : ''})` : ''}`;
      // Issue #351 lane 4: the flip names the reconstruction too — the phase between the
      // replayed line and this one, and the wall clock its pass order consumed.
      const reconstructedText = report?.reconstructionElapsedMs == null ? ''
        : `; reconstructed ${Math.round(report.reconstructionElapsedMs)}ms`;
      const flip = report === null ? 'answering'
        : `answering (open ${report.openElapsedMs}ms; ${report.rows ?? 0} rows on the ledger; replayed ${report.replayedEvents ?? 0}; checkpoint ${checkpointText}${reconstructedText})`;
      logLine(flipAnnounce('hosted', `baton serve: ${flip}`, { tty: TTY, color: TTY }));
      logLine(flipAnnounce('hosted', `baton serve: ${JSON.stringify(hosted)}`, { tty: TTY, color: TTY }));
      await new Promise((resolveSignal) => {
        if (signal.aborted) resolveSignal();
        else signal.addEventListener('abort', resolveSignal, { once: true });
        // #471: the declared parent's exit ends this wait the way a signal does; the request row
        // above already named the trigger, and the shutdown is the same deployment.close().
        if (parentExited !== null) parentExited.then(() => resolveSignal());
        // Issue #482: …and so does this incarnation's own stop. Its outcome is what the loop has
        // been waiting for all along: the operation ends, the lifecycle runs the same shutdown a
        // signal runs — this incarnation's close, already settled, so it answers its own verdict —
        // and `serveDeployment` resolves, leaving `baton serve` to end through a settled top-level
        // await (exit 0). A stop that failed rejects that same close, and the refusal is narrated
        // and crossed exactly as a signal-driven stop's failure is.
        if (stopSettled !== null) stopSettled.then(() => resolveSignal());
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
    logLine(flipAnnounce('failed', `baton serve: exit non-zero; ${summary}`, { tty: TTY, color: TTY }));
    throw error;
  } finally {
    stopParentWatch?.();
  }
  logLine(flipAnnounce(outcome.closed?.state, `baton serve: ${JSON.stringify(outcome.closed)}`, { tty: TTY, color: TTY }));
  if (outcome.closed.state !== 'closed') process.exitCode = 1;
}

/** The serve leg both `baton serve` and `baton quarantine --restart` (issue #505) run: open
 * this checkout's deployment and host it until a trigger ends the process. */
async function serveCheckout() {
  const openSignals = admitOpenSignals();
  let deployment;
  try { deployment = await openBaton({ repo: process.cwd() }); }
  finally { openSignals.release(); }
  await serveDeployment(deployment, openSignals.pendingTrigger());
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
              // Issue #505: the remedy is the verb itself — one runnable command that
              // records the fold refusal and restarts the resident.
              action: 'quarantine',
              command: `baton quarantine ${coordination.seq} --reason ${coordination.code} --restart`,
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
        const remote = await clientFor(discoverBatonConnection({ tolerateRegistryDrift: true })).doctor();
        // Issue #476: a resident that is STOPPING is not merely `not_ready` — it is a state with a
        // reason and a wait, and #467 keeps this transport's reads open so the operator can read
        // it. The stopping section the deployment already puts on its own card (`state`, `at`, the
        // waits it holds — the seat being drained, the instant it was observed, the bounded attempt
        // the stop reached) is rendered where the resident reported it, beside the ONE next step:
        // wait for the stop to converge. That wait is bounded (#467: each worker wait is capped by
        // the drain's own attempts) and ends when the resident exits, so the operator's verb reads
        // the state instead of a bare `cli_command_failed: … GET /readyz, HTTP 503`.
        const stopping = remote.stopping ?? null;
        const state = stopping !== null ? 'stopping' : remote.ready === true ? 'ready' : 'not_ready';
        const result = {
          schemaVersion: 1, state,
          depth: parsed.depth, outline: { ...local.outline, credential: 'accepted', remote: state },
          ...(stopping === null ? {} : { stopping }),
          deployment: remote.deployment,
          routes: remote.routes,
          briefing: remote.briefing ?? null,
          application: remote.application,
          ...(stopping === null ? {} : {
            next: [{
              action: 'wait',
              command: 'baton doctor --check',
              reason: `the resident is stopping: ${stopping.waits?.length ?? 0} wait(s) held, `
                + `bounded attempt ${stopping.attempts ?? 0} reached. It keeps answering this read `
                + 'until its stop converges and the process exits; a resident that has exited answers '
                + 'the local `needs_setup` outline instead.',
            }],
          }),
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (remote.ready !== true) process.exitCode = 1;
      }
    } else if (parsed.kind === 'quarantine') {
      // Issue #505: the verb the doctor's coordination remedy names. The resident is down in
      // exactly this state, so the verb is host-local: it records the fold refusal against
      // this checkout's ledger (issue #290's standalone repair, which re-probes the real
      // startup and refuses a seq or a ledger health that does not match), and `--restart`
      // continues into the serve leg.
      const coordinationRoot = checkoutCoordinationRoot();
      if (coordinationRoot === null || !existsSync(join(coordinationRoot, 'events.jsonl'))) {
        throw new CoordinationRefusal(
          'this checkout has no coordination ledger to quarantine — `baton quarantine` records '
          + 'the seq a refused startup reported; `baton doctor` shows that probe',
          'coordination_quarantine_no_ledger',
        );
      }
      const outcome = await quarantineCoordinationLedgerEvent(coordinationRoot, {
        seq: parsed.seq, reason: parsed.reason, actor: 'operator:cli',
      });
      process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
      if (parsed.restart) await serveCheckout();
    } else if (parsed.kind === 'top_help') {
      process.stdout.write(`${BATON_TOP_HELP}\n`);
    } else if (parsed.kind === 'top') {
      // docs/38 — `baton top` is the operator seat: explicit human output through the existing
      // authenticated resident client (surfaceSnapshot seam); ordinary commands keep machine-clean
      // JSON, so no JSON projection is appended here.
      const connection = discoverBatonConnection({ tolerateRegistryDrift: true });
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
        await serveCheckout();
      } else {
        const module = await import(pathToFileURL(resolve(parsed.configPath)).href);
        const factory = module.createBatonDeployment ?? module.createBatonWebHost ?? module.default;
        if (typeof factory !== 'function') throw Object.assign(new Error('serve config must export default, createBatonDeployment(), or createBatonWebHost()'), { code: 'cli_config_invalid' });
        const openSignals = admitOpenSignals();
        let configured;
        try { configured = await factory(); }
        finally { openSignals.release(); }
        if (configured && typeof configured.host === 'function' && typeof configured.close === 'function') {
          await serveDeployment(configured, openSignals.pendingTrigger());
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
      const connection = discoverBatonConnection({ tolerateRegistryDrift: isReadOnlyCliDispatch(parsed) });
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
      // Issue #365: a follow that ended through its ended row (an aborted signal, or a wake
      // stream that closed) prints that row even when pages already streamed — the ended row is
      // the leg's own verdict, never swallowed by the pages it delivered.
      // Issue #320: unless the pages already carried that verdict. A wake follow whose end IS a
      // delivered frame — the pinned swarm's own closed wake, which the ended row names under
      // `closed` — printed that frame as its last page, and the ended row only restates it;
      // printing it would put a second, differently-shaped document on a stream whose contract is
      // one JSON frame per line. An end the frames did not name (a caller abort, a resident stop,
      // a transport close) still prints its verdict.
      const endedRow = typeof result?.kind === 'string' && result.kind.endsWith('_ended');
      const closedWakeEnded = endedRow && result.closed !== null && result.closed !== undefined;
      if (followPages === 0 || (endedRow && !closedWakeEnded)) {
        process.stdout.write(`${JSON.stringify(projectBatonCliResult(parsed, result), null, 2)}\n`);
      }
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

/** The deployment coordination root for this checkout: the layout application-deployment.mjs
 * owns (the git common dir's `baton/application-v3/state`). Null when the checkout is not a git
 * checkout. */
function checkoutCoordinationRoot({ cwd = process.cwd() } = {}) {
  let commonDir;
  try {
    commonDir = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
    }).trim();
  } catch { return null; }
  if (commonDir.length === 0) return null;
  return join(resolve(cwd, commonDir), 'baton', 'application-v3', 'state', 'coordination');
}

/** Issue #304: the coordination ledger probe behind `baton doctor`'s coordination row. The
 * probe runs only when a ledger is actually there, so a machine with no deployment never has
 * directories created under it. Returns the typed replay refusal a restart would die with, or
 * null when the ledger replays clean (or is absent). */
function checkoutCoordinationReplayFailure({ cwd = process.cwd() } = {}) {
  const coordinationRoot = checkoutCoordinationRoot({ cwd });
  if (coordinationRoot === null || !existsSync(join(coordinationRoot, 'events.jsonl'))) return null;
  return coordinationReplayFailure(coordinationRoot);
}
