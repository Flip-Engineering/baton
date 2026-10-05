// Composition fixture: binds this lane's production modules to the actual
// CDP production modules (semantic-impl-cdp's cdp-refs, cdp-counter and the
// composed adapter session). The CDP files are owned by the CDP lane and are
// never duplicated here; when synthesis composes the lanes into one tree the
// imports below resolve and this fixture runs for real. Absence skips
// explicitly with the missing file names - it never passes silently and
// never substitutes a re-implementation.
//
// Production composition, not manual protocol driving: the debuggee endpoint
// comes from the retained harness launcher (raw exploration stays in
// cdp-fixture.test.mjs), and everything after that is session-owned - launch
// through session.execute with the controlRuntime effect, reads through
// session.send gated by session.admitRef on the canonical ref text, live
// counters and stop liveness from session.snapshot(), evaluation through
// session.execute('evaluate', ...) so the mutation generation advance is
// session-owned, resume through session.execute('resume-step', ...), and the
// same-epoch binding samples session.snapshot() before and after every read
// and at publication. No counter is incremented by hand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { admissionOutcome, createCaptureBinding, captureScopes, runtimeEvidence } from '../../context/runtime/observations.mjs';
import { expansionPayload } from '../../context/runtime/values.mjs';
import { launchDebuggee, finish, retain } from './cdp-helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CDP_DIR = join(HERE, '..', '..', 'context', 'runtime');
const REQUIRED = ['cdp-refs.mjs', 'cdp-counter.mjs', 'cdp-session.mjs'];

async function loadProduction() {
  const missing = REQUIRED.filter((file) => !existsSync(join(CDP_DIR, file)));
  if (missing.length > 0) return { missing };
  const refs = await import(pathToFileURL(join(CDP_DIR, 'cdp-refs.mjs')).href);
  const counter = await import(pathToFileURL(join(CDP_DIR, 'cdp-counter.mjs')).href);
  const sessionModule = await import(pathToFileURL(join(CDP_DIR, 'cdp-session.mjs')).href);
  return { refs, counter, sessionModule, missing: [] };
}

test('production admission gates access and the assembly refuses across counter advances', async (t) => {
  const production = await loadProduction();
  if (production.missing.length > 0) {
    t.skip(`cdp production modules absent: ${production.missing.join(', ')}; composition runs after lane composition`);
    return;
  }
  const { refs, counter } = production;
  assert.equal(counter.INITIAL_COUNTER, '0');

  const identity = {
    runtime: 'rt:composition',
    adapter: '0',
    thread: 'main:0',
    epoch: counter.INITIAL_COUNTER,
    mutationGeneration: counter.INITIAL_COUNTER,
    kind: 'object',
    handle: 'obj-1',
  };
  const ref = refs.encodeRefId(refs.refIdentity(identity));
  const liveStart = { runtime: identity.runtime, adapter: identity.adapter, epoch: identity.epoch, mutationGeneration: identity.mutationGeneration };
  let live = { ...liveStart };
  const liveNow = () => live;

  const admitted = admissionOutcome(refs.admitRef(ref, liveNow()), { requireAdmittedRef: refs.requireAdmittedRef });
  assert.equal(admitted.admitted, true);
  assert.equal(staleRefRefusal(refs.admitRef(ref, liveNow()), { requireAdmittedRef: refs.requireAdmittedRef }), null);

  // The session-owned mutation advance: earlier refs refuse
  // refRetiredByMutation before any backend access.
  live = { ...live, mutationGeneration: counter.counterNext(liveStart.mutationGeneration).value };
  const retired = admissionOutcome(refs.admitRef(ref, liveNow()), { requireAdmittedRef: refs.requireAdmittedRef });
  assert.equal(retired.admitted, false);
  assert.equal(retired.refused, true);
  assert.equal(retired.condition, 'refRetiredByMutation');

  // The session-owned epoch advance: earlier refs refuse staleReference.
  live = { ...liveStart, epoch: counter.counterNext(liveStart.epoch).value };
  const stale = admissionOutcome(refs.admitRef(ref, liveNow()), { requireAdmittedRef: refs.requireAdmittedRef });
  assert.equal(stale.admitted, false);
  assert.equal(stale.condition, 'staleReference');

  // The binding samples the live record through the injected sampler at
  // every call; a change across reads is named, never asserted away.
  live = { ...liveStart };
  const binding = createCaptureBinding({ admitRef: refs.admitRef, ref, liveNow });
  assert.equal(binding.sample().admitted, true);
  live = { ...live, mutationGeneration: counter.counterNext(liveStart.mutationGeneration).value };
  const changed = binding.sample();
  assert.equal(changed.admitted, false);
  assert.equal(changed.condition, 'refRetiredByMutation');

  // The awaited acquisition: identity changes across the read ->
  // changedDuringCapture at stage afterRead with the raw record retained as
  // pre-change evidence and the admitted prefix listed.
  live = { ...liveStart };
  const changedCapture = await captureScopes({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-9' } }],
    identity: null,
    loadScope: async () => {
      live = { ...live, mutationGeneration: counter.counterNext(live.mutationGeneration).value };
      return { result: [], internalProperties: [] };
    },
    binding: createCaptureBinding({ admitRef: refs.admitRef, ref, liveNow }),
  });
  assert.equal(changedCapture.condition, 'changedDuringCapture');
  assert.equal(changedCapture.stage, 'afterRead');
  assert.equal(changedCapture.refusal.condition, 'refRetiredByMutation');
  assert.deepEqual(changedCapture.changedRecord, { result: [], internalProperties: [] });
  assert.deepEqual(changedCapture.scopes, []);

  // A fully admitted capture returns the scopes and the acquired records;
  // summary rendering consumes those records without authorizing any read.
  live = { ...liveStart };
  const settled = await captureScopes({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-9' } }],
    identity: null,
    loadScope: async () => ({ result: [{ name: 'a', value: { type: 'number', value: 1, description: '1' } }], internalProperties: [] }),
    binding: createCaptureBinding({ admitRef: refs.admitRef, ref, liveNow }),
  });
  assert.equal(settled.condition, undefined);
  assert.equal(settled.scopes.length, 1);
  assert.equal(settled.scopes[0].expansion.complete, true);
  assert.ok(settled.records instanceof Map);
  assert.equal(settled.records.size, 1);
  const { scopeSummaries } = await import('../../context/runtime/observations.mjs');
  const rendered = scopeSummaries({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-9' } }],
    records: settled.records,
  });
  assert.equal(rendered.scopes[0].expansion.complete, true);

  retain('composition-unit', { identity, ref, admitted: admitted.identity !== undefined, retired, stale });
});

test('same-epoch assembly over a real debuggee through the production session', async (t) => {
  const production = await loadProduction();
  if (production.missing.length > 0) {
    t.skip(`cdp production modules absent: ${production.missing.join(', ')}; composition runs after lane composition`);
    return;
  }
  const { refs, sessionModule } = production;
  const runtime = 'rt:composition-fixture';
  const app = join(HERE, 'fixtures', 'fixture-app.mjs');

  // The retained harness launcher supplies the endpoint; everything after
  // this line is the production session.
  const run = launchDebuggee(app);
  const webSocketUrl = await run.endpoint;
  const session = sessionModule.createAdapterSession({
    runtime,
    adapter: '0',
    role: 'adapter',
    incarnation: '0',
    sequence: '0',
    targetPid: run.child.pid,
  });

  let pausedParams = null;
  let pausedSeq = 0;
  session.subscribe('Debugger.paused', (msg) => {
    pausedParams = msg.params;
    pausedSeq += 1;
  });

  const launch = await session.execute('launch', {
    effects: ['controlRuntime'],
    webSocketUrl,
    program: app,
    args: [],
    env: { PATH: '/usr/bin:/bin', HOME: tmpdir() },
    onOwnerStop: 'terminate',
  });
  assert.ok(launch, 'launch acknowledged');
  for (let i = 0; i < 200 && pausedParams === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(pausedParams, 'the initial stop arrived through the session subscription');
  const snapshotAtStop = session.snapshot();
  assert.equal(snapshotAtStop.epoch !== undefined && snapshotAtStop.mutationGeneration !== undefined, true, 'snapshot exposes the session-owned counter strings');
  const liveness = snapshotAtStop.lastPause ? snapshotAtStop.lastPause.liveness : null;
  assert.equal(liveness, 'live', 'the recorded stop is live');

  const frame0 = pausedParams.callFrames[0];
  const globalScope = frame0.scopeChain.find((scope) => scope.object && scope.object.objectId);
  const identity = {
    runtime,
    adapter: '0',
    thread: 'main:0',
    epoch: snapshotAtStop.epoch,
    mutationGeneration: snapshotAtStop.mutationGeneration,
    kind: 'object',
    handle: globalScope.object.objectId,
  };
  const ref = refs.encodeRefId(refs.refIdentity(identity));
  const liveNow = () => liveFromSnapshot(runtime, session.snapshot());
  const binding = createCaptureBinding({ admitRef: (candidate) => session.admitRef(candidate), ref, liveNow });
  assert.equal(binding.sample().admitted, true, 'the live stop admits the capture ref');

  // Reads are gated on session.admitRef and carried by session.send.
  const gatedSend = async (method, params, refText) => {
    const decision = session.admitRef(refText);
    const outcome = admissionOutcome(decision);
    if (!outcome.admitted) return { condition: outcome.condition };
    return session.send({ query: 'composition', method, params });
  };
  const globalProps = await gatedSend('Runtime.getProperties', { objectId: globalScope.object.objectId }, ref);
  assert.equal(globalProps.condition, undefined);
  const handleDescriptor = globalProps.result.find((descriptor) => descriptor.value && descriptor.value.objectId);
  assert.ok(handleDescriptor, 'the global scope exposes an expandable object');
  const payload = expansionPayload(handleDescriptor, identity);

  // The awaited scope capture through the production session and admission.
  const scopeResponses = new Map();
  const capture = await captureScopes({
    scopeChain: frame0.scopeChain,
    identity,
    loadScope: async (scope) => {
      if (!scope.object || !scope.object.objectId) return { result: [], internalProperties: [] };
      const scopeRef = refs.encodeRefId(refs.refIdentity({ ...identity, kind: 'object', handle: scope.object.objectId }));
      const decision = session.admitRef(scopeRef);
      if (!admissionOutcome(decision).admitted) return { condition: admissionOutcome(decision).condition };
      const response = await session.send({ query: 'composition', method: 'Runtime.getProperties', params: { objectId: scope.object.objectId, generatePreview: true, ownAndAccessorProperties: true } });
      scopeResponses.set(scope, response);
      return response;
    },
    binding: createCaptureBinding({ admitRef: (candidate) => session.admitRef(candidate), ref, liveNow }),
  });
  assert.equal(capture.condition, undefined, 'the capture completed inside one live epoch');
  assert.ok(capture.scopes.length >= 1);
  assert.equal(capture.records instanceof Map, true);

  // The explicit evaluation advances the session-owned mutation generation;
  // the capture ref now refuses before any backend access.
  await session.execute('evaluate', { effects: ['controlRuntime', 'evaluateRuntime'], expression: '1 + 1', frame: frame0.callFrameId });
  const afterEvaluate = liveFromSnapshot(runtime, session.snapshot());
  assert.notEqual(afterEvaluate.mutationGeneration, identity.mutationGeneration, 'session-owned mutation generation advanced');
  const retired = binding.sample();
  assert.equal(retired.admitted, false);
  assert.equal(retired.condition, 'refRetiredByMutation');

  // Resume advances the epoch; the earlier refs refuse staleReference.
  const secondStop = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 10000);
    session.subscribe('Debugger.paused', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
  await secondStop;
  const afterResume = liveFromSnapshot(runtime, session.snapshot());
  assert.notEqual(afterResume.epoch, identity.epoch, 'session-owned epoch advanced');
  assert.equal(binding.sample().condition, 'staleReference');

  // Release terminates the owned child; the closure evidence is retained.
  await session.execute('release', { effects: ['controlRuntime'], onRelease: 'terminate', signal: 'SIGKILL' });
  const closure = await finish(run);
  if (typeof session.close === 'function') session.close();
  retain('composition-debuggee', {
    runtimeEvidence: runtimeEvidence({ runtime, epoch: identity.epoch, thread: 'main:0', script: frame0.location?.scriptId ?? null, generated: null, original: null }),
    payload,
    capture: { scopes: capture.scopes.length, records: capture.records.size },
    afterEvaluate,
    afterResume,
    exit: closure.exit,
  });
  assert.equal(closure.exit.spawnError, null);
});

function liveFromSnapshot(runtime, snapshot) {
  return {
    runtime,
    adapter: '0',
    epoch: snapshot.epoch,
    mutationGeneration: snapshot.mutationGeneration,
    lastPause: snapshot.lastPause ?? null,
  };
}
