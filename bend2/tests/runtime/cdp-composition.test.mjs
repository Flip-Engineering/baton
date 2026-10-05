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
// The second test drives the production adapter session: launch FIRST (a
// waitFor issued before launch would reject transportMissing), then consume
// the retained stop through the session's waitFor surface using the
// returned absolute frame cursor, reads through session.send gated by
// session.admitRef synchronously before each send with the injected
// production requireAdmittedRef forwarded everywhere, the production release
// intent with the fixture-owned control as the finally fallback, and full
// resource closure with truthful outcome classification.
//
// Resource closure: every line after launchDebuggee runs inside try/finally;
// the finally performs the direct owned-child termination ONLY as the
// fallback when the production release path has not already ended the child,
// and retains full raw evidence even on assertion or API failure. A reap
// timeout is a distinct failed outcome, never fabricated as a signal.

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

  // The binding samples through the injected sampler and normalizer; a
  // binding without the production normalizer refuses outright.
  live = { ...liveStart };
  const binding = createCaptureBinding({ admitRef: refs.admitRef, ref, liveNow, ...normalize });
  assert.equal(binding.sample().admitted, true);
  live = { ...live, mutationGeneration: counter.counterNext(liveStart.mutationGeneration).value };
  const changed = binding.sample();
  assert.equal(changed.admitted, false);
  assert.equal(changed.condition, 'refRetiredByMutation');
  assert.equal(createCaptureBinding({ admitRef: refs.admitRef, ref, liveNow }).sample().condition, 'productionNormalizerRequired');

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
  // everything after this line is the production session inside one
  // try/finally with truthful outcome classification.
  const run = launchDebuggee(app);
  if (!run.child || run.child.pid == null) {
    const closure = await finish(run);
    retain('composition-debuggee', { spawnFailed: true, closure });
    assert.fail('launchDebuggee returned no child; spawn failed');
  }
  const evidence = { process: { pid: run.child.pid, execPath: process.execPath, version: process.version } };
  let session = null;
  let releaseObserved = null;
  let outstandingWait = null;
  let primaryFailure = null;
  try {
    // Fixture-owned control for the child THIS harness created: a truthful
    // bounded scope used by the production release intent; the direct kill
    // in finally is only the fallback when release has not ended the child.
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

    // Observation through the session's waitFor surface. waitFor returns an
    // ABSOLUTE frame cursor in observed.index; the next wait uses that
    // cursor so a retained frame is never replayed as a later stop. The
    // returned handle carries rejection ownership: cleanup aborts it, the
    // helper awaits the settled promise, and cancellation is distinguished
    // from timeout while non-abort errors are retained on the facts.
    async function waitForStop(afterCursor, timeoutMs = 15000) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(new Error('wait-timeout')), timeoutMs);
      const wait = session.waitFor('Debugger.paused', { after: afterCursor, signal: abort.signal });
      const settled = wait.then(
        (observed) => ({ reason: 'completed', observed, timedOut: false, cancelled: false, rejected: false, message: null }),
        (err) => {
          const abortReason = abort.signal.reason instanceof Error ? abort.signal.reason.message : String(abort.signal.reason ?? 'aborted');
          if (abort.signal.aborted && abortReason === 'wait-timeout') {
            return { reason: 'timeout', observed: null, timedOut: true, cancelled: false, rejected: true, message: abortReason };
          }
          if (abort.signal.aborted) {
            return { reason: 'cancelled', observed: null, timedOut: false, cancelled: true, rejected: true, message: abortReason };
          }
          return { reason: 'error', observed: null, timedOut: false, cancelled: false, rejected: true, message: String(err.message ?? err) };
        },
      );
      outstandingWait = { abort, settled };
      const result = await settled;
      if (result.reason === 'error') evidence.waitErrors = [...(evidence.waitErrors ?? []), result.message];
      clearTimeout(timer);
      if (outstandingWait && outstandingWait.abort === abort) outstandingWait = null;
      return result;
    }

    // LAUNCH FIRST: a wait issued before launch would reject
    // transportMissing. The launch may retain the initial paused frame;
    // waitFor with cursor 0 consumes it afterwards.
    const launch = await session.execute('launch', {
      effects: ['controlRuntime'],
      webSocketUrl: await run.endpoint,
      program: app,
      args: [],
      env: { PATH: '/usr/bin:/bin', HOME: tmpdir() },
      onOwnerStop: 'terminate',
    });
    assert.ok(launch, 'launch acknowledged');
    evidence.launch = launch;

    const initial = await waitForStop(0);
    assert.equal(initial.timedOut, false, 'the initial retained stop arrived');
    assert.ok(initial.observed, 'the initial stop observation is retained');
    evidence.initialCursor = initial.observed.index;
    evidence.initialStop = initial.observed;

    const snapshotAtStop = session.snapshot();
    assert.equal(typeof snapshotAtStop.epoch, 'string', 'snapshot exposes the session-owned epoch counter string');
    assert.equal(typeof snapshotAtStop.mutationGeneration, 'string', 'snapshot exposes the session-owned mutation counter string');
    const liveness = snapshotAtStop.lastPause ? snapshotAtStop.lastPause.liveness : null;
    assert.equal(liveness, 'live', 'the recorded stop is live');

    // The retained frame position comes from the observed stop; the original
    // scope objects are kept so record keys stay stable.
    const retainedFrames = (initial.observed && initial.observed.params && initial.observed.params.callFrames)
      ?? (initial.observed && initial.observed.callFrames)
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

    // Resume and require a REAL later stop, waited with the returned cursor
    // so the first pause cannot replay as the later one. A resume failure
    // drains the outstanding wait: it is aborted and awaited here, with
    // cancellation, timeout and non-abort errors distinguished on the facts.
    let later;
    try {
      const laterHandle = waitForStop(initial.observed.index);
      await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
      later = await laterHandle;
    } catch (err) {
      if (outstandingWait) {
        outstandingWait.abort.abort(new Error('resume-failed'));
        evidence.resumeDrain = await outstandingWait.settled.catch((drainError) => ({ reason: 'drain-error', message: String(drainError.message ?? drainError) }));
      }
      evidence.resumeFailure = String(err.message ?? err);
      throw err;
    }
    const afterResume = liveFromSnapshot(runtime, session.snapshot());
    assert.notEqual(afterResume.epoch, identity.epoch, 'session-owned epoch advanced');
    // Facade ordering: after a successful resume while the target runs, a
    // pause-scoped kind refuses refOutsidePause BEFORE any epoch comparison;
    // a real observed later stop makes the live-stop state admit the epoch
    // check instead, which then refuses staleReference. The expected
    // condition is chosen from the actual observed state.
    if (later.reason === 'error') {
      assert.fail(`the later-stop wait failed with a non-abort error; absence of a stop cannot be justified: ${later.message}`);
    }
    const expectedCondition = later.observed ? 'staleReference' : 'refOutsidePause';
    const stateFirst = binding.sample();
    assert.equal(stateFirst.condition, expectedCondition, `the state-first refusal names the actual condition (${later.reason === 'timeout' ? 'no later stop observed: running, outside a stop' : 'later stop observed'})`);
    evidence.afterResume = { ...afterResume, laterStopTimedOut: later.timedOut, stateFirstCondition: stateFirst.condition };

    // The production release path runs and its observed result envelope is
    // inspected for its actual fields: state plus the keeper disposition.
    // Child signaling is verified by the OBSERVED child end below, not by
    // the acknowledgement alone.
    releaseObserved = await session.execute('release', { effects: ['controlRuntime'], onRelease: 'terminate', signal: 'SIGKILL' });
    assert.ok(releaseObserved !== null && typeof releaseObserved === 'object', 'release returned an observed result envelope');
    assert.ok(typeof releaseObserved.state === 'string' && releaseObserved.state.length > 0, `the release envelope names its observed state: ${JSON.stringify(releaseObserved).slice(0, 200)}`);
    assert.ok(releaseObserved.keeper !== undefined, 'the release envelope names its keeper disposition');
    assert.ok(releaseObserved.keeper === null || typeof releaseObserved.keeper === 'object', 'the keeper disposition is an object or an explicit null');
    if (releaseObserved.keeper && typeof releaseObserved.keeper === 'object') {
      assert.ok('signaled' in releaseObserved.keeper, 'the keeper disposition records the signal attempt');
      assert.ok('pid' in releaseObserved.keeper, 'the keeper disposition names the pid');
      assert.ok(typeof releaseObserved.keeper.scope === 'string' && releaseObserved.keeper.scope.includes('fixture-owned'), 'the keeper disposition carries the truthful fixture-owned scope');
    }
    evidence.releaseResult = releaseObserved;
    evidence.signalAttempt = releaseObserved.keeper ?? null;

    // The session's frame trace, when the surface exposes one, is retained
    // with the evidence.
    try {
      if (typeof session.frames === 'function') evidence.frameTrace = session.frames();
    } catch (err) {
      evidence.frameTraceError = String(err.message ?? err);
    }

    evidence.runtimeEvidence = runtimeEvidence({ runtime, epoch: identity.epoch, thread: 'main:0', script: frame0.location?.scriptId ?? null, generated: null, original: null });
  } catch (err) {
    primaryFailure = { message: String(err.message ?? err), stack: err.stack ?? null };
    throw err;
  } finally {
    const closureFailures = [];
    try {
      // Cancel any outstanding wait so its rejection cannot escape, then
      // DRAIN the preserved settled promise before closing the session.
      if (outstandingWait) {
        outstandingWait.abort.abort(new Error('cleanup'));
        await outstandingWait.settled.catch(() => {});
      }
    } catch (err) {
      closureFailures.push(`abort outstanding wait: ${String(err.message ?? err)}`);
    }
    try {
      // Frame trace is captured BEFORE the session closes, on every path; an
      // absent frames surface is recorded explicitly instead of silently
      // omitted.
      if (session) {
        if (typeof session.frames === 'function') evidence.frameTrace = session.frames();
        else evidence.frameTrace = { unavailable: true, reason: 'the session surface exposes no frames()' };
      }
    } catch (err) {
      evidence.frameTrace = { unavailable: true, reason: String(err.message ?? err) };
    }
    try {
      if (session && typeof session.close === 'function') session.close();
    } catch (err) {
      closureFailures.push(`session.close: ${String(err.message ?? err)}`);
    }
    // Direct owned-child termination is the FALLBACK and follows actual
    // child liveness, not the presence of a release acknowledgement: an
    // acknowledgement is not an observed exit. Intervening here is distinct
    // evidence that the release path did not end the child.
    try {
      const child = run.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        const fallbackSignaled = child.kill('SIGKILL');
        evidence.fallbackKill = { intervened: true, signaled: fallbackSignaled, pid: child.pid, note: 'release did not end the child before this fallback' };
      }
    } catch (err) {
      closureFailures.push(`child fallback kill: ${String(err.message ?? err)}`);
    }
    let closure = null;
    let reapTimedOut = false;
    let reapTimer = null;
    try {
      closure = await Promise.race([
        finish(run),
        new Promise((resolve) => {
          reapTimer = setTimeout(() => resolve(null), 8000);
        }),
      ]);
      clearTimeout(reapTimer);
      if (!closure) {
        reapTimedOut = true;
        closure = { exit: { code: null, signal: null, spawnError: null }, stdout: run.stdoutText(), stderr: run.stderrText(), reapTimedOut: true };
      }
    } catch (err) {
      closureFailures.push(`reap: ${String(err.message ?? err)}`);
    }
    evidence.closure = closure;
    evidence.reapTimedOut = reapTimedOut;
    evidence.releaseObserved = releaseObserved;
    evidence.closureFailures = closureFailures;
    evidence.primaryFailure = primaryFailure;
    retain('composition-debuggee', evidence);
    // Truthful outcome classification: an observed child end plus no
    // unresolved cleanup failure and no reap timeout is the only success
    // shape; a reap timeout is a distinct failed outcome.
    if (reapTimedOut) {
      // Async-close latency after an acknowledged release is UNRESOLVED
      // CUSTODY, not a failed release: the close was not observed within the
      // bound, no exit is fabricated, and the distinction is named.
      if (releaseObserved) {
        evidence.releaseClosePending = true;
        assert.fail('release acknowledged but the child close was not observed within 8s; unresolved custody, not a failed release and not a fabricated signal');
      }
      assert.fail('child reaping timed out after 8s; no exit was observed (distinct failed outcome, not a fabricated signal)');
    }
    if (closureFailures.length > 0) {
      assert.fail(`cleanup failures: ${closureFailures.join('; ')}`);
    }
    if (!closure || (closure.exit.code === null && closure.exit.signal === null)) {
      assert.fail('the owned child was never observed to exit or close');
    }
    assert.equal(closure.exit.spawnError ?? null, null);
  }
});
