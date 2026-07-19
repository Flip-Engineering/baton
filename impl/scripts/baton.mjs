#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BatonWebClient, batonCliHelp, discoverBatonConnection, inspectBatonConnection,
  parseBatonCli, projectBatonCliResult, runBatonCli, setupBatonConnection,
} from '../src/application-cli.mjs';
import { BatonWebHost, SignalLifecycleOwner } from '../src/application-host.mjs';
import { openBaton } from '../src/index.mjs';
import { createLocalSocketFetch } from '../src/local-web-transport.mjs';
import {
  formatKimiCredentialInstallResult, KIMI_CREDENTIAL_HELP, promptAndInstallKimiCredential,
} from '../src/kimi-credential-setup.mjs';

function integer(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw Object.assign(new Error('positive integer environment value required'), { code: 'cli_config_invalid' });
  return parsed;
}

function clientFor(connection) {
  return new BatonWebClient({
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
}

async function serveDeployment(deployment) {
  if (!deployment || typeof deployment.host !== 'function' || typeof deployment.close !== 'function') {
    throw Object.assign(new Error('serve deployment factory returned an invalid deployment'), {
      code: 'cli_config_invalid',
    });
  }
  const lifecycle = new SignalLifecycleOwner({
    signalEmitter: process,
    shutdown: () => deployment.close(),
  });
  const outcome = await lifecycle.run(async ({ signal }) => {
    const hosted = await deployment.host();
    process.stderr.write(`baton serve: ${JSON.stringify(hosted)}\n`);
    await new Promise((resolveSignal) => {
      if (signal.aborted) resolveSignal();
      else signal.addEventListener('abort', resolveSignal, { once: true });
    });
    return hosted;
  });
  process.stderr.write(`baton serve: ${JSON.stringify(outcome.closed)}\n`);
  if (outcome.closed.state !== 'closed') process.exitCode = 1;
}

try {
  const parsed = parseBatonCli(process.argv.slice(2));
  if (parsed.kind === 'help' || parsed.name === 'application.help') {
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
      process.stdout.write(`${JSON.stringify(local, null, 2)}\n`);
      if (parsed.check && local.state !== 'configured') process.exitCode = 1;
    } else {
      const remote = await clientFor(discoverBatonConnection()).doctor();
      const result = {
        schemaVersion: 1, state: remote.ready === true ? 'ready' : 'not_ready',
        depth: parsed.depth, outline: { ...local.outline, credential: 'accepted', remote: remote.ready === true ? 'ready' : 'not_ready' },
        application: remote.application,
      };
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (remote.ready !== true) process.exitCode = 1;
    }
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
    const streaming = parsed.kind === 'follow' || (parsed.kind === 'stream' && parsed.follow);
    const result = await runBatonCli(parsed, client, streaming ? {
      onFollowPage: async (page) => {
        followPages += 1;
        process.stdout.write(`${JSON.stringify(projectBatonCliResult(parsed, page))}\n`);
      },
    } : {});
    if (followPages === 0) process.stdout.write(`${JSON.stringify(projectBatonCliResult(parsed, result), null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`baton: ${error?.code ?? 'cli_failed'}: ${error?.message ?? 'command failed'}\n`);
  process.exitCode = error?.code === 'cli_invalid' || error?.code === 'cli_config_invalid' || error?.code === 'cli_command_unavailable' ? 2 : 1;
}
