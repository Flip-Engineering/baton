// Composition fixture: binds this lane's production modules to the actual
// CDP production modules (semantic-impl-cdp's cdp-refs, cdp-counter and the
// composed adapter session). The CDP files are owned by the CDP lane and are
// never duplicated here; when synthesis composes the lanes into one tree the
// imports below resolve and the executed test runs for real. Absence skips
// explicitly with the missing file names, retained as a skip record
// separately from any execution result - it never passes silently and never
// substitutes a re-implementation.
//
// The first test is MODULE COMPOSITION with manually advanced counters: it
// exercises the module-level admission and the sampled acquisition over
// counters advanced by the production counter module, not by a live session.
// The second test drives the production adapter session: launch/evaluate/
// resume-step/release through session.execute intents, reads through
// session.send gated by session.admitRef synchronously before each send, the
// injected production requireAdmittedRef forwarded through the binding and
// every gated read, live counters and stop liveness from session.snapshot(),
// and the sampled binding over that live session. No counter is incremented
// by hand in the session test.
//
// Resource closure: every line after launchDebuggee runs inside try/finally;
// the finally performs bounded owned-child termination and reaping, session
// closure, and full raw evidence retention even on assertion or API failure.
// The release control is explicitly fixture-owned for the child this harness
// created - a truthful bounded scope that makes no keeper-custody claim.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { admissionOutcome, createCaptureBinding, captureScopes, scopeSummaries, runtimeEvidence } from '../../context/runtime/observations.mjs';
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

function liveFromSnapshot(runtime, snapshot) {
  return {
    runtime,
    adapter: '0',
    epoch: snapshot.epoch,
    mutationGeneration: snapshot.mutationGeneration,
    lastPause: snapshot.lastPause ?? null,
  };
}

test('module composition with manually advanced counters: unit-level production normalizer and sampled acquisition', async (t) => {
  const production = await loadProduction();
  if (production.missing.length > 0) {
    retain('composition-skip', { test: 'module-composition', missing: production.missing, kind: 'missing-modules' });
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
  const normalize = { requireAdmittedRef: refs.requireAdmittedRef };

  const admitted = admissionOutcome(refs.admitRef(ref, liveNow()), normalize);
  assert.equal(admitted.admitted, true);

  // Manually advanced counter (module composition, not session-owned): the
  // mutation generation advance refuses earlier refs.
  live = { ...live, mutationGeneration: counter.counterNext(liveStart.mutationGeneration).value };
  const retired = admissionOutcome(refs.admitRef(ref, liveNow()), normalize);
  assert.equal(retired.admitted, false);
  assert.equal(retired.refused, true);
  assert.equal(retired.condition, 'refRetiredByMutation');

  // Manually advanced epoch: earlier refs refuse staleReference.
  live = { ...liveStart, epoch: counter.counterNext(liveStart.epoch).value };
  const stale = admissionOutcome(refs.admitRef(ref, liveNow()), normalize);
  assert.equal(stale.admitted, false);
  assert.equal(stale.condition, 'staleReference');

  // The binding samples through the injected sampler and normalizer.
  live = { ...liveStart };
  const binding = createCaptureBinding({ admitRef: refs.admitRef, ref, liveNow, ...normalize });
  assert.equal(binding.sample().admitted, true);
  live = { ...live, mutationGeneration: counter.counterNext(liveStart.mutationGeneration).value };
  const changed = binding.sample();
  assert.equal(changed.admitted, false);
  assert.equal(changed.condition, 'refRetiredByMutation');

  // Awaited acquisition: identity changes across the read ->
  // changedDuringCapture at stage afterRead with the raw response carried as
  // rawRecord (observed across the read; its timing relative to the mutation
  // is not established) and the admitted prefix listed.
  live = { ...liveStart };
  const changedCapture = await captureScopes({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-9' } }],
    identity: null,
    loadScope: async () => {
      live = { ...live, mutationGeneration: counter.counterNext(live.mutationGeneration).value };
      return { result: [], internalProperties: [] };
    },
    binding: createCaptureBinding({ admitRef: refs.admitRef, ref, liveNow, ...normalize }),
  });
  assert.equal(changedCapture.condition, 'changedDuringCapture');
  assert.equal(changedCapture.stage, 'afterRead');
  assert.equal(changedCapture.refusal.condition, 'refRetiredByMutation');
  assert.deepEqual(changedCapture.rawRecord, { result: [], internalProperties: [] });
  assert.ok(String(changedCapture.rawRecordNote).includes('not established'));
  assert.deepEqual(changedCapture.scopes, []);

  // Fully admitted capture returns scopes plus the records keyed by the
  // ORIGINAL scope objects; summary rendering consumes the same keys.
  live = { ...liveStart };
  const scopeChain = [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-9' } }];
  const settled = await captureScopes({
    scopeChain,
    identity: null,
    loadScope: async () => ({ result: [{ name: 'a', value: { type: 'number', value: 1, description: '1' } }], internalProperties: [] }),
    binding: createCaptureBinding({ admitRef: refs.admitRef, ref, liveNow, ...normalize }),
  });
  assert.equal(settled.condition, undefined);
  assert.equal(settled.scopes.length, 1);
  assert.equal(settled.scopes[0].expansion.complete, true);
  assert.ok(settled.records instanceof Map);
  assert.equal(settled.records.get(scopeChain[0]).result.length, 1, 'records are keyed by the original scope objects');
  const rendered = scopeSummaries({ scopeChain, records: settled.records });
  assert.equal(rendered.scopes[0].expansion.complete, true);

  retain('composition-unit', { identity, ref, admitted: admitted.identity !== undefined, retired, stale });
});

test('same-epoch assembly over a real debuggee through the production session', async (t) => {
  const production = await loadProduction();
  if (production.missing.length > 0) {
    retain('composition-skip', { test: 'production-session', missing: production.missing, kind: 'missing-modules' });
    t.skip(`cdp production modules absent: ${production.missing.join(', ')}; composition runs after lane composition`);
    return;
  }
  const { refs, sessionModule } = production;
  const runtime = 'rt:composition-fixture';
  const app = join(HERE, 'fixtures', 'fixture-app.mjs');

  // The retained harness launcher supplies the endpoint and owns the child;
  // everything after this line is the production session, wrapped in
  // try/finally with bounded owned-child termination and full evidence
  // retention even on assertion or API failure.
  const run = launchDebuggee(app);
  const evidence = { process: { pid: run.child.pid, execPath: process.execPath, version: process.version } };
  let session = null;
  try {
    // Fixture-owned control for the child THIS harness created: a truthful
    // bounded scope that signals and reaps the harness child and makes no
    // keeper-custody claim.
    const control = {
      release: async ({ signal } = {}) => {
        const child = run.child;
        if (!child || child.pid == null) return { signaled: false, reason: 'child already gone' };
        const alive = child.exitCode === null && child.signalCode === null;
        const signaled = alive ? child.kill(signal ?? 'SIGKILL') : false;
        return { signaled, pid: child.pid, scope: 'fixture-owned harness child; no keeper-custody claim' };
      },
    };
    session = sessionModule.createAdapterSession({
      runtime,
      adapter: '0',
      role: 'adapter',
      incarnation: '0',
      sequence: '0',
      targetPid: run.child.pid,
      control,
    });

    // Observation through the session's documented waitFor surface with
    // bounded cancellation; retained-frame position comes from the awaited
    // event itself.
    let lastSeq = 0;
    const waitForStop = async (timeoutMs = 15000) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const observed = await session.waitFor('Debugger.paused', { after: lastSeq, signal: abort.signal });
        lastSeq += 1;
        return observed;
      } finally {
        clearTimeout(timer);
      }
    };

    const initialStopPromise = waitForStop();
    const launch = await session.execute('launch', {
      effects: ['controlRuntime'],
      webSocketUrl: await run.endpoint,
      program: app,
      args: [],
      env: { PATH: '/usr/bin:/bin', HOME: tmpdir() },
      onOwnerStop: 'terminate',
    });
    assert.ok(launch, 'launch acknowledged');
    const initialStop = await initialStopPromise;
    assert.ok(initialStop, 'the initial stop arrived through the session observation surface');
    evidence.initialStop = initialStop;

    const snapshotAtStop = session.snapshot();
    assert.equal(typeof snapshotAtStop.epoch, 'string', 'snapshot exposes the session-owned epoch counter string');
    assert.equal(typeof snapshotAtStop.mutationGeneration, 'string', 'snapshot exposes the session-owned mutation counter string');
    const liveness = snapshotAtStop.lastPause ? snapshotAtStop.lastPause.liveness : null;
    assert.equal(liveness, 'live', 'the recorded stop is live');

    // The observed frames come from the retained stop observation; the
    // original scope objects are kept so record keys stay stable.
    const retainedFrames = (initialStop && initialStop.params && initialStop.params.callFrames)
      ?? (initialStop && initialStop.callFrames)
      ?? null;
    assert.ok(Array.isArray(retainedFrames) && retainedFrames.length > 0, 'the stop observation retains its call frames');
    const frame0 = retainedFrames[0];
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
    const normalize = { requireAdmittedRef: refs.requireAdmittedRef };
    const liveNow = () => liveFromSnapshot(runtime, session.snapshot());
    const binding = createCaptureBinding({ admitRef: (candidate) => session.admitRef(candidate), ref, liveNow, ...normalize });
    assert.equal(binding.sample().admitted, true, 'the live stop admits the capture ref');

    // Reads: session.admitRef runs synchronously immediately before the send
    // initiation; the send envelope is {category, method, result} and the
    // loader returns the CDP RESULT so records feed the summary directly.
    const gatedSend = async (method, params, refText) => {
      const outcome = admissionOutcome(session.admitRef(refText), normalize);
      if (!outcome.admitted) return { condition: outcome.condition };
      const response = await session.send({ query: 'composition', method, params });
      return response.result;
    };
    const globalProps = await gatedSend('Runtime.getProperties', { objectId: globalScope.object.objectId }, ref);
    assert.equal(globalProps.condition, undefined);
    assert.ok(Array.isArray(globalProps.result), 'the CDP result carries the descriptor list');
    const handleDescriptor = globalProps.result.find((descriptor) => descriptor.value && descriptor.value.objectId);
    assert.ok(handleDescriptor, 'the global scope exposes an expandable object');
    evidence.payload = expansionPayload(handleDescriptor, identity);

    // The awaited scope capture through the production session; the loader
    // returns the CDP result per scope.
    const capture = await captureScopes({
      scopeChain: frame0.scopeChain,
      identity,
      loadScope: async (scope) => {
        if (!scope.object || !scope.object.objectId) return { result: [], internalProperties: [] };
        const scopeRef = refs.encodeRefId(refs.refIdentity({ ...identity, kind: 'object', handle: scope.object.objectId }));
        const outcome = admissionOutcome(session.admitRef(scopeRef), normalize);
        if (!outcome.admitted) return { condition: outcome.condition };
        const response = await session.send({ query: 'composition', method: 'Runtime.getProperties', params: { objectId: scope.object.objectId, generatePreview: true, ownAndAccessorProperties: true } });
        return response.result;
      },
      binding: createCaptureBinding({ admitRef: (candidate) => session.admitRef(candidate), ref, liveNow, ...normalize }),
    });
    assert.equal(capture.condition, undefined, 'the capture completed inside one live epoch');
    assert.ok(capture.scopes.length >= 1);
    assert.equal(capture.records instanceof Map, true);
    assert.ok(frame0.scopeChain.every((scope, index) => capture.scopes[index] !== undefined), 'scope order preserved under the original keys');
    evidence.capture = { scopes: capture.scopes.length, records: capture.records.size };

    // The explicit evaluation advances the session-owned mutation
    // generation; the capture ref now refuses before any backend access.
    await session.execute('evaluate', { effects: ['controlRuntime', 'evaluateRuntime'], expression: '1 + 1', frame: frame0.callFrameId });
    const afterEvaluate = liveFromSnapshot(runtime, session.snapshot());
    assert.notEqual(afterEvaluate.mutationGeneration, identity.mutationGeneration, 'session-owned mutation generation advanced');
    const retired = binding.sample();
    assert.equal(retired.admitted, false);
    assert.equal(retired.condition, 'refRetiredByMutation');

    // Resume requires a REAL later stop for staleReference: the stop
    // observation is awaited with bounded cancellation and its absence
    // asserts the actual state-first refusal instead.
    const laterStopPromise = waitForStop();
    await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
    let laterStop = null;
    try {
      laterStop = await laterStopPromise;
    } catch (err) {
      laterStop = null;
      evidence.secondStopWaitError = String(err.message ?? err);
    }
    const afterResume = liveFromSnapshot(runtime, session.snapshot());
    assert.notEqual(afterResume.epoch, identity.epoch, 'session-owned epoch advanced');
    if (laterStop) {
      assert.equal(binding.sample().condition, 'staleReference');
    } else {
      // State-first refusal: without an observed later stop, the record is
      // named from the actual snapshot state rather than asserted as stale.
      evidence.stateFirstRefusal = { snapshot: afterResume, sample: binding.sample() };
      assert.equal(binding.sample().admitted, false, 'without a live later stop the pause-scoped ref refuses');
    }

    evidence.runtimeEvidence = runtimeEvidence({ runtime, epoch: identity.epoch, thread: 'main:0', script: frame0.location?.scriptId ?? null, generated: null, original: null });
  } finally {
    const closureFailures = [];
    try {
      if (session && typeof session.close === 'function') session.close();
    } catch (err) {
      closureFailures.push(`session.close: ${String(err.message ?? err)}`);
    }
    try {
      const child = run.child;
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch (err) {
      closureFailures.push(`child kill: ${String(err.message ?? err)}`);
    }
    try {
      const closure = await Promise.race([finish(run), new Promise((resolve) => setTimeout(() => resolve({ exit: { code: null, signal: 'reap-timeout' }, stdout: run.stdoutText(), stderr: run.stderrText() }), 8000))]);
      evidence.closure = closure;
    } catch (err) {
      closureFailures.push(`reap: ${String(err.message ?? err)}`);
    }
    evidence.closureFailures = closureFailures;
    retain('composition-debuggee', evidence);
  }
  assert.equal(evidence.closure ? evidence.closure.exit.spawnError ?? null : null, null);
});
