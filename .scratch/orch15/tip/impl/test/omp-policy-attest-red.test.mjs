import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// #236 red pin — the omp worker-policy observation contract. Measured 2026-08-15 (live
// re-probe on the deafness-fixed resident): the un-deafened coordinator immediately
// surfaced what deafness had hidden — omp members fail-and-kill at spawn with
// worker_policy.mismatch / required_observation_missing. The #230 card ADVERTISES the
// worker policy (unattended/full/private_runtime, observation: 'launch'), and the
// coordinator therefore requires the launch attestation; claude-session attests at spawn
// (claude-session.mjs:749-757 via attestWorkerPolicyObservation) — OmpRpcCli.spawn ignores
// its opts.workerPolicy entirely and never emits worker_policy.observed.
//
// RED   = spawn() emits no worker_policy.observed (the member is fail-and-killed).
// GREEN = spawn() attests the launch observation like every sibling CLI: the emitted event
//         carries the attested axes and process coordinates.

test('OMP-POLICY-ATTEST: spawn() emits worker_policy.observed when a policy resolution rides the dispatch', async () => {
  const writes = [];
  const makeChild = () => ({
    pid: 4242,
    stdin: { write: (chunk) => { writes.push(chunk); } },
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {},
    on: () => {},
    once: () => {},
  });
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 5_000,
    model: 'deepseek/deepseek-v4-flash',
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['high'] },
    ceiling: 1,
    versionProbe: () => 'omp test',
    spawnFn: () => {
      const child = makeChild();
      setImmediate(() => { child.stdout.write(`${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`); });
      return child;
    },
  });
  const events = [];
  adapter.onEvent((e) => events.push(e));
  const { resolveWorkerPolicy, DEFAULT_WORKER_POLICY_REQUEST } = await import('../src/worker-policy.mjs');
  const resolution = resolveWorkerPolicy(DEFAULT_WORKER_POLICY_REQUEST, {
    schemaVersion: 1,
    autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'launch', mechanisms: ['permission-mode-yolo'] },
    access: { supported: ['full'], default: 'full', perTask: false, observation: 'launch', mechanisms: ['omp-unsandboxed-permissions'] },
    containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: ['worktree-cwd'], observation: 'unavailable' },
  });
  const ack = await adapter.spawn('w-pin', { goal: 'attest the launch policy' }, {
    worktree: '/tmp',
    model: 'deepseek/deepseek-v4-flash',
    reasoningEffort: 'high',
    workerPolicy: resolution,
  });
  assert.equal(ack.ok, true, `spawn must succeed (got ${JSON.stringify(ack).slice(0, 120)})`);
  const observed = events.filter((e) => e.kind === 'worker_policy.observed');
  assert.equal(observed.length, 1, `exactly one worker_policy.observed event (got ${observed.length})`);
  assert.equal(observed[0].payload?.workerPolicyObserved?.autonomy?.observed, 'unattended', 'the attested autonomy axis rides the event');
  assert.equal(observed[0].payload?.workerPolicyObserved?.access?.observed, 'full', 'the attested access axis rides the event');
  assert.equal(observed[0].payload?.pid, 4242, 'the attestation is process-bound');
});
