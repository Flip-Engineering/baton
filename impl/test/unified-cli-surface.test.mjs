import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ProductionConvergenceRuntime } from '../src/production-convergence.mjs';
import { wrapProductionCliClient } from '../src/production-cli-convergence.mjs';

function fakeClient() {
  return {
    repoId: 'repo',
    origin: 'https://operator.test',
    requestTimeoutMs: 1000,
    commandTimeoutMs: 30_000,
    calls: [],
    web: [],
    async command(name, args) {
      this.calls.push({ name, args });
      if (name === 'runs.list') return { items: [{ runId: 'run:a' }] };
      if (name === 'waves.list') return { waves: [{ waveId: 'wave:a' }] };
      if (name === 'run.follow') return { runId: args.runId, cursor: args.afterCursor + 1, events: [] };
      if (name === 'run.attention.watch') return {
        runId: args.runId,
        afterCursor: args.cursor,
        throughCursor: args.cursor + 2,
        reasons: [{ kind: 'answer_decision', requiredAction: 'answer' }],
      };
      if (name === 'run.inspect') return { runId: args.runId, phase: 'working' };
      if (name === 'waves.progress') return { waveId: args.waveId, phase: 'working' };
      return { name, args };
    },
    async doctor() { return { ready: true, routes: [] }; },
    _headers() { return {}; },
    _requestTimeoutForCommand() { return 1000; },
    async _json(path, options) {
      this.web.push({ path, envelope: JSON.parse(options.body) });
      return { ok: true, result: { source: 'generic-web', command: this.web.at(-1).envelope.command } };
    },
    async reconcile(commandId) { return { commandId, reconciled: true }; },
  };
}

function events(runtime, command) {
  return runtime.journal.events().filter((event) => event.data?.command === command).map((event) => event.type);
}

test('CLI surfaceInvoke preserves direct application commands and durable effect fate', async () => {
  const raw = fakeClient();
  const runtime = new ProductionConvergenceRuntime();
  const client = wrapProductionCliClient(raw, { runtime });
  const result = await client.surfaceInvoke('run.message.send', {
    runId: 'run:a', kind: 'inform', body: 'hello',
  }, 'surface:direct');
  assert.equal(result.name, 'run.message.send');
  assert.deepEqual(events(runtime, 'run.message.send'), [
    'command.admitted', 'effect.requested', 'effect.succeeded',
  ]);
});

test('CLI generic invocation resolves exact canonical names before compatibility aliases', async () => {
  const raw = fakeClient();
  const client = wrapProductionCliClient(raw, { runtime: new ProductionConvergenceRuntime() });
  const result = await client.surfaceInvoke('run.status', { runId: 'run:a' }, 'surface:status');
  assert.equal(result.name, 'run.status');
  assert.deepEqual(raw.calls.at(-1), { name: 'run.status', args: { runId: 'run:a' } });
});

test('existing bounded run.debug projection is live through the connected CLI', async () => {
  const raw = fakeClient();
  const client = wrapProductionCliClient(raw, { runtime: new ProductionConvergenceRuntime() });
  const result = await client.surfaceInvoke('run.debug', {
    runId: 'run:a', member: 'reviewer', limit: 3,
  }, 'surface:debug');
  assert.equal(result.name, 'run.debug');
  assert.deepEqual(raw.calls.at(-1), {
    name: 'run.debug', args: { runId: 'run:a', member: 'reviewer', limit: 3 },
  });
  assert.equal(raw.web.length, 0);
});

test('CLI surfaceSnapshot combines monitoring and optional run/wave projections', async () => {
  const client = wrapProductionCliClient(fakeClient(), { runtime: new ProductionConvergenceRuntime() });
  const snapshot = await client.surfaceSnapshot({ runId: 'run:a', waveId: 'wave:a' });
  assert.equal(snapshot.schemaVersion, 2);
  assert.deepEqual(snapshot.nameClosure.unresolved, []);
  for (const key of ['doctor', 'runs', 'waves', 'run', 'wave']) assert.equal(snapshot[key].ok, true);
  assert.equal(snapshot.source, 'cli_authenticated_web');
});

test('CLI surfaceWatch composes existing follow, attention, run and wave projections', async () => {
  const raw = fakeClient();
  const client = wrapProductionCliClient(raw, { runtime: new ProductionConvergenceRuntime() });
  const page = await client.surfaceWatch({
    runId: 'run:a', waveId: 'wave:a', afterCursor: 4, attentionCursor: 7,
    kind: 'answer_decision', timeoutMs: 1000,
  });
  assert.equal(page.kind, 'baton.surface_watch');
  assert.equal(page.nextAfterCursor, 5);
  assert.equal(page.nextAttentionCursor, 9);
  assert.equal(page.attention.ok, true);
  assert.equal(page.run.ok, true);
  assert.equal(page.wave.ok, true);
  assert.deepEqual(page.decisions.reasons, [
    { kind: 'answer_decision', requiredAction: 'answer' },
  ]);
  assert.deepEqual(raw.calls.map((call) => call.name), [
    'run.follow', 'run.attention.watch', 'run.inspect', 'waves.progress',
  ]);
});

test('CLI surfaceWatch refuses an attention cursor rewind instead of reporting empty success', async () => {
  const raw = fakeClient();
  const original = raw.command;
  raw.command = async function command(name, args) {
    if (name === 'run.attention.watch') return {
      runId: args.runId, afterCursor: 0, throughCursor: 0, reasons: [],
    };
    return original.call(this, name, args);
  };
  const client = wrapProductionCliClient(raw, { runtime: new ProductionConvergenceRuntime() });
  await assert.rejects(
    client.surfaceWatch({ runId: 'run:a', attentionCursor: 8, timeoutMs: 1000 }),
    (error) => error.code === 'attention_scope_forbidden'
      && error.detail.requestedCursor === 8 && error.detail.throughCursor === 0,
  );
});
