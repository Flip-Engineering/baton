// Real Node inspector (CDP) provider fixture. This is the fixture harness of
// the runtime-values lane: it drives an actual debuggee under this exact Node
// interpreter (start it with the pinned v22.15.0 binary on the runner), reads
// the endpoint from the child's stderr banner only (/json/list is never
// consulted and is not PID authentication), and exercises the recorded
// provider facts my modules must compose: mapped compiled-TS frames, local
// and embedded maps, missing/malformed map refusals, nested incomplete
// previews with full expansion, getter descriptors without execution,
// explicit evaluation effects, epoch/mutation ref refusals before any backend
// request, paused.data exceptions, worker discovery limits, and loaded
// versus disk source identities.
//
// Startup, breakpoints, pause-on-exceptions and resume calls here are the
// fixture harness's own lifecycle effects; the composed adapter gates them
// through its control/evaluate intents. The observation composition under
// test stays read-only. The harness-local admitRef below mirrors the frozen
// decision contract ({decision:'admitted', identity} | {decision:'refused',
// condition, detail}); the authoritative production admission is exercised by
// cdp-composition.test.mjs against the CDP owner's modules.
//
// Evidence: full child stdout/stderr text (waited out through stdio close),
// exit code/signal, spawn errors, the captured records and both admission
// decisions are written untruncated to BATON_RUNTIME_EVIDENCE_DIR (created
// when absent, default a fresh temp directory).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadSourceMap, parseSourceMapV3, mapGeneratedPosition } from '../../context/runtime/source-maps.mjs';
import {
  describeRemoteObject,
  previewCompleteness,
  propertyDescriptorSummary,
  expansionCompleteness,
  expansionPayload,
} from '../../context/runtime/values.mjs';
import {
  mapStackFrames,
  scopeSummaries,
  captureException,
  workerInventory,
  captureIdentity,
  staleRefRefusal,
  runtimeEvidence,
  admissionOutcome,
} from '../../context/runtime/observations.mjs';
import { Cdp, launchDebuggee, handshake, finish, retain, sha256 } from './cdp-helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

assert.equal(typeof WebSocket, 'function', 'global WebSocket is required (Node >= 22.15 floor)');

function makeResolver(client, roots) {
  const loaded = new Map();
  return (scriptId, line, column) => {
    const script = client.scripts.get(scriptId);
    if (!script) return null;
    if (script.sourceMapURL == null) return null;
    let entry = loaded.get(scriptId);
    if (entry === undefined) {
      entry = loadSourceMap({
        sourceMapURL: script.sourceMapURL,
        generatedPath: script.url && script.url.startsWith('file://') ? fileURLToPath(script.url) : null,
        admittedRoots: roots,
      });
      loaded.set(scriptId, entry);
    }
    if (entry.condition) return null;
    return mapGeneratedPosition(entry.map, { line, column }, entry.path ?? null);
  };
}

function makeResolverRecording(client, roots) {
  const refusals = [];
  const resolve = makeResolver(client, roots);
  return {
    refusals,
    resolveOriginal: (scriptId, line, column) => {
      const script = client.scripts.get(scriptId);
      if (!script || script.sourceMapURL == null) return resolve(scriptId, line, column);
      const entry = loadSourceMap({
        sourceMapURL: script.sourceMapURL,
        generatedPath: script.url && script.url.startsWith('file://') ? fileURLToPath(script.url) : null,
        admittedRoots: roots,
      });
      if (entry.condition) refusals.push({ scriptId, condition: entry.condition, sourceMapURL: script.sourceMapURL });
      return resolve(scriptId, line, column);
    },
  };
}

// Harness-only reference of the frozen decision contract, covering the
// epoch/mutation cases this harness exercises; the asserted admitted shape
// is {decision:'admitted', ok:true, identity}. The production admission with
// its full condition set is exercised in cdp-composition.test.mjs.
function admitRef(identity, live) {
  if (identity.runtime !== live.runtime) return { decision: 'refused', condition: 'foreignRuntime' };
  if (identity.epoch !== live.epoch) return { decision: 'refused', condition: 'staleReference' };
  if (identity.mutationGeneration !== live.mutationGeneration) return { decision: 'refused', condition: 'refRetiredByMutation' };
  return { decision: 'admitted', ok: true, identity };
}

function previewProperty(preview, name) {
  for (const property of preview?.properties ?? []) {
    if (property.name === name) return property;
  }
  return null;
}

test('two pause epochs: scopes, previews, expansion, getters without execution, stale ref discipline', async () => {
  const run = launchDebuggee(join(FIXTURES, 'fixture-app.mjs'));
  const client = new Cdp(await run.endpoint);
  await client.open();
  const evidence = { process: { pid: run.child.pid, execPath: process.execPath, version: process.version } };

  const first = await handshake(client);
  const identityEpoch1 = { runtime: 'rt:fixture-app', adapter: '0', thread: 'main:0', epoch: '1', mutationGeneration: '0' };

  const stack1 = mapStackFrames({ callFrames: first.params.callFrames, resolveOriginal: makeResolver(client, [FIXTURES, tmpdir()]) });
  assert.equal(stack1.condition, undefined);
  assert.ok(stack1.frames.length >= 1);
  assert.equal(stack1.frames[0].provenance, 'unmapped', 'fixture-app.mjs ships no source map');
  evidence.epoch1 = { stack: stack1 };

  const globalScope = first.params.callFrames[0].scopeChain.find((scope) => scope.object && scope.object.objectId);
  const globalProps = await client.send('Runtime.getProperties', { objectId: globalScope.object.objectId });
  const globalHandleDescriptor = globalProps.result.find((descriptor) => descriptor.value && descriptor.value.objectId);
  assert.ok(globalHandleDescriptor, 'the global scope exposes an expandable object');
  const oldIdentity = { ...identityEpoch1 };
  evidence.epoch1.globalHandle = expansionPayload(globalHandleDescriptor, oldIdentity);

  const capture1 = captureIdentity({
    startEvent: { method: 'Debugger.paused', seq: first.seq },
    endEvent: { method: 'Runtime.getProperties', responseIndex: client.responses.length },
    epoch: '1',
  });
  assert.equal(capture1.condition, undefined);
  assert.equal(capture1.consistency, 'per-response');
  assert.equal(capture1.controlExclusivity, 'unverified');
  evidence.epoch1.capture = capture1;
  evidence.epoch1.evidence = runtimeEvidence({ runtime: 'rt:fixture-app', epoch: '1' });
  retain('app-epoch1', evidence.epoch1);

  // Resume into the probe stop (epoch '2'). The old global handle is probed
  // while running and recorded; its admission is refused before any request.
  const paused2Wait = client.waitEvent('Debugger.paused');
  await client.send('Debugger.resume');
  let runningProbe;
  try {
    runningProbe = await client.send('Runtime.getProperties', { objectId: globalHandleDescriptor.value.objectId });
  } catch (err) {
    runningProbe = { refused: true, message: String(err.message), cdpCode: err.cdpCode ?? null };
  }
  const second = await paused2Wait;
  const identityEpoch2 = { runtime: 'rt:fixture-app', adapter: '0', thread: 'main:0', epoch: '2', mutationGeneration: '0' };
  evidence.epoch2 = {
    whileRunningWithEpoch1Handle: runningProbe,
    capture: captureIdentity({ startEvent: { method: 'Debugger.paused', seq: second.seq }, endEvent: { method: 'Debugger.paused', seq: second.seq }, epoch: '2' }),
  };

  const stack2 = mapStackFrames({ callFrames: second.params.callFrames, resolveOriginal: makeResolver(client, [FIXTURES, tmpdir()]) });
  assert.equal(stack2.frames[0].functionName, 'probe');
  evidence.epoch2.stack = stack2;

  const frame0 = second.params.callFrames[0];
  const localScope = frame0.scopeChain.find((scope) => scope.type === 'local');
  const scopeResponses = [];
  for (const scope of frame0.scopeChain) {
    if (scope.object && scope.object.objectId) {
      scopeResponses.push(await client.send('Runtime.getProperties', { objectId: scope.object.objectId, generatePreview: true, ownAndAccessorProperties: true }));
    } else {
      scopeResponses.push(null);
    }
  }
  const scopes = scopeSummaries({
    scopeChain: frame0.scopeChain,
    identity: identityEpoch2,
    loadScope: (scope) => scopeResponses[frame0.scopeChain.indexOf(scope)] ?? { condition: 'noScopeObject' },
  });
  assert.equal(scopes.condition, undefined);
  const local = scopes.scopes.find((scope) => scope.type === 'local');
  assert.equal(local.expansion.complete, true);
  assert.equal(local.expansion.accessorExecuted, false);

  const rawByName = new Map(scopeResponses[frame0.scopeChain.indexOf(local)].result.map((descriptor) => [descriptor.name, descriptor]));

  const sixPreview = previewCompleteness(rawByName.get('sixProps').value.preview);
  assert.equal(sixPreview.overflow, true, 'recorded CDP preview behavior: six properties preview five with overflow');
  assert.equal(sixPreview.complete, false);

  const arrayPreview = previewCompleteness(rawByName.get('bigArray').value.preview);
  assert.equal(arrayPreview.overflow, true, 'recorded CDP preview behavior: 101 elements preview one hundred with overflow');
  assert.equal(arrayPreview.complete, false);

  // The direct string local arrives complete without a preview; the nested
  // string inside the object graph is the truncated preview.
  const directString = rawByName.get('longString').value;
  assert.equal(directString.value, 'x'.repeat(101));
  assert.equal(directString.preview, undefined);
  const nestedRaw = rawByName.get('nested').value;
  const innerPreviewProperty = previewProperty(nestedRaw.preview, 'inner');
  const deepPreviewProperty = previewProperty(innerPreviewProperty?.valuePreview, 'deep');
  const longStringPreviewProperty = previewProperty(deepPreviewProperty?.valuePreview, 'longString');
  assert.ok(longStringPreviewProperty, 'the nested graph reaches the string preview');
  assert.equal(longStringPreviewProperty.value.endsWith('\u2026'), true, 'nested string previews truncate');
  assert.ok(longStringPreviewProperty.value.length < 101);
  const nestedSummary = previewCompleteness(nestedRaw.preview);
  assert.equal(nestedSummary.complete, false);

  const getterSummary = propertyDescriptorSummary(rawByName.get('withGetter'));
  assert.equal(getterSummary.kind, 'accessor');
  assert.ok(getterSummary.get.objectId);
  evidence.epoch2.accessor = getterSummary;

  const bigObjectRaw = rawByName.get('bigObject');
  const bigExpansion = await client.send('Runtime.getProperties', { objectId: bigObjectRaw.value.objectId });
  const bigCompleteness = expansionCompleteness(bigExpansion);
  assert.equal(bigCompleteness.complete, true);
  assert.equal(bigCompleteness.propertyCount, 1000);
  assert.equal(bigCompleteness.accessorExecuted, false);
  evidence.epoch2.expansion = { bigObject: bigCompleteness };

  // Getter descriptors did not execute during observation: the counter is
  // still zero after every read above.
  const callFrameId = frame0.callFrameId;
  const counterBefore = await client.send('Debugger.evaluateOnCallFrame', { callFrameId, expression: 'counter.n' });
  assert.equal(counterBefore.result.value, 0, 'getProperties and expansion never invoke accessors');
  const getterValue = await client.send('Debugger.evaluateOnCallFrame', { callFrameId, expression: 'withGetter.v' });
  assert.equal(getterValue.result.value, 42);
  const counterAfter = await client.send('Debugger.evaluateOnCallFrame', { callFrameId, expression: 'counter.n' });
  assert.equal(counterAfter.result.value, 1);
  evidence.epoch2.evaluation = { before: 0, getterValue: 42, after: 1 };

  // The explicit evaluations advance the mutation generation; refs issued
  // before them refuse before any backend request.
  const liveAfterEvaluate = { runtime: 'rt:fixture-app', epoch: '2', mutationGeneration: '1' };
  const retiredPayload = expansionPayload(bigObjectRaw, { ...identityEpoch2 });
  const retiredDecision = admitRef(retiredPayload.identity, liveAfterEvaluate);
  assert.equal(retiredDecision.decision, 'refused');
  assert.equal(staleRefRefusal(retiredDecision).refused, true);
  evidence.epoch2.retiredRef = { decision: retiredDecision, refusal: staleRefRefusal(retiredDecision) };

  // Epoch '3': the first-epoch object ref refuses by epoch string before any
  // backend request. The raw backend behavior with the old raw handle is
  // recorded at the next stop (silent rebinding is a recorded possibility).
  const paused3Wait = client.waitEvent('Debugger.paused');
  await client.send('Debugger.resume');
  const third = await paused3Wait;
  const liveEpoch3 = { runtime: 'rt:fixture-app', epoch: '3', mutationGeneration: '1' };
  const staleDecision = admitRef({ ...oldIdentity }, liveEpoch3);
  assert.equal(staleDecision.decision, 'refused');
  assert.equal(admissionOutcome(staleDecision).admitted, false);
  let rawReuse;
  try {
    rawReuse = await client.send('Runtime.getProperties', { objectId: globalHandleDescriptor.value.objectId });
  } catch (err) {
    rawReuse = { refused: true, message: String(err.message), cdpCode: err.cdpCode ?? null };
  }
  const stack3 = mapStackFrames({ callFrames: third.params.callFrames, resolveOriginal: makeResolver(client, [FIXTURES, tmpdir()]) });
  assert.equal(stack3.frames[0].functionName, 'second');
  evidence.epoch3 = { staleDecision, refusal: staleRefRefusal(staleDecision), rawReuseWithOldHandle: rawReuse };
  retain('app-epochs', evidence);

  client.close();
  const closure = await finish(run);
  evidence.exit = closure.exit;
  retain('app-exit', closure);
  assert.equal(closure.exit.spawnError, null);
  assert.equal(closure.exit.code, 0);
  assert.equal(closure.exit.signal, null);
});

test('uncaught exception pauses with paused.data; the sources refuse to merge', async () => {
  const run = launchDebuggee(join(FIXTURES, 'fixture-throw.mjs'));
  const client = new Cdp(await run.endpoint);
  await client.open();
  await handshake(client);
  const pausedWait = client.waitEvent('Debugger.paused');
  await client.send('Debugger.setPauseOnExceptions', { state: 'uncaught' });
  const paused = await pausedWait;
  const reason = paused.params.reason;
  assert.ok(reason === 'uncaught' || reason === 'promiseRejection', `recorded stop reason, got ${reason}`);
  assert.ok(paused.params.data, 'the stop carries the exception value as paused.data');

  const captured = captureException({ paused: true, pausedData: paused.params.data });
  assert.equal(captured.source, 'paused.data');
  assert.ok(captured.value.description.includes('boom-uncaught'));
  const described = describeRemoteObject(paused.params.data);
  assert.equal(described.type, 'object');

  const conflict = captureException({ paused: true, pausedData: paused.params.data, exceptionThrownEvent: { exceptionDetails: {} } });
  assert.equal(conflict.condition, 'conflictingExceptionSources');
  const absent = captureException({ paused: false });
  assert.equal(absent.condition, 'noExceptionObserved');

  await client.send('Debugger.resume');
  const closure = await finish(run);
  client.close();
  const record = { reason, captured, ...closure };
  retain('exception-paused-data', record);
  assert.equal(closure.exit.spawnError, null);
  assert.equal(closure.exit.code, 1);
  assert.equal(closure.exit.signal, null);
});

test('compiled TS frames map through the local and embedded maps; missing maps refuse', async () => {
  const mapBytes = readFileSync(join(FIXTURES, 'fixture-ts.js.map'));
  const map = parseSourceMapV3(mapBytes);
  const jsPath = join(FIXTURES, 'fixture-ts.js');
  const run = launchDebuggee(jsPath);
  const client = new Cdp(await run.endpoint);
  await client.open();
  const kit = makeResolverRecording(client, [FIXTURES, tmpdir()]);

  const first = await handshake(client);
  const script = [...client.scripts.values()].find((entry) => entry.url.endsWith('fixture-ts.js'));
  assert.ok(script, 'the main script parsed');
  assert.equal(script.sourceMapURL, 'fixture-ts.js.map');

  const stackStart = mapStackFrames({ callFrames: first.params.callFrames, resolveOriginal: kit.resolveOriginal });
  assert.equal(stackStart.frames[0].provenance, 'unmapped', 'generated line 0 carries no mapping segment');

  const breakpoint = await client.send('Debugger.setBreakpointByUrl', { url: script.url, lineNumber: 1, columnNumber: 6 });
  assert.equal(breakpoint.locations.length, 1, 'the generated-location breakpoint resolves');
  assert.deepEqual(
    { line: breakpoint.locations[0].lineNumber, column: breakpoint.locations[0].columnNumber },
    { line: 1, column: 6 },
  );

  const pausedWait = client.waitEvent('Debugger.paused');
  await client.send('Debugger.resume');
  const paused = await pausedWait;
  const mapped = mapStackFrames({ callFrames: paused.params.callFrames, resolveOriginal: kit.resolveOriginal });
  const frame = mapped.frames[0];
  assert.equal(frame.provenance, 'mapped');
  assert.equal(frame.original.path, join(FIXTURES, 'fixture-ts.ts'));
  assert.deepEqual({ line: frame.original.line, column: frame.original.column }, { line: 3, column: 2 });
  assert.equal(frame.original.mapDigest, map.digest);
  assert.notEqual(frame.generated.line, frame.original.line);
  const content = parseSourceMapV3(readFileSync(join(FIXTURES, 'fixture-ts.js.map'))).sourcesContent[0].split('\n');
  assert.ok(content[3].startsWith('  const adjusted'), 'the mapped original line is the adjusted declaration');

  const source = await client.send('Debugger.getScriptSource', { scriptId: frame.generated.scriptId });
  const loadedSha = sha256(Buffer.from(source.scriptSource, 'utf8'));
  const diskSha = sha256(readFileSync(jsPath));
  assert.equal(loadedSha, diskSha, 'the generated fixture runs its own disk bytes');

  await client.send('Debugger.resume');
  const closure = await finish(run);
  client.close();
  retain('ts-local-map', { mapped, loadedSha, diskSha, exit: closure.exit });
  assert.equal(closure.exit.spawnError, null);
  assert.equal(closure.exit.code, 0);

  // Embedded map: same map bytes inside a data URL produce the same original
  // position and the same digest with origin 'embedded'.
  const embeddedDir = mkdtempSync(join(tmpdir(), 'runtime-values-embed-'));
  try {
    const embeddedJs = readFileSync(jsPath, 'utf8').replace(
      '//# sourceMappingURL=fixture-ts.js.map',
      `//# sourceMappingURL=data:application/json;base64,${mapBytes.toString('base64')}`,
    );
    const embeddedPath = join(embeddedDir, 'fixture-ts.js');
    writeFileSync(embeddedPath, embeddedJs);
    const runEmbedded = launchDebuggee(embeddedPath);
    const clientEmbedded = new Cdp(await runEmbedded.endpoint);
    await clientEmbedded.open();
    const kitEmbedded = makeResolverRecording(clientEmbedded, [embeddedDir, tmpdir()]);
    await handshake(clientEmbedded);
    const scriptEmbedded = [...clientEmbedded.scripts.values()].find((entry) => entry.url.endsWith('fixture-ts.js'));
    const loaded = loadSourceMap({
      sourceMapURL: scriptEmbedded.sourceMapURL,
      generatedPath: embeddedPath,
      admittedRoots: [embeddedDir],
    });
    assert.equal(loaded.condition, undefined);
    assert.equal(loaded.origin, 'embedded');
    assert.equal(loaded.digest, map.digest);
    const bpEmbedded = await clientEmbedded.send('Debugger.setBreakpointByUrl', { url: scriptEmbedded.url, lineNumber: 1, columnNumber: 6 });
    assert.equal(bpEmbedded.locations.length, 1);
    const pausedEmbeddedWait = clientEmbedded.waitEvent('Debugger.paused');
    await clientEmbedded.send('Debugger.resume');
    const pausedEmbedded = await pausedEmbeddedWait;
    const mappedEmbedded = mapStackFrames({ callFrames: pausedEmbedded.params.callFrames, resolveOriginal: kitEmbedded.resolveOriginal });
    assert.equal(mappedEmbedded.frames[0].provenance, 'mapped');
    assert.ok(mappedEmbedded.frames[0].original.path.endsWith('fixture-ts.ts'));
    assert.deepEqual(
      { line: mappedEmbedded.frames[0].original.line, column: mappedEmbedded.frames[0].original.column },
      { line: 3, column: 2 },
    );
    await clientEmbedded.send('Debugger.resume');
    const closureEmbedded = await finish(runEmbedded);
    clientEmbedded.close();
    retain('ts-embedded-map', { mapped: mappedEmbedded, exit: closureEmbedded.exit });
    assert.equal(closureEmbedded.exit.spawnError, null);
    assert.equal(closureEmbedded.exit.code, 0);
  } finally {
    rmSync(embeddedDir, { recursive: true, force: true });
  }

  // Missing map: the recorded unavailability names the cause and the frames
  // stay unmapped with the refusal retained.
  const missingDir = mkdtempSync(join(tmpdir(), 'runtime-values-missing-'));
  try {
    const missingJs = readFileSync(jsPath, 'utf8').replace('//# sourceMappingURL=fixture-ts.js.map', '//# sourceMappingURL=absent.map');
    const missingPath = join(missingDir, 'fixture-ts.js');
    writeFileSync(missingPath, missingJs);
    const refusal = loadSourceMap({
      sourceMapURL: 'absent.map',
      generatedPath: missingPath,
      admittedRoots: [missingDir],
    });
    assert.equal(refusal.condition, 'missingMap');
    const runMissing = launchDebuggee(missingPath);
    const clientMissing = new Cdp(await runMissing.endpoint);
    await clientMissing.open();
    const kitMissing = makeResolverRecording(clientMissing, [missingDir, tmpdir()]);
    const firstMissing = await handshake(clientMissing);
    const mappedMissing = mapStackFrames({ callFrames: firstMissing.params.callFrames, resolveOriginal: kitMissing.resolveOriginal });
    assert.equal(mappedMissing.frames[0].provenance, 'unmapped');
    await clientMissing.send('Debugger.resume');
    const closureMissing = await finish(runMissing);
    clientMissing.close();
    retain('ts-missing-map', { refusal, refusals: kitMissing.refusals, exit: closureMissing.exit });
    assert.equal(closureMissing.exit.spawnError, null);
    assert.equal(closureMissing.exit.code, 0);
  } finally {
    rmSync(missingDir, { recursive: true, force: true });
  }
});

test('worker discovery records basic state and the unavailability limits', async () => {
  const run = launchDebuggee(join(FIXTURES, 'fixture-worker-host.mjs'));
  const client = new Cdp(await run.endpoint);
  await client.open();
  await client.send('Runtime.enable');
  await client.send('Debugger.enable');
  await client.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
  const attachedWait = client.waitEvent('NodeWorker.attachedToWorker', 20000);
  const pausedWait = client.waitEvent('Debugger.paused', 20000);
  client.send('Runtime.runIfWaitingForDebugger');
  const attached = await attachedWait;
  const paused = await pausedWait;
  assert.equal(paused.params.callFrames[0].functionName, 'host');

  const inventory = workerInventory({ attached: [attached.params] });
  assert.equal(inventory.workers.length, 1);
  const worker = inventory.workers[0];
  assert.equal(typeof worker.workerId, 'string');
  assert.equal(worker.state, 'attached');
  assert.deepEqual(inventory.limits, ['workerBreakpointsUnavailable', 'workerScopesUnavailable', 'workerExceptionsUnavailable']);

  // Basic thread state only: no worker breakpoint, scope or exception pause
  // is attempted; the limits above travel with the inventory. The detach
  // event, when one arrives, is matched by session id in the unit laws.
  await client.send('Debugger.resume');
  const closure = await finish(run);
  client.close();
  retain('worker-inventory', { inventory, workerUrl: worker.url, attachedParams: attached.params, ...closure });
  assert.equal(closure.exit.spawnError, null);
  assert.equal(closure.exit.code, 0);
  assert.equal(closure.exit.signal, null);
});

test('loaded versus disk identities distinguish current scripts from the stripped representation', async () => {
  const run = launchDebuggee(join(FIXTURES, 'fixture-stripped.ts'), ['--experimental-strip-types']);
  const client = new Cdp(await run.endpoint);
  await client.open();
  await handshake(client);
  const script = [...client.scripts.values()].find((entry) => entry.url.endsWith('fixture-stripped.ts'));
  assert.ok(script, 'the stripped fixture parsed');
  const source = await client.send('Debugger.getScriptSource', { scriptId: script.scriptId });
  const loadedBytes = Buffer.from(source.scriptSource, 'utf8');
  const diskBytes = readFileSync(join(FIXTURES, 'fixture-stripped.ts'));
  const loadedSha = sha256(loadedBytes);
  const diskSha = sha256(diskBytes);
  assert.notEqual(loadedSha, diskSha, 'loaded bytes are the transformed representation');
  assert.equal(loadedBytes.toString('utf8').includes(': number'), false, 'type annotations were stripped from the loaded text');
  const record = {
    loaded: { sha256: loadedSha, length: loadedBytes.length },
    disk: { sha256: diskSha, length: diskBytes.length },
    drift: 'loadedDiffersFromDisk',
    note: 'loaded bytes are the type-stripped representation; a disk edit classification compares against the transformed representation, not raw disk bytes',
  };
  await client.send('Debugger.resume');
  const closure = await finish(run);
  client.close();
  retain('loaded-vs-disk', { ...record, exit: closure.exit });
  assert.equal(closure.exit.spawnError, null);
  assert.equal(closure.exit.code, 0);
  assert.equal(closure.exit.signal, null);
});
