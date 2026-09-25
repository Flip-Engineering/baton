import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProductionConvergenceRuntime } from '../src/production-convergence.mjs';
import { wrapProductionCliClient } from '../src/production-cli-convergence.mjs';

const types = (runtime, command) => runtime.journal.events()
  .filter((event) => event.data?.command === command).map((event) => event.type);

test('connected CLI converges at the generic command seam instead of a hand-picked method list', async () => {
  const raw = {
    calls: [],
    async command(name, args, idempotencyKey) {
      this.calls.push({ name, args, idempotencyKey });
      return { ok: true, name };
    },
    async doctor() { return { ready: true }; },
  };
  const runtime = new ProductionConvergenceRuntime();
  const client = wrapProductionCliClient(raw, { runtime });
  assert.deepEqual(await client.command('run.message.send', {
    runId: 'run:a', kind: 'inform', body: 'hello',
  }, 'idem:a'), { ok: true, name: 'run.message.send' });
  assert.deepEqual(types(runtime, 'run.message.send'), [
    'command.admitted', 'effect.requested', 'effect.succeeded',
  ]);
  assert.deepEqual(await client.doctor(), { ready: true });
});

test('connected CLI observations stay transparent while effect failures keep typed fate', async () => {
  const raw = {
    async command(name) {
      if (name === 'run.message.receipt') return { delivered: true };
      throw Object.assign(new Error('blocked'), { code: 'application_unauthorized', detail: { field: 'runId' } });
    },
  };
  const runtime = new ProductionConvergenceRuntime();
  const client = wrapProductionCliClient(raw, { runtime });
  assert.deepEqual(await client.command('run.message.receipt', { messageId: `message:${'a'.repeat(64)}` }), { delivered: true });
  assert.deepEqual(types(runtime, 'run.message.receipt'), []);
  await assert.rejects(client.command('run.message.send', { runId: 'run:b', kind: 'inform', body: 'x' }), /blocked/u);
  assert.deepEqual(types(runtime, 'run.message.send'), [
    'command.admitted', 'effect.requested', 'effect.failed',
  ]);
});
