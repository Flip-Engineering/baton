import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { BatonWebClient, BatonWebHost, SignalLifecycleOwner, parseBatonCli, runBatonCli } from '../src/index.mjs';

const D = 'a'.repeat(64);

test('UC1: concise CLI vocabulary compiles only shipped commands into shared Run arguments', () => {
  const start = parseBatonCli(['run', 'start', 'Ship it', '--profile', 'standard', '--exact', 'codex/gpt-5.6-sol@low', '--scope', 'impl/src,impl/test', '--run-id', 'run-a', '--idempotency-key', 'start-a']);
  assert.deepEqual(start, {
    kind: 'command', name: 'run.start', idempotencyKey: 'start-a',
    args: { intent: { objective: 'Ship it', profile: 'standard', route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' }, runId: 'run-a', scope: ['impl/src', 'impl/test'] } },
  });
  assert.equal(parseBatonCli(['run', 'status', 'run-a', '--wait', '5s']).name, 'run.wait');
  assert.deepEqual(parseBatonCli(['run', 'status', 'run-a', '--follow', '--wait', '5s', '--idempotency-key', 'follow-a']), {
    kind: 'follow', runId: 'run-a', timeoutMs: 5_000, idempotencyKey: 'follow-a',
  });
  assert.deepEqual(parseBatonCli(['run', 'approve', 'run-a', '--plan', D]).args, { runId: 'run-a', planDigest: D });
  assert.deepEqual(parseBatonCli(['run', 'answer', 'run-a', 'question-a', '--allow']).args.answer, { decision: 'allow' });
  assert.deepEqual(parseBatonCli(['run', 'answer', 'run-a', 'question-a', '--text', 'Proceed.']).args.answer, { text: 'Proceed.' });
  assert.deepEqual(parseBatonCli(['run', 'steer', 'run-a', 'w-1', '--now', 'Refocus.', '--reason', 'New evidence']).args,
    { runId: 'run-a', target: 'w-1', mode: 'now', message: 'Refocus.', reason: 'New evidence' });
  assert.equal(parseBatonCli(['run', 'stop', 'run-a', '--reason', 'Cancelled']).name, 'run.stop');
  assert.equal(parseBatonCli(['run', 'evidence', 'run-a']).name, 'run.evidence');
  assert.equal(parseBatonCli(['run', 'adopt', 'run-a', '--reason', 'Select result']).kind, 'adopt');
  assert.deepEqual(parseBatonCli(['run', 'review', 'run-a', '--exact', 'grok/grok-4.5@low', '--reason', 'Independent review']).args, {
    runId: 'run-a', route: { harness: 'grok', model: 'grok-4.5', effort: 'low' }, reason: 'Independent review',
  });
  assert.equal(parseBatonCli(['run', 'integrate', 'run-a', '--strategy', 'ff-only', '--reason', 'Reviewed']).kind, 'integrate');
  assert.deepEqual(parseBatonCli(['serve', './deployment.mjs']), { kind: 'serve', configPath: './deployment.mjs' });
  assert.deepEqual(parseBatonCli(['run', 'recover', 'run-a', '--idempotency-key', 'recover-a']), {
    kind: 'command', name: 'run.recover', args: { runId: 'run-a' }, idempotencyKey: 'recover-a',
  });
  assert.throws(() => parseBatonCli(['run', 'follow', 'run-a']), (error) => error.code === 'cli_command_unavailable');
  assert.throws(() => parseBatonCli(['run', 'start', 'x', '--profile', 'p', '--exact', 'gpt-5.6-sol']), /HARNESS\/MODEL@EFFORT/);
});

test('UC2: authenticated CLI client sends the same strict Web envelope and reconciles admitted commands', async () => {
  const requests = [];
  let now = 0;
  const responses = [
    { ok: true, body: { ok: true, status: 'admitted' } },
    { ok: true, body: { ok: true, command: { status: 'admitted' } } },
    { ok: true, body: { ok: true, command: { status: 'completed', outcome: { httpStatus: 200, body: { ok: true, result: { runId: 'run-a', phase: 'running' } } } } } },
  ];
  const client = new BatonWebClient({
    baseUrl: 'https://baton.test', origin: 'https://control.test', repoId: 'repo-a', token: 'private-bearer',
    commandTimeoutMs: 1_000, pollMs: 10,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      return { ok: response.ok, async json() { return response.body; } };
    },
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  const result = await client.command('run.status', { runId: 'run-a' }, 'status-a');
  assert.deepEqual(result, { runId: 'run-a', phase: 'running' });
  const envelope = JSON.parse(requests[0].options.body);
  assert.equal(envelope.command, 'run_status');
  assert.equal(envelope.idempotencyKey, 'status-a');
  assert.equal(envelope.repoId, 'repo-a');
  assert.equal(envelope.origin, 'https://control.test');
  assert.deepEqual(envelope.args, { runId: 'run-a' });
  assert.equal(requests[0].options.headers.authorization, 'Bearer private-bearer');
  assert.equal(requests[0].options.body.includes('private-bearer'), false);
  assert.equal(requests[1].url.endsWith(`/v1/commands/${envelope.commandId}`), true);
});

test('UC3: adopt reads terminal evidence then binds its displayed digest without caller-side Git inspection', async () => {
  const calls = [];
  const client = {
    async command(name, args, key) {
      calls.push({ name, args, key });
      if (name === 'run.evidence') return { runId: 'run-a', manifestDigest: D, result: { nodeKey: 'work', sha: 'b'.repeat(40) } };
      return { runId: 'run-a', phase: 'work_completed', result: { state: 'adopted' } };
    },
  };
  const parsed = parseBatonCli(['run', 'adopt', 'run-a', '--reason', 'Independent result selected', '--idempotency-key', 'adopt-a']);
  const result = await runBatonCli(parsed, client);
  assert.equal(result.result.state, 'adopted');
  assert.deepEqual(calls, [
    { name: 'run.evidence', args: { runId: 'run-a' }, key: 'adopt-a:evidence' },
    { name: 'run.adopt', args: { runId: 'run-a', nodeKey: 'work', resultSha: 'b'.repeat(40), evidenceDigest: D, reason: 'Independent result selected' }, key: 'adopt-a:adopt' },
  ]);
});

test('UC3b: integrate reads fresh terminal evidence and binds its displayed digest', async () => {
  const calls = [];
  const client = { command: async (name, args, key) => {
    calls.push({ name, args, key });
    if (name === 'run.evidence') return { manifestDigest: D };
    return { runId: 'run-a', phase: 'completed', integration: { state: 'integrated' } };
  } };
  const parsed = parseBatonCli(['run', 'integrate', 'run-a', '--strategy', 'ff-only', '--reason', 'Reviewed result', '--idempotency-key', 'integrate-a']);
  const result = await runBatonCli(parsed, client);
  assert.equal(result.phase, 'completed');
  assert.deepEqual(calls, [
    { name: 'run.evidence', args: { runId: 'run-a' }, key: 'integrate-a:evidence' },
    { name: 'run.integrate', args: { runId: 'run-a', evidenceDigest: D, strategy: 'ff-only', reason: 'Reviewed result' }, key: 'integrate-a:integrate' },
  ]);
});

test('UC3c: follow derives its wait from the admitted profile and streams bounded cursor pages until attention is required', async () => {
  const calls = [];
  const pages = [];
  const responses = [
    { runId: 'run-a', phase: 'running', cursor: 12, profile: { name: 'standard', digest: D }, follow: { afterCursor: 10, throughCursor: 12, changes: [{ cursor: 12, category: 'execution', kind: 'task.started' }], timedOut: false, terminal: false } },
    { runId: 'run-a', phase: 'work_completed', cursor: 15, profile: { name: 'standard', digest: D }, follow: { afterCursor: 12, throughCursor: 15, changes: [{ cursor: 15, category: 'result', kind: 'task.completed' }], timedOut: false, terminal: true } },
  ];
  const client = {
    async doctor() {
      calls.push({ name: 'doctor' });
      return { application: { profiles: [{ name: 'standard', digest: D, followPolicy: { mode: 'enabled', maxWaitMs: 25_000, maxChanges: 64, maxResponseBytes: 262_144, maxScanEvents: 1_024 } }] } };
    },
    async command(name, args, key) {
      calls.push({ name, args, key });
      if (name === 'run.status') return { runId: 'run-a', phase: 'running', cursor: 10, profile: { name: 'standard', digest: D } };
      return responses.shift();
    },
  };
  const result = await runBatonCli(parseBatonCli(['run', 'status', 'run-a', '--follow', '--idempotency-key', 'follow-a']), client, {
    onFollowPage: async (page) => pages.push(page),
  });
  assert.equal(result.phase, 'work_completed');
  assert.deepEqual(pages.map((page) => [page.follow.afterCursor, page.follow.throughCursor]), [[10, 12], [12, 15]]);
  assert.deepEqual(calls, [
    { name: 'run.status', args: { runId: 'run-a' }, key: 'follow-a:status' },
    { name: 'doctor' },
    { name: 'run.follow', args: { runId: 'run-a', afterCursor: 10, timeoutMs: 25_000 }, key: 'follow-a:follow:0:10' },
    { name: 'run.follow', args: { runId: 'run-a', afterCursor: 12, timeoutMs: 25_000 }, key: 'follow-a:follow:1:12' },
  ]);
});

test('UC4: packaged baton entry has pure help output and never requires credentials for help', () => {
  const output = execFileSync(process.execPath, ['scripts/baton.mjs', '--help'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {} });
  assert.match(output, /^usage:/);
  assert.match(output, /BATON_TOKEN/);
  assert.equal(output.includes('--follow'), false);
  const runHelp = execFileSync(process.execPath, ['scripts/baton.mjs', 'help', 'run'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {},
  });
  assert.match(runHelp, /--follow/u);
  assert.match(runHelp, /manual routing always requires --model and --effort together/iu);
  const secret = 'distinctive-secret-that-must-not-leak';
  const contextual = spawnSync(process.execPath, ['scripts/baton.mjs', 'run', 'show', '--help'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { BATON_URL: 'https://baton.test', BATON_ORIGIN: 'https://control.test', BATON_REPO_ID: 'repo-a', BATON_TOKEN: secret },
  });
  assert.equal(contextual.status, 0);
  assert.match(contextual.stdout, /baton run show RUN_ID/u);
  assert.equal(`${contextual.stdout}${contextual.stderr}`.includes(secret), false);
  const refused = spawnSync(process.execPath, ['scripts/baton.mjs', 'doctor'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {} });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /cli_config_invalid/);
  assert.equal(refused.stdout, '');
});

test('UC5: deployment-owning Web host closes admission then exact application authority on signals', async () => {
  class Server extends EventEmitter {
    listen(port, host) { this.bound = { port, host }; queueMicrotask(() => this.emit('listening')); }
    address() { return { address: this.bound.host, port: 9443, family: 'IPv4' }; }
    async batonShutdown(options) { this.webStops = (this.webStops ?? 0) + 1; this.webOptions = options; return { ok: true, result: 'closed' }; }
  }
  const calls = [];
  const application = {
    ready: Promise.resolve(),
    async shutdown(value) { calls.push(value); return { schemaVersion: 1, state: 'closed', receipt: { receiptDigest: D } }; },
  };
  const server = new Server();
  const host = new BatonWebHost({
    application, server, shutdownPrincipal: { actor: 'host:test', principalId: 'host', sessionId: 'host-session' },
    listen: { host: '127.0.0.1', port: 0 }, webDrainMs: 5_000,
  });
  const signals = new EventEmitter();
  const serving = host.serve(signals);
  const listening = await host.start();
  assert.equal(listening.state, 'listening');
  signals.emit('SIGTERM');
  const outcome = await serving;
  assert.equal(outcome.trigger.kind, 'SIGTERM');
  assert.equal(outcome.closed.state, 'closed');
  assert.equal(server.webStops, 1);
  assert.deepEqual(server.webOptions, { drainMs: 5_000 });
  assert.equal(calls.length, 1);
  assert.deepEqual(await host.shutdown(), outcome.closed);
  assert.equal(server.webStops, 1);
  assert.equal(calls.length, 1);
});

test('UC5b: repeated process signals remain admitted until abort-aware work and authoritative shutdown both settle', async () => {
  const signals = new EventEmitter();
  let releaseShutdown;
  let shutdownStarted;
  const shutdownGate = new Promise((resolve) => { releaseShutdown = resolve; });
  const started = new Promise((resolve) => { shutdownStarted = resolve; });
  const owner = new SignalLifecycleOwner({
    signalEmitter: signals,
    shutdown: async () => {
      shutdownStarted();
      await shutdownGate;
      return { schemaVersion: 1, state: 'closed' };
    },
  });
  const running = owner.run(async ({ signal }) => {
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return { state: 'interrupted' };
  });
  signals.emit('SIGHUP');
  await started;
  assert.equal(signals.listenerCount('SIGHUP'), 1);
  assert.equal(signals.listenerCount('SIGINT'), 1);
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  signals.emit('SIGHUP');
  signals.emit('SIGINT');
  signals.emit('SIGTERM');
  assert.equal(signals.listenerCount('SIGHUP'), 1);
  assert.equal(signals.listenerCount('SIGINT'), 1);
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  releaseShutdown();
  const outcome = await running;
  assert.equal(outcome.trigger.kind, 'SIGHUP');
  assert.equal(outcome.signalCount, 4);
  assert.equal(outcome.operation.status, 'fulfilled');
  assert.equal(outcome.closed.state, 'closed');
  assert.equal(signals.listenerCount('SIGHUP'), 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('UC6: host still attempts fleet shutdown when Web close degrades and never reports a clean close', async () => {
  class Server extends EventEmitter {
    listen() { queueMicrotask(() => this.emit('listening')); }
    address() { return null; }
    async batonShutdown() { throw Object.assign(new Error('listener close failed'), { code: 'listener_failed' }); }
  }
  let appStops = 0;
  const host = new BatonWebHost({
    application: { ready: Promise.resolve(), async shutdown() { appStops += 1; return { state: 'closed' }; } },
    server: new Server(), shutdownPrincipal: { actor: 'host:test', principalId: 'host', sessionId: 'host-session' },
    listen: { host: '127.0.0.1', port: 0 }, webDrainMs: 5_000,
  });
  await host.start();
  const closed = await host.shutdown();
  assert.equal(closed.state, 'closed_degraded');
  assert.equal(closed.web.code, 'listener_failed');
  assert.equal(appStops, 1);
});
