import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BeeBus, planBag } from './index.mjs';
import { BeeMutatorAdapter } from './mutator.mjs';

const dir = await mkdtemp(join(tmpdir(), 'baton-bees-test-'));
const bus = new BeeBus({ dir });
await bus.join('BEE_1', { lane: 'one' });
await bus.join('BEE_2', { lane: 'two' });
await bus.send({ from: 'BEE_1', text: 'hello' });
await bus.send({ from: 'BEE_2', to: 'BEE_1', text: 'direct' });
const received = await bus.recv('BEE_1', { limit: 10 });
assert.equal(received.messages.length, 4);
assert.equal(received.messages.at(-1).text, 'direct');
const status = await bus.status();
assert.equal(status.roles.length, 2);
assert.equal(status.message_count, 4);
const plan = planBag({ count: 5, basePrompt: 'Owned-lab task' });
assert.equal(plan.length, 5);
assert.match(plan[0].prompt, /self-organizing bag of bees/);
const calls = [];
const fakeSandbox = {
  async create(spec) { calls.push(['create', spec]); return { worker_id: spec.worker_id, lease: 'fake' }; },
  async execute(lease, argv) { calls.push(['execute', lease, argv]); return { status: 0 }; },
  async release(lease) { calls.push(['release', lease]); return { ok: true }; },
  async reconcile() { return { ok: true }; }
};
const adapter = new BeeMutatorAdapter({ sandbox: fakeSandbox });
const lease = await adapter.create('BEE_1', { image: 'test' });
await adapter.execute(lease, ['true']);
await adapter.release(lease);
assert.deepEqual(calls.map((entry) => entry[0]), ['create', 'execute', 'release']);
const manifest = JSON.parse(await readFile(new URL('./plugin.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, 'baton-bees');
console.log('baton-bees plugin tests passed');
