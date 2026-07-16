#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BatonWebClient, batonCliHelp, discoverBatonConnection, parseBatonCli, runBatonCli,
} from '../src/application-cli.mjs';
import { BatonWebHost } from '../src/application-host.mjs';

function integer(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw Object.assign(new Error('positive integer environment value required'), { code: 'cli_config_invalid' });
  return parsed;
}

try {
  const parsed = parseBatonCli(process.argv.slice(2));
  if (parsed.kind === 'help' || parsed.name === 'application.help') {
    process.stdout.write(`${batonCliHelp(parsed.topic ?? parsed.args.topic)}\n`);
  } else if (parsed.kind === 'serve') {
    const module = await import(pathToFileURL(resolve(parsed.configPath)).href);
    const factory = module.createBatonWebHost ?? module.default;
    if (typeof factory !== 'function') throw Object.assign(new Error('serve config must export default or createBatonWebHost()'), { code: 'cli_config_invalid' });
    const configured = await factory();
    const host = configured instanceof BatonWebHost ? configured : new BatonWebHost(configured);
    const outcome = await host.serve(process, (listening) => {
      process.stderr.write(`baton serve: ${JSON.stringify(listening)}\n`);
    });
    process.stderr.write(`baton serve: ${JSON.stringify(outcome.closed)}\n`);
    if (outcome.closed.state !== 'closed') process.exitCode = 1;
  } else {
    const connection = discoverBatonConnection();
    const client = new BatonWebClient({
      baseUrl: connection.baseUrl,
      origin: connection.origin,
      repoId: connection.repoId,
      token: connection.token,
      commandTimeoutMs: integer(process.env.BATON_COMMAND_TIMEOUT_MS, 30_000),
      pollMs: integer(process.env.BATON_COMMAND_POLL_MS, 250),
      fetchImpl: globalThis.fetch,
      clock: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    let followPages = 0;
    const result = await runBatonCli(parsed, client, parsed.kind === 'follow' ? {
      onFollowPage: async (page) => {
        followPages += 1;
        process.stdout.write(`${JSON.stringify(page)}\n`);
      },
    } : {});
    if (followPages === 0) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`baton: ${error?.code ?? 'cli_failed'}: ${error?.message ?? 'command failed'}\n`);
  process.exitCode = error?.code === 'cli_invalid' || error?.code === 'cli_config_invalid' || error?.code === 'cli_command_unavailable' ? 2 : 1;
}
