#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BatonWebClient, batonCliHelp, discoverBatonConnection, inspectBatonConnection,
  parseBatonCli, projectBatonCliResult, runBatonCli, setupBatonConnection,
} from '../src/application-cli.mjs';
import { BATON_TOP_HELP, runBatonTop } from '../src/baton-top.mjs';
import { BatonWebHost, SignalLifecycleOwner, describeDrainWait, signalIntentLine } from '../src/application-host.mjs';
import { flipLine } from '../src/brand.mjs';
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
    const readRuns = typeof deployment.runs?.list === 'function'
      ? () => deployment.runs.list()
      : () => { throw Object.assign(new Error('this deployment publishes no run list'), { code: 'application_host_narration_unavailable' }); };
    announced = (async () => signalIntentLine(trigger, readRuns))().then(
      (line) => { process.stderr.write(`${flipLine(`baton serve: ${line}`, { color: TTY })}\n`); },
      (error) => {
        process.stderr.write(`${flipLine(`baton serve: signal received; draining participants (narration failed: ${error?.code ?? error?.name ?? 'error'}) (${trigger.kind})`, { pose: 'thinking', color: TTY })}\n`);
      },
    );
    return announced;
  };
  const lifecycle = new SignalLifecycleOwner({
    signalEmitter: process,
    shutdown: async () => { await announced; return deployment.close(); },
    announce: narration,
  });
  let outcome;
  try {
    outcome = await lifecycle.run(async ({ signal }) => {
      const hosted = await deployment.host();
      process.stderr.write(`${flipLine(`baton serve: ${JSON.stringify(hosted)}`, { pose: 'thinking', color: TTY })}\n`);
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
    process.stderr.write(`${flipLine(`baton serve: exit non-zero; ${summary}`, { pose: 'thinking', color: TTY })}\n`);
    throw error;
  }
  process.stderr.write(`${flipLine(`baton serve: ${JSON.stringify(outcome.closed)}`, { color: TTY })}\n`);
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
  let unified = parseUnifiedSurfaceCli(argv);
  if (unified !== null) {
    if (Object.hasOwn(unified, 'mcpConfig')
      && unified.mcpConfig === null
      && typeof process.env.BATON_MCP_CONFIG === 'string'
      && process.env.BATON_MCP_CONFIG.length > 0) {
      unified = Object.freeze({ ...unified, mcpConfig: process.env.BATON_MCP_CONFIG });
    }
    if (unified.kind === 'surface_help') {
      process.stdout.write(`${UNIFIED_SURFACE_CLI_HELP}\n`);
    } else {
      const result = await executeUnifiedSurfaceCli(unified, {
        client: unifiedNeedsWebClient(unified) ? clientFor(discoverBatonConnection()) : null,
        mcpCall: callConfiguredMcpTool,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } else {
    const parsed = parseBatonCli(argv);
    if (parsed.kind === 'help' || parsed.name === 'application.help') {
      const helpTopic = parsed.topic ?? parsed.args?.topic;
      if (helpTopic === undefined || helpTopic === 'application') process.stderr.write(`${flipLine('baton — reflexive multi-agent orchestration', { color: TTY })}\n`);
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
        const projected = refusal === null ? local : Object.freeze({
          ...local,
          refusal,
          next: Object.freeze([{
            action: 'repair_authority', command: 'baton serve',
            reason: refusal.detail?.remedy ?? refusal.message,
          }]),
        });
        process.stdout.write(`${JSON.stringify(projected, null, 2)}\n`);
        if (parsed.check && local.state !== 'configured') process.exitCode = 1;
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
            process.stderr.write(`baton serve: ${JSON.stringify(listening)}\n`);
          });
          process.stderr.write(`baton serve: ${JSON.stringify(outcome.closed)}\n`);
          if (outcome.closed.state !== 'closed') process.exitCode = 1;
        }
      }
    } else {
      const connection = discoverBatonConnection();
      const client = clientFor(connection);
      let followPages = 0;
      const streaming = parsed.kind === 'follow' || parsed.kind === 'swarm_follow' || (parsed.kind === 'stream' && parsed.follow);
      const result = await runBatonCli(parsed, client, streaming ? {
        onFollowPage: async (page) => {
          followPages += 1;
          process.stdout.write(`${JSON.stringify(projectBatonCliResult(parsed, page))}\n`);
        },
      } : {});
      if (followPages === 0) process.stdout.write(`${JSON.stringify(projectBatonCliResult(parsed, result), null, 2)}\n`);
    }
  }
} catch (error) {
  const envelope = normalizeControlSurfaceError(error);
  process.stderr.write(`${flipLine(`baton: ${envelope.error.code}: ${envelope.error.message}`, { pose: 'thinking', color: TTY })}\n`);
  if (envelope.error.detail !== undefined && envelope.error.detail !== null) process.stderr.write(`${JSON.stringify(envelope.error.detail)}\n`);
  process.exitCode = ['cli_invalid', 'cli_config_invalid', 'cli_command_unavailable'].includes(envelope.error.code) ? 2 : 1;
}
