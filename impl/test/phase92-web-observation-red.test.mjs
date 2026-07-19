// Phase 92 RED contracts for responsive authenticated observations. These are transport fixtures,
// not live-provider evidence and not operating-system PID-liveness proof.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound,
} from '../src/index.mjs';

const root = (t) => {
  const value = mkdtempSync(join(tmpdir(), 'baton-phase92-web-'));
  t.after(() => rmSync(value, { recursive: true, force: true }));
  return value;
};
const card = () => ({
  schemaVersion: 1, repoId: 'repo-phase92', commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
});
const principal = (overrides = {}) => ({
  userId: 'operator', sessionId: 'session', credentialId: 'credential', authMethod: 'cookie',
  csrfToken: 'csrf', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  capabilities: ['observe', 'emergency_stop'], repoIds: ['repo-phase92'], ...overrides,
});
const context = (principalOverrides = {}) => ({
  principal: principal(principalOverrides), origin: 'https://phase92.example.test', csrfToken: 'csrf',
  remoteAddress: '127.0.0.1', transport: 'https',
});
const envelope = (command, args, suffix) => ({
  schemaVersion: 1, commandId: `command-${suffix}`, idempotencyKey: `idem-${suffix}`,
  command, args, repoId: 'repo-phase92', runId: args.runId ?? null,
  origin: 'https://phase92.example.test',
});

test('P92-WB1: successful authenticated read commands singleflight without growing the coordination ledger', async (t) => {
  let dispatches = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const application = {
    repoId: 'repo-phase92', card, async authorizeReplay() { return true; },
    async command(name, args) {
      dispatches += 1;
      if (name === 'run.status') await blocked;
      return { schemaVersion: 1, runId: args.runId, phase: 'running' };
    },
  };
  const coordination = new CoordinationStore(root(t));
  const web = new WebNorthbound({
    coordinator: {}, coordination, application, repoIds: ['repo-phase92'],
    allowedOrigins: ['https://phase92.example.test'],
    now: () => Date.parse('2026-07-19T12:00:00.000Z'),
  });
  const request = envelope('run_status', { runId: 'run-phase92' }, 'status');
  const before = coordination.snapshot().lastSeq;
  const first = web.execute(context(), request);
  const second = web.execute(context(), { ...request, commandId: 'command-status-retry' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dispatches, 1);
  assert.equal(coordination.snapshot().lastSeq, before);
  release();
  assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200]);
  assert.equal(coordination.snapshot().lastSeq, before);
  assert.equal(coordination.events().some((event) => event.kind.startsWith('web.command_')), false);
});

test('P92-WB2: inspect and stop remain responsive while a status projection is blocked', async (t) => {
  let releaseStatus;
  let enteredStatus;
  const blocked = new Promise((resolve) => { releaseStatus = resolve; });
  const entered = new Promise((resolve) => { enteredStatus = resolve; });
  const application = {
    repoId: 'repo-phase92', card, async authorizeReplay() { return true; },
    async command(name, args) {
      if (name === 'run.status') { enteredStatus(); await blocked; }
      return { schemaVersion: 1, runId: args.runId, phase: name === 'run.stop' ? 'stopped' : 'running' };
    },
  };
  const coordination = new CoordinationStore(root(t));
  const web = new WebNorthbound({
    coordinator: {}, coordination, application, repoIds: ['repo-phase92'],
    allowedOrigins: ['https://phase92.example.test'],
    now: () => Date.parse('2026-07-19T12:00:00.000Z'),
  });
  const status = web.execute(context(), envelope('run_status', { runId: 'run-phase92' }, 'blocked'));
  await entered;
  const inspection = await web.execute(context(), envelope('run_inspect', {
    runId: 'run-phase92', depth: 'outline',
  }, 'inspect'));
  assert.equal(inspection.status, 200);
  const stopped = await web.execute(context(), envelope('run_stop', {
    runId: 'run-phase92', reason: 'Operator requested Run stop.',
  }, 'stop'));
  assert.equal(stopped.status, 200);
  assert.equal(coordination.events().filter((event) => event.kind.startsWith('web.command_')).length, 2,
    'only the state-changing stop has durable admission/completion');
  releaseStatus();
  assert.equal((await status).status, 200);
});

test('P92-WB3: authenticated Web round-trips Episode continuation and exact generation controls', async (t) => {
  const calls = [];
  const application = {
    repoId: 'repo-phase92', card, async authorizeReplay() { return true; },
    async command(name, args) {
      calls.push({ name, args });
      return { schemaVersion: 1, operation: name, continuation: name === 'run.episode' ? {
        operation: 'run.episode', arguments: { ...args, pageCursor: 'next_page' },
      } : null };
    },
  };
  const coordination = new CoordinationStore(root(t));
  const web = new WebNorthbound({
    coordinator: {}, coordination, application, repoIds: ['repo-phase92'],
    allowedOrigins: ['https://phase92.example.test'],
    now: () => Date.parse('2026-07-19T12:00:00.000Z'),
  });
  const before = coordination.snapshot().lastSeq;
  const episode = await web.execute(context(), envelope('run_episode', {
    runId: 'run-phase92', topic: 'output', detail: 'content', role: 'reviewer',
    generation: 2, pageCursor: 'page_1', cursor: 7, waitMs: 5,
  }, 'episode'));
  assert.equal(episode.status, 200);
  assert.deepEqual(calls.at(-1), { name: 'run.episode', args: {
    runId: 'run-phase92', topic: 'output', detail: 'content', role: 'reviewer',
    generation: 2, pageCursor: 'page_1', cursor: 7, waitMs: 5,
  } });
  const streams = await web.execute(context(), envelope('run_workstreams', {
    runId: 'run-phase92', role: 'reviewer', generation: 2,
  }, 'streams'));
  assert.equal(streams.status, 200);
  assert.equal(coordination.snapshot().lastSeq, before,
    'authenticated Episode and workstream observations do not amplify the durable ledger');
  const control = { capabilities: ['observe', 'control', 'emergency_stop'] };
  assert.equal((await web.execute(context(control), envelope('run_workstream_notify', {
    runId: 'run-phase92', role: 'reviewer', generation: 2,
    message: 'Check this exact generation.', delivery: 'turn',
  }, 'notify'))).status, 200);
  assert.equal((await web.execute(context(control), envelope('run_workstream_stop', {
    runId: 'run-phase92', role: 'reviewer', generation: 2,
  }, 'member-stop'))).status, 200);
  assert.deepEqual(calls.slice(-2).map(({ name, args }) => [name, args.generation]), [
    ['run.workstream.notify', 2], ['run.workstream.stop', 2],
  ]);
});
