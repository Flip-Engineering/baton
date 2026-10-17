#!/usr/bin/env node
// Controlled worker ports keep this measurement independent of provider latency.
import assert from 'node:assert/strict';
import { closeSync, fsyncSync, openSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [source, directory, workerCount] = process.argv.slice(2);
const { CoordinationStore } = await import(pathToFileURL(join(source, 'impl/src/coordination-store.mjs')));
const { SwarmRuntime } = await import(pathToFileURL(join(source, 'impl/src/swarm-runtime.mjs')));
let syncs = 0;
const store = new CoordinationStore(directory, {
  syncFile(file) {
    const fd = openSync(file, 'r');
    try { fsyncSync(fd); syncs += 1; } finally { closeSync(fd); }
  },
});
const workers = Array.from({ length: Number(workerCount) }, (_, index) => ({
  id: `w-${index + 1}`, taskId: `t-${index + 1}`, runId: null,
  status: 'working', paused: false, vendor: 'controlled-oneshot',
}));
// Restore the controlled ports from the persisted bindings for replay measurements.
const existing = store.swarms().find((swarm) => swarm.swarmId === 'comparison');
for (const row of Object.values(existing?.participants ?? {})) {
  const binding = row.bindings?.at(-1);
  const worker = workers.find((item) => item.id === binding?.workerId);
  if (worker) worker.runId = binding.runId;
}
const runtime = new SwarmRuntime({
  store,
  coordinator: {
    list: () => workers.filter((row) => row.runId !== null),
    pausedTurns: () => [],
    routeCards: () => [{ name: 'controlled-oneshot', card: {
      verbs: { prompt: 'unsupported', steer: 'unsupported' },
    } }],
    guideParticipant: async () => ({ ok: false, reason: 'Controlled one-shot worker has no active input' }),
  },
  authorize: async () => {},
  prepareRun: async () => {},
  startRun: async (request) => {
    const worker = workers.find((row) => row.runId === null);
    assert.ok(worker);
    assert.equal(store.hasSwarmParticipantRun(request.runId), true);
    worker.runId = request.runId;
  },
  stopRun: async () => { throw new Error('Unexpected stop dispatch'); },
});
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'comparison-root' };
const call = (command, args, principal = owner) => runtime.command(`swarm.${command}`,
  { swarmId: 'comparison', ...args }, principal);
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
send({ ready: true, rss_bytes: process.memoryUsage().rss });

try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const request = JSON.parse(line);
    if (request.op === 'close') break;
    try {
      const before = syncs;
      const started = performance.now();
      let value;
      switch (request.op) {
        case 'setup':
          await call('create', { purpose: 'Compare retained coordination operations', idempotencyKey: 'create' });
          for (let index = 0; index < workers.length; index += 1) {
            await call('recruit', { participantId: `worker-${index}`, objective: 'Controlled benchmark worker',
              idempotencyKey: `recruit-${index}` });
          }
          value = { workers: workers.length };
          break;
        case 'workers':
          value = await call('view', { projection: 'participants' });
          break;
        case 'reports':
          value = await call('view', { projection: 'contributions' });
          break;
        case 'guide':
          value = await call('guide', { participantId: request.worker, message: request.body,
            idempotencyKey: request.id });
          assert.equal(value.guide.delivery.state, 'parked');
          break;
        case 'report': {
          const index = Number(request.worker.split('-').at(-1));
          const worker = workers[index];
          value = await call('update', { event: 'swarm.contribution_recorded',
            idempotencyKey: request.id, payload: { contributionId: request.id,
              participantId: request.worker, body: request.body } },
          { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: worker.id });
          break;
        }
        case 'verify':
          value = { reports: await call('view', { projection: 'contributions' }),
            guides: store.eventsView().filter((event) => event.kind === 'driver.recorded'
              && event.payload?.kind === 'swarm.guidance_parked').map((event) => event.payload),
            events: store.ledgerHeadSeq(), rss_bytes: process.memoryUsage().rss };
          break;
        default:
          throw new Error(`Unknown operation ${request.op}`);
      }
      const returned = performance.now();
      // The default store schedules group fsync with setImmediate. Keep that boundary.
      await new Promise(setImmediate);
      if (store._ledgerSyncFailure) throw new Error(JSON.stringify(store._ledgerSyncFailure));
      const durable = performance.now();
      if (request.op === 'guide' || request.op === 'report') assert.ok(syncs > before);
      const serialized = JSON.stringify(value);
      const metadata = JSON.stringify({ dispatch_ms: returned - started, durable_ms: durable - started,
        fsyncs: syncs - before, result_bytes: Buffer.byteLength(serialized) });
      process.stdout.write(`{"value":${serialized},${metadata.slice(1)}\n`);
    } catch (error) {
      send({ error: { message: error.message, code: error.code, stack: error.stack } });
    }
  }
} finally {
  runtime.close();
  store.releaseWriterLease();
}
