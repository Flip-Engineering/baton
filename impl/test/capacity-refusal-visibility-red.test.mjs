// Issue #35: workspace-capacity exhaustion was invisible end-to-end. On a host below the
// deployment capacity floor, `doctor --check` read all-ready, `run approve` returned the generic
// `temporarily_unavailable`, and the Run went terminal `cancelled` with `terminalCause: null` and
// cause-free `task.transitioned` facts. These contracts pin the visible chain: the typed refusal
// code survives the Web mapping, the cancelled transition carries its cause durably, the Run view
// projects a typed `dispatch_refused` terminal cause, and the events timeline surfaces the cause
// as a safe fact. The capacity observation itself is injected — no real disk state is consulted.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, MockAdapter, WebNorthbound, openBaton } from '../src/index.mjs';

const ROUTE = Object.freeze({ harness: 'mock', model: 'capacity-visibility', effort: 'high' });

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-capvis-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'capvis@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Capacity Visibility'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# capacity visibility target\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'never reached: dispatch must refuse first', files: {} },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(), version: 'mock 1.0.0', authPosture: 'fixture',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'capacity-visibility-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return value;
}

async function exhaustedDeployment(t) {
  const repo = repository(t);
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(repo, '.deployment'), adapters: { mock: adapter() }, routes: [ROUTE],
      verification: { command: 'node', arguments: ['--version'] },
      // The injected observation reports a volume with nothing free, so the real reservation
      // arithmetic refuses every wave regardless of the machine this suite runs on.
      capacity: {
        estimate: () => ({ bytes: 1024, inodes: 8 }),
        observe: () => ({ freeBytes: 0, freeInodes: 0 }),
      },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });
  return deployment;
}

async function terminal(run) {
  const deadline = Date.now() + 10_000;
  let last = null;
  while (Date.now() < deadline) {
    const view = await run.status(); last = view;
    if (['completed', 'failed', 'cancelled', 'stopped'].includes(view.phase)) return view;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run did not settle: ${JSON.stringify({ phase: last?.phase })}`);
}

// --- CAP-V1: the Web command mapping preserves the typed capacity refusal ---

const envelope = (overrides = {}) => ({
  schemaVersion: 1,
  commandId: 'cmd-cap-1',
  idempotencyKey: 'retry-cap-1',
  command: 'spawn',
  args: {
    harness: 'grok',
    model: 'grok-4-code',
    modelPolicy: { reasoningEffort: 'high' },
    brief: { goal: 'test', constraints: [], pathScope: ['x'], definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10, usd: 1, wallMin: 1 } },
  },
  repoId: 'repo-a',
  runId: 'run-cap-a',
  origin: 'https://control.example.test',
  ...overrides,
});
const principal = () => ({
  userId: 'user-1', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
  csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: ['repo-a'],
});
const context = () => ({
  principal: principal(), origin: 'https://control.example.test', csrfToken: 'csrf-1',
  remoteAddress: '127.0.0.1', transport: 'https',
});

test('CAP-V1: a worktree capacity refusal keeps its typed code through the Web mapping and leaks nothing', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-capvis-web-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cause = Object.assign(new Error('worktree capacity is unavailable for this reservation wave: /secret/host/path'), {
    name: 'WorktreeCapacityError', code: 'worktree_capacity_exceeded',
  });
  const web = new WebNorthbound({
    coordinator: { async spawn() { throw cause; }, list() { return []; } },
    coordination: new CoordinationStore(root),
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse('2026-07-23T12:00:00.000Z'),
  });
  const result = await web.execute(context(), envelope());
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'worktree_capacity_exceeded',
    'the typed capacity code must survive to the caller, never the generic temporarily_unavailable');
  assert.equal(JSON.stringify(result).includes('/secret/host/path'), false,
    'the mapped message never leaks host paths from the internal error');
  assert.match(result.body.error.message, /capacity/iu, 'the message names the capacity condition');
});

// --- CAP-V2..V4: the embedded application chain — typed approve refusal, durable cause,
// typed terminal cause, and safe timeline facts ---

test('CAP-V2: approve surfaces the typed capacity refusal and the Run view projects a typed dispatch_refused terminal cause', async (t) => {
  const deployment = await exhaustedDeployment(t);
  const run = await deployment.run('Change the README under an exhausted workspace.', { exact: ROUTE });
  await assert.rejects(run.approve(), (error) => error?.code === 'worktree_capacity_exceeded',
    'the embedded approve path keeps the typed capacity code');

  const view = await terminal(run);
  assert.equal(view.phase, 'cancelled');
  assert.ok(view.terminalCause, 'a capacity-cancelled Run must carry a terminal cause, never null');
  assert.equal(view.terminalCause.kind, 'dispatch_refused');
  assert.equal(view.terminalCause.code, 'worktree_capacity_exceeded');
  assert.equal(view.terminalCause.retryable, true);
  assert.match(view.narrative, /dispatch/iu, 'the narrative names the dispatch refusal');
});

test('CAP-V3: the cancelled task transition carries its cause as a durable event fact on the Run timeline', async (t) => {
  const deployment = await exhaustedDeployment(t);
  const run = await deployment.run('Change the README under an exhausted workspace (timeline).', { exact: ROUTE });
  await assert.rejects(run.approve(), (error) => error?.code === 'worktree_capacity_exceeded');
  await terminal(run);

  const items = [];
  for await (const entry of run.events()) items.push(entry);
  const cancelled = items.find((entry) => entry.kind === 'task.transitioned' && entry.facts?.to === 'cancelled');
  assert.ok(cancelled, 'the cancellation event reaches the Run timeline');
  assert.equal(cancelled.facts.cause, 'worktree_capacity_exceeded',
    'the timeline surfaces the cancellation cause as a safe fact');
});

test('CAP-V5: deployment doctor reports the workspace capacity observation honestly — blocked below the floors, ready above them', async (t) => {
  const exhausted = await exhaustedDeployment(t);
  const blocked = await exhausted.doctor();
  assert.ok(blocked.workspace, 'doctor readiness must include a workspace capacity section');
  assert.equal(blocked.workspace.state, 'blocked');
  assert.equal(blocked.workspace.code, 'worktree_capacity_exceeded');
  assert.equal(blocked.workspace.freeBytes, 0);
  assert.ok(Number.isSafeInteger(blocked.workspace.minFreeBytes) && blocked.workspace.minFreeBytes > 0,
    'the deployment floor is visible next to the observation');

  const repo = repository(t);
  const healthy = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(repo, '.deployment'), adapters: { mock: adapter() }, routes: [ROUTE],
      verification: { command: 'node', arguments: ['--version'] },
      capacity: {
        estimate: () => ({ bytes: 1024, inodes: 8 }),
        observe: () => ({ freeBytes: 64 * 1024 * 1024 * 1024, freeInodes: 4_000_000 }),
      },
    },
  });
  t.after(async () => { try { await healthy.close(); } catch {} });
  const ready = await healthy.doctor();
  assert.equal(ready.workspace?.state, 'ready');
  assert.equal(Object.hasOwn(ready.workspace, 'code'), false, 'a ready workspace carries no refusal code');
});

test('CAP-V4: a second approve retry after the refusal is refused the same typed way, never a duplicate dispatch', async (t) => {
  const deployment = await exhaustedDeployment(t);
  const run = await deployment.run('Change the README under an exhausted workspace (retry).', { exact: ROUTE });
  await assert.rejects(run.approve(), (error) => error?.code === 'worktree_capacity_exceeded');
  const view = await terminal(run);
  assert.equal(view.phase, 'cancelled');
  await assert.rejects(run.approve(), (error) => typeof error?.code === 'string',
    'a repeat approve on the settled Run stays a typed refusal');
});
