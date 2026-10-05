// Composition fixture: binds this lane's production modules to the actual
// CDP production modules (semantic-impl-cdp's cdp-refs, cdp-counter and the
// debuggee lifecycle through the shared harness). The CDP files are owned by
// the CDP lane and are never duplicated here; when synthesis composes the
// lanes into one tree the imports below resolve and this fixture runs for
// real. Absence skips explicitly with the missing file names - it never
// passes silently and never substitutes a re-implementation.
//
// Same-epoch assembly under the frozen decision contract: every backend send
// is gated on the production admission returning {decision:'admitted',
// identity}; evaluation advances the mutation generation, so earlier refs
// refuse refRetiredByMutation and are re-admitted from a fresh counter
// state; resume advances the epoch, so earlier refs refuse staleReference;
// runtimeBusy is a terminal refusal for the capture, not a retry obligation,
// and release stays available. Stop liveness reads snapshot().lastPause
// liveness semantics: anything but a live stop refuses pause-scoped access.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { admissionOutcome, staleRefRefusal, createCaptureBinding, scopeSummaries, runtimeEvidence } from '../../context/runtime/observations.mjs';
import { expansionPayload } from '../../context/runtime/values.mjs';
import { Cdp, launchDebuggee, handshake, finish, retain } from './cdp-helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CDP_DIR = join(HERE, '..', '..', 'context', 'runtime');
const REQUIRED = ['cdp-refs.mjs', 'cdp-counter.mjs'];

async function loadProduction() {
  const missing = REQUIRED.filter((file) => !existsSync(join(CDP_DIR, file)));
  if (missing.length > 0) return { missing };
  const refs = await import(pathToFileURL(join(CDP_DIR, 'cdp-refs.mjs')).href);
  const counter = await import(pathToFileURL(join(CDP_DIR, 'cdp-counter.mjs')).href);
  return { refs, counter, missing: [] };
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

  // Admission at the live counters admits; the explicit success shape is the
  // only access permit.
  const admitted = admissionOutcome(refs.admitRef(ref, liveStart));
  assert.equal(admitted.admitted, true);
  assert.equal(staleRefRefusal(refs.admitRef(ref, liveStart)), null);

  // An evaluation advances the mutation generation before the send: the
  // earlier ref refuses refRetiredByMutation before any backend access.
  const afterEvaluate = { ...liveStart, mutationGeneration: counter.counterNext(liveStart.mutationGeneration).value };
  const retired = admissionOutcome(refs.admitRef(ref, afterEvaluate));
  assert.equal(retired.admitted, false);
  assert.equal(retired.condition, 'refRetiredByMutation');
  assert.equal(staleRefRefusal(refs.admitRef(ref, afterEvaluate)).condition, 'refRetiredByMutation');

  // A resume advances the epoch: the earlier ref refuses staleReference.
  const afterResume = { ...liveStart, epoch: counter.counterNext(liveStart.epoch).value };
  const stale = admissionOutcome(refs.admitRef(ref, afterResume));
  assert.equal(stale.admitted, false);
  assert.equal(stale.condition, 'staleReference');

  // The capture binding runs the same production admission before each
  // asynchronous read: admitted at the start, an explicit refusal after the
  // counter advance, never a coherent capture by assertion.
  const binding = createCaptureBinding({ admitRef: refs.admitRef, ref });
  assert.equal(binding.check(liveStart).admitted, true);
  const changed = binding.check(afterEvaluate);
  assert.equal(changed.admitted, false);
  assert.equal(changed.condition, 'refRetiredByMutation');
  const midCapture = scopeSummaries({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-9' } }],
    identity: { runtime: identity.runtime, adapter: identity.adapter, thread: identity.thread, epoch: identity.epoch, mutationGeneration: identity.mutationGeneration },
    loadScope: () => ({ result: [], internalProperties: [] }),
    admission: binding,
    live: afterEvaluate,
  });
  assert.equal(midCapture.condition, 'changedDuringCapture');
  assert.equal(midCapture.refusal.condition, 'refRetiredByMutation');
  assert.deepEqual(midCapture.scopes, []);

  // The zero-property record stays a record: a live admission with no reads
  // still yields an ordinary scope summary.
  const settled = scopeSummaries({
    scopeChain: [{ type: 'local', name: '', object: { type: 'object', objectId: 'obj-9' } }],
    identity: null,
    loadScope: () => ({ result: [], internalProperties: [] }),
    admission: binding,
    live: liveStart,
  });
  assert.equal(settled.condition, undefined);
  assert.equal(settled.scopes[0].expansion.complete, true);

  retain('composition-unit', { identity, ref, admitted: admitted.identity !== undefined, retired, stale });
});

test('same-epoch assembly over a real debuggee with the production admission', async (t) => {
  const production = await loadProduction();
  if (production.missing.length > 0) {
    t.skip(`cdp production modules absent: ${production.missing.join(', ')}; composition runs after lane composition`);
    return;
  }
  const { refs, counter } = production;
  const app = join(HERE, 'fixtures', 'fixture-app.mjs');
  const run = launchDebuggee(app);
  const client = new Cdp(await run.endpoint);
  await client.open();
  const first = await handshake(client);

  // snapshot() in the composed adapter exposes the counter strings; this
  // fixture derives them from the observed stop sequence and advances them
  // through the production counter module.
  let epoch = counter.INITIAL_COUNTER;
  let mutationGeneration = counter.INITIAL_COUNTER;
  const runtime = 'rt:composition-fixture';
  const adapter = '0';
  const thread = 'main:0';

  const frame0 = first.params.callFrames[0];
  const globalScope = frame0.scopeChain.find((scope) => scope.object && scope.object.objectId);
  const globalProps = await client.send('Runtime.getProperties', { objectId: globalScope.object.objectId });
  const handleDescriptor = globalProps.result.find((descriptor) => descriptor.value && descriptor.value.objectId);
  assert.ok(handleDescriptor, 'the global scope exposes an expandable object');
  const payload = expansionPayload(handleDescriptor, { runtime, adapter, thread, epoch, mutationGeneration });
  const ref = refs.encodeRefId(refs.refIdentity({ ...payload.identity, kind: 'object', handle: payload.handle }));
  const binding = createCaptureBinding({ admitRef: refs.admitRef, ref });

  // Read admitted at the live counters.
  assert.equal(binding.check({ runtime, adapter, epoch, mutationGeneration }).admitted, true);

  // An explicit evaluation advances the mutation generation: the capture
  // ref now refuses before any backend access, and the assembly names the
  // change instead of asserting a coherent capture.
  const evaluated = await client.send('Debugger.evaluateOnCallFrame', { callFrameId: frame0.callFrameId, expression: '1 + 1' });
  mutationGeneration = counter.counterNext(mutationGeneration).value;
  const changed = binding.check({ runtime, adapter, epoch, mutationGeneration });
  assert.equal(changed.admitted, false);
  assert.equal(changed.condition, 'refRetiredByMutation');

  // Re-admission from the fresh counter state admits a newly issued ref.
  const freshPayload = expansionPayload(handleDescriptor, { runtime, adapter, thread, epoch, mutationGeneration });
  const freshRef = refs.encodeRefId(refs.refIdentity({ ...freshPayload.identity, kind: 'object', handle: freshPayload.handle }));
  assert.equal(admissionOutcome(refs.admitRef(freshRef, { runtime, adapter, epoch, mutationGeneration })).admitted, true);
  assert.equal(evaluated.result.value, 2);

  // Resume advances the epoch; the earlier refs refuse staleReference.
  const pausedWait = client.waitEvent('Debugger.paused');
  await client.send('Debugger.resume');
  await pausedWait;
  epoch = counter.counterNext(epoch).value;
  assert.equal(binding.check({ runtime, adapter, epoch, mutationGeneration }).condition, 'staleReference');
  assert.equal(admissionOutcome(refs.admitRef(freshRef, { runtime, adapter, epoch, mutationGeneration })).condition, 'staleReference');

  await client.send('Debugger.resume');
  const closure = await finish(run);
  client.close();
  retain('composition-debuggee', { runtimeEvidence: runtimeEvidence({ runtime, epoch, thread, script: frame0.location?.scriptId ?? null, generated: null, original: null }), ...closure });
  assert.equal(closure.exit.spawnError, null);
  assert.equal(closure.exit.code, 0);
});
