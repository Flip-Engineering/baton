#!/usr/bin/env node
// CDP lane runnable fixture suite.
//
// Every case runs a real operative path from this lane: the packaged bootstrap
// under /usr/bin/env -i, endpoint discovery over the owned child's recorded
// stderr, the loopback inspector transport, the intent operations and the
// epoch/mutation-scoped reference rules. Unit cases cover the closed admission
// tables with recorded negative subjects.
//
// The suite plays the native target keeper's part where a test needs one: it is
// the process parent of the bootstrap child, it is the only party that signals
// or reaps that child, and it records the observed exit. The adapter never does
// any of those things. Test-level deadlines abort a case; the lane's own modules
// contain no timer and no size or time cutoff.
//
// Usage: node bend2/context/runtime/cdp-tests.mjs [--node PATH] [--filter TEXT]
//
// Execution boundary: the operator requires all compiler, build and test gates on
// admitted remote runners. This suite runs there, not on the operator laptop. The default
// target executable is the verified Node 22.15.0 floor staged read-only by the package
// critic; pass --node or BATON_CDP_TARGET_NODE to select another admitted build.
//
// Evidence: .scratch/cdp-lane/<run>/<case>/ retains full child stdout, stderr,
// exit status, hashes and the adapter's emitted frames.

import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, truncateSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { watch } from 'node:fs';

import { admitLaunchDocument, encodeLaunchDocument } from './bootstrap-admission.mjs';
import { counterNext, counterValid } from './cdp-counter.mjs';
import { watchTargetStderr, parseInspectorBanner } from './cdp-endpoint.mjs';
import { admitControlRequest, admitIntent, admitReadRequest, requestForIntent, startupStopRequests } from './cdp-intents.mjs';
import { admitFrame, encodeFrame, sequenceAdmit } from './cdp-protocol.mjs';
import { admitRef, decodeRefId, encodeRefId, refIdentity } from './cdp-refs.mjs';
import { createScriptTable } from './cdp-scripts.mjs';
import { createAdapterSession } from './cdp-session.mjs';
import { initialRecord, nextState } from './cdp-state.mjs';
import { admitLoopbackEndpoint } from './cdp-transport.mjs';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const BOOTSTRAP = join(HERE, 'bootstrap.mjs');

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const FILTER = option('--filter');
// The verified Node 22.15.0 floor, staged read-only by the package critic. The remote
// runner may override it with --node or BATON_CDP_TARGET_NODE.
const FLOOR_NODE = '/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/'
  + '.scratch/semantic-context-20261005/probes/native-package-critic/toolchain/'
  + 'node-v22.15.0-darwin-arm64/bin/node';
const TARGET_NODE = option('--node') ?? process.env.BATON_CDP_TARGET_NODE
  ?? (existsSync(FLOOR_NODE) ? FLOOR_NODE : process.execPath);

const RUN = join(ROOT, '.scratch', 'cdp-lane', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
mkdirSync(RUN, { recursive: true, mode: 0o700 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const digest = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);

function evidenceDir(slug) {
  const dir = join(RUN, slug);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// 0700 private scratch for one case, matching the private-artifact boundary.
function privateDir(slug) {
  const dir = join(RUN, 'private', slug);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// Event-driven wait for a file to appear. No polling interval.
function waitForFile(path, deadlineMs) {
  return new Promise((resolvePromise, reject) => {
    const directory = dirname(path);
    const timer = setTimeout(() => {
      watcher.close();
      reject(new Error(`no file at ${path} within ${deadlineMs}ms`));
    }, deadlineMs);
    const check = () => {
      if (!existsSync(path)) return false;
      clearTimeout(timer);
      watcher.close();
      resolvePromise(read(path));
      return true;
    };
    const watcher = watch(directory, { persistent: true }, check);
    check();
  });
}

function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// The native keeper's part, played by the suite: process parent, signaller and
// reaper of the bootstrap child.
function spawnKeeper({ slug, target, targetArgs = [], env = {} }) {
  const dir = evidenceDir(slug);
  const stderrPath = join(dir, 'target.stderr');
  const stdoutPath = join(dir, 'target.stdout');
  writeFileSync(stderrPath, '');
  writeFileSync(stdoutPath, '');
  const outFd = openSync(stdoutPath, 'a');
  const errFd = openSync(stderrPath, 'a');
  const argv = [TARGET_NODE, '--inspect-brk=127.0.0.1:0', target, ...targetArgs];
  const document = encodeLaunchDocument({ version: 1, node: TARGET_NODE, argv, env });
  writeFileSync(join(dir, 'launch-document.json'), document);
  const child = spawn('/usr/bin/env', ['-i', TARGET_NODE, BOOTSTRAP], {
    stdio: ['pipe', outFd, errFd],
    env: {},
  });
  child.stdin.end(document);
  closeSync(outFd);
  closeSync(errFd);
  const exited = new Promise((resolveExit) => {
    child.on('exit', (code, signal) => {
      const record = { code, signal, at: Date.now() };
      writeFileSync(join(dir, 'target.exit.json'), `${JSON.stringify(record)}\n`);
      resolveExit(record);
    });
  });
  let watchHandle = null;
  return {
    slug,
    dir,
    child,
    pid: child.pid,
    stderrPath,
    stdoutPath,
    argv,
    exited,
    // The keeper's control interface, as the adapter sees it: communicate and
    // adopt the result. The keeper owns the pid and the reap.
    control: {
      async release({ signal }) {
        child.kill(signal);
        return { disposition: 'acknowledged', evidence: { pid: child.pid, signal, keeper: 'suite-stand-in' } };
      },
    },
    endpoint(deadlineMs = 20000) {
      return new Promise((resolveEndpoint, reject) => {
        const timer = setTimeout(() => reject(new Error('endpoint not observed')), deadlineMs);
        watchHandle = watchTargetStderr({
          path: stderrPath,
          onEndpoint: (endpoint) => {
            clearTimeout(timer);
            resolveEndpoint(endpoint);
          },
          onFailure: (failure) => {
            clearTimeout(timer);
            reject(failure);
          },
        });
      });
    },
    stop() {
      if (watchHandle !== null) watchHandle.stop();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    },
    evidence() {
      return {
        stderr: stderrPath,
        stdout: stdoutPath,
        stderrSha256: digest(stderrPath),
        stdoutSha256: digest(stdoutPath),
      };
    },
  };
}

// One adapter session per case, with its emitted frames retained as evidence.
function openSession({ slug, runtime, adapter = 'adapter:fixture', incarnation = '0', keeper = null, control = null }) {
  const dir = evidenceDir(slug);
  const framePath = join(dir, 'adapter-frames.jsonl');
  writeFileSync(framePath, '');
  const session = createAdapterSession({
    runtime,
    adapter,
    incarnation,
    control: control ?? (keeper === null ? null : keeper.control),
    emit: ({ frame, bytes }) => {
      writeFileSync(framePath, `${JSON.stringify({ frame, bytes })}\n`, { flag: 'a' });
    },
  });
  return { session, framePath };
}

const results = [];
const CASES = [];
function test(name, fn) {
  CASES.push({ name, fn });
}

function assert(condition, detail) {
  if (!condition) throw new Error(detail);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, saw ${JSON.stringify(actual)}`);
}

test('startup-order-stop-before-the-start-release-response', () => {
  let record = initialRecord();
  const step = (event) => {
    const result = nextState(record, event);
    if (!result.ok) throw new Error(`${event.type}: ${result.condition} ${result.detail ?? ''}`);
    record = result.record;
    return record;
  };
  step({ type: 'launchStarted' });
  step({ type: 'endpointDiscovered' });
  // The stop event can precede the response of the startup release.
  assertEqual(step({ type: 'paused' }).state, 'paused', 'the stop during the startup wait');
  assertEqual(record.epoch, '1', 'the stop advanced the epoch');
  assertEqual(step({ type: 'startReleaseSent' }).state, 'paused', 'the start release kept the observed stop');
  assertEqual(record.epoch, '1', 'the start release changed no counter');
  assertEqual(nextState({ ...record, state: 'starting' }, { type: 'startReleaseSent' }).condition,
    'illegalTransition', 'a start release before the endpoint was admitted');
  const exited = nextState({ ...record, state: 'running' }, { type: 'childExit' }).record;
  assertEqual(nextState(exited, { type: 'adapterFailed' }).condition, 'illegalTransition',
    'an adapter failure replaced an exited state');
  assertEqual(nextState(exited, { type: 'childExit' }).condition, 'illegalTransition',
    'a repeated child exit was admitted');
});

// ---------------------------------------------------------------------------
// Closed transport envelope.

test('envelope-admits-and-refuses-closed-frames', () => {
  const good = {
    version: 1,
    query: 'q1',
    runtime: 'rt:q1',
    role: 'adapter',
    incarnation: '0',
    sequence: 0,
    type: 'complete',
    payload: { result: { engine: 'cdp' } },
  };
  const admitted = admitFrame(encodeFrame(good));
  assert(admitted.ok, `valid frame refused: ${admitted.condition}`);
  assertEqual(admitted.frame.type, 'complete', 'type');

  const cases = [
    ['{"version":1', 'frameMalformed'],
    [JSON.stringify({ ...good, extra: 1 }), 'frameUnknownField'],
    [JSON.stringify({ ...good, version: 2 }), 'frameVersionUnsupported'],
    [JSON.stringify({ ...good, type: 'progress' }), 'frameTypeUnknown'],
    [JSON.stringify({ ...good, role: 'starter' }), 'foreignIdentity'],
    [JSON.stringify({ ...good, query: null }), 'frameQueryMissing'],
    [JSON.stringify({ ...good, payload: {} }), 'payloadMissingField'],
    [JSON.stringify({ ...good, payload: { result: null } }), 'incompleteResult'],
    [JSON.stringify({ ...good, sequence: -1 }), 'frameSequenceMalformed'],
    [JSON.stringify({ ...good, sequence: 1.5 }), 'frameSequenceMalformed'],
  ];
  for (const [text, condition] of cases) {
    const refusal = admitFrame(text, { runtime: 'rt:q1', role: 'adapter', incarnation: '0', query: 'q1' });
    assertEqual(refusal.ok, false, `refusal for ${condition}`);
    assertEqual(refusal.condition, condition, `condition for ${text.slice(0, 40)}`);
  }

  const foreign = admitFrame(encodeFrame(good), { runtime: 'rt:other' });
  assertEqual(foreign.condition, 'foreignIdentity', 'foreign runtime');

  const unsolicited = admitFrame(encodeFrame({
    version: 1, query: null, runtime: 'rt:q1', role: 'adapter', incarnation: '0', sequence: 3, type: 'state',
    payload: { state: 'running', evidence: { source: 'target' } },
  }));
  assert(unsolicited.ok, `unsolicited state refused: ${unsolicited.condition}`);
});

test('sequence-idempotent-replay-and-conflict', () => {
  const first = sequenceAdmit(null, 0, '{"a":1}');
  assert(first.ok, first.condition);
  const replay = sequenceAdmit({ sequence: 0, retained: first.retained }, 0, '{"a":1}');
  assertEqual(replay.replay, true, 'identical replay is idempotent');
  const conflict = sequenceAdmit({ sequence: 0, retained: first.retained }, 0, '{"a":2}');
  assertEqual(conflict.condition, 'sequenceConflict', 'same sequence, different bytes');
  const below = sequenceAdmit({ sequence: 4, retained: {} }, 2, '{"a":3}');
  assertEqual(below.condition, 'sequenceConflict', 'sequence below the retained one');
  const forward = sequenceAdmit({ sequence: 0, retained: first.retained }, 1, '{"a":4}');
  assert(forward.ok && forward.replay === false, 'monotone advance');
});

// ---------------------------------------------------------------------------
// Reference identity.

test('ref-identity-round-trip-and-punctuation', () => {
  const identity = refIdentity({
    runtime: 'rt:q7', adapter: 'adapter:1', thread: 'worker:2', epoch: '3', mutationGeneration: '1',
    kind: 'object', handle: 'handle:9,[x],"y"',
  });
  const text = encodeRefId(identity);
  const parsed = JSON.parse(text);
  assertEqual(parsed.length, 8, 'canonical array length');
  assertEqual(parsed[0], 'runtime', 'leading tag');
  assertEqual(parsed[4], '3', 'the epoch is carried as admitted text');
  const decoded = decodeRefId(text);
  assertEqual(decoded.handle, identity.handle, 'handle survives punctuation');
  assertEqual(decoded.thread, 'worker:2', 'thread identity');
  for (const broken of ['not json', '[]', '["runtime","rt:q7"]', '["runtime",1,2,3,4,5,6,7]',
    '["runtime","rt:q7","adapter:1","main:0",3,"0","object","h"]']) {
    let refused = false;
    try {
      decodeRefId(broken);
    } catch (error) {
      refused = error.condition === 'refMalformed';
    }
    assert(refused, `decodeRefId refused ${broken}`);
  }
});

test('admit-ref-refuses-stale-epoch-foreign-runtime-and-retired-mutation', () => {
  const scope = { runtime: 'rt:q7', adapter: 'adapter:1', epoch: '2', mutationGeneration: '1' };
  const live = refIdentity({
    runtime: 'rt:q7', adapter: 'adapter:1', thread: 'main:0', epoch: '2', mutationGeneration: '1', kind: 'object', handle: 'h1',
  });
  assert(admitRef(live, scope).ok, 'live ref admitted');
  const stale = { ...live, epoch: '1' };
  assertEqual(admitRef(stale, scope).condition, 'staleReference', 'stale epoch');
  const foreign = { ...live, runtime: 'rt:other' };
  assertEqual(admitRef(foreign, scope).condition, 'foreignRuntime', 'foreign runtime');
  const otherAdapter = { ...live, adapter: 'adapter:2' };
  assertEqual(admitRef(otherAdapter, scope).condition, 'foreignAdapter', 'foreign adapter');
  const retired = { ...live, mutationGeneration: '0' };
  assertEqual(admitRef(retired, scope).condition, 'refRetiredByMutation', 'retired by evaluation');
  assertEqual(admitRef({ ...live, epoch: 2 }, scope).condition, 'refMalformed', 'a numeric epoch ref');
  assertEqual(admitRef(encodeRefId(live), scope).ok, true, 'id text accepted');
  assertEqual(admitRef('nonsense', scope).condition, 'refMalformed', 'malformed id');
});

// ---------------------------------------------------------------------------
// Runtime state, pause epoch and mutation generation.

test('state-machine-transitions-and-epoch-advance', () => {
  let record = initialRecord();
  const step = (event) => {
    const result = nextState(record, event);
    if (!result.ok) throw new Error(`${event.type}: ${result.condition} ${result.detail ?? ''}`);
    record = result.record;
    return record;
  };
  assertEqual(record.state, 'starting', 'initial state');
  step({ type: 'launchStarted' });
  assertEqual(step({ type: 'endpointDiscovered' }).state, 'waitingForStart', 'endpoint');
  assertEqual(step({ type: 'startReleaseSent' }).state, 'running', 'startup release');
  assertEqual(step({ type: 'paused' }).epoch, '1', 'pause advances the epoch to its successor');
  assertEqual(step({ type: 'resumed' }).epoch, '2', 'resume advances the epoch');
  assertEqual(step({ type: 'pauseRequested' }).state, 'pausePending', 'pause acknowledgment');
  assertEqual(step({ type: 'paused' }).state, 'paused', 'stop completes the request');
  assertEqual(step({ type: 'contextDestroyed' }).state, 'running', 'a destroyed context ends the stop');
  assertEqual(record.epoch, '4', 'the destruction advanced the epoch');
  assertEqual(step({ type: 'paused' }).state, 'paused', 'a later stop is admitted again');

  const evaluation = nextState(record, { type: 'evaluationSent', query: 'q-eval' });
  assert(evaluation.ok, evaluation.condition);
  record = evaluation.record;
  assertEqual(record.mutationGeneration, '1', 'evaluation advances the mutation generation');
  assertEqual(record.pending.intent, 'evaluate', 'pending evaluation recorded');
  const busy = nextState(record, { type: 'evaluationSent', query: 'q-eval-2' });
  assertEqual(busy.condition, 'runtimeBusy', 'second evaluation is busy');
  record = nextState(record, { type: 'evaluationSettled' }).record;
  assertEqual(record.pending, null, 'settled');

  // The counter is exact text past every finite numeric boundary.
  const u32 = nextState({ ...record, state: 'running', epoch: '4294967295' }, { type: 'paused' });
  assertEqual(u32.record.epoch, '4294967296', 'U32 boundary epoch');
  const precise = nextState({ ...record, state: 'running', epoch: '9007199254740992' }, { type: 'paused' });
  assertEqual(precise.record.epoch, '9007199254740993', 'double boundary epoch');
  assertEqual(nextState({ ...record, state: 'running', epoch: '01' }, { type: 'paused' }).condition,
    'counterMalformed', 'a non-canonical epoch refuses');

  const failed = nextState(record, { type: 'adapterFailed' });
  assertEqual(failed.record.state, 'failed', 'adapter failure state');
  assertEqual(failed.record.targetLiveness, 'live', 'adapter failure asserts no target exit');
  const exited = nextState(failed.record, { type: 'childExit' });
  assertEqual(exited.record.state, 'exited', 'target exit is its own evidence');
  assertEqual(exited.record.targetLiveness, 'exited', 'target liveness follows exit evidence');

  assertEqual(nextState(initialRecord(), { type: 'paused' }).condition, 'illegalTransition', 'pause before launch');
  assertEqual(nextState(exited.record, { type: 'resumeSent' }).condition, 'illegalTransition', 'resume after exit');
});

// ---------------------------------------------------------------------------
// Intent and request admission.

test('intent-admission-grants-busy-and-signal-order', () => {
  const paused = { state: 'paused', epoch: '1', mutationGeneration: '0', pending: null, targetLiveness: 'live' };
  assertEqual(admitIntent(paused, 'evaluate', { effects: [] }).condition, 'missingEffect', 'evaluate needs grants');
  assertEqual(admitIntent(paused, 'pause', { effects: ['controlRuntime'] }).condition, 'intentNotAdmitted',
    'pause needs running');
  assertEqual(admitIntent(paused, 'resume-step', { effects: ['controlRuntime'] }).ok, true, 'resume from paused');
  assertEqual(admitIntent(paused, 'observe', {}).ok, true, 'observe is admitted while stopped');
  assertEqual(admitIntent(paused, 'release', { effects: ['controlRuntime'], signal: 'SIGTERM' }).ok, true,
    'release is always available to the owner');

  const pending = { ...paused, pending: { query: 'q-eval', intent: 'evaluate' } };
  assertEqual(admitIntent(pending, 'evaluate', { effects: ['controlRuntime', 'evaluateRuntime'] }).condition, 'runtimeBusy',
    'second serialized intent is busy');
  assertEqual(admitIntent(pending, 'pause', { effects: ['controlRuntime'] }).condition, 'intentNotAdmitted',
    'pause needs running');
  assertEqual(admitIntent(pending, 'release', { effects: ['controlRuntime'], signal: 'SIGKILL' }).ok, true,
    'release is admitted while an evaluation is pending');
  assertEqual(
    admitIntent({ ...pending, state: 'running' }, 'release', { effects: ['controlRuntime'], signal: 'SIGTERM', priorSignal: 'SIGKILL' }).condition,
    'signalDowngrade',
    'SIGTERM cannot overwrite SIGKILL');
  assertEqual(admitIntent({ ...paused, state: 'releasing' }, 'release', { effects: ['controlRuntime'], signal: 'SIGKILL' }).ok, true,
    'an explicit second release is admitted');
  assertEqual(admitIntent({ ...paused, state: 'exited' }, 'release', { effects: ['controlRuntime'], signal: 'SIGTERM' }).condition,
    'intentNotAdmitted', 'no release after exit');
  assertEqual(admitIntent(paused, 'launch', { effects: ['controlRuntime'] }).condition, 'intentNotAdmitted',
    'launch only before the target starts');
});

test('request-admission-splits-the-read-path-from-the-control-path', () => {
  const paused = { state: 'paused', epoch: '1', mutationGeneration: '0', pending: null, targetLiveness: 'live' };
  const runnable = { ...paused, state: 'running' };
  assertEqual(admitReadRequest(paused, 'Runtime.getProperties').category, 'read', 'non-evaluating read');
  assertEqual(admitReadRequest(paused, 'Debugger.getScriptSource').category, 'read', 'script text read');
  for (const method of ['Debugger.setAsyncCallStackDepth', 'Runtime.runIfWaitingForDebugger', 'Debugger.enable',
    'NodeWorker.enable', 'NodeWorker.detach', 'NodeWorker.sendMessageToWorker', 'Debugger.setBreakpointByUrl']) {
    assertEqual(admitReadRequest(runnable, method).condition, 'controlRequiresGrant',
      `${method} was admitted on the zero-grant read path`);
  }
  assertEqual(admitReadRequest(paused, 'Runtime.evaluate').condition, 'evaluationRequiresIntent', 'evaluation needs the intent');
  assertEqual(admitReadRequest(paused, 'Debugger.evaluateOnCallFrame').condition, 'evaluationRequiresIntent', 'frame evaluation');
  assertEqual(admitReadRequest(paused, 'Runtime.callFunctionOn').condition, 'evaluationRequiresIntent', 'callFunctionOn');
  assertEqual(admitReadRequest(paused, 'Debugger.pause').condition, 'stateChangeRequiresIntent', 'pause needs the intent');
  assertEqual(admitReadRequest(paused, 'Debugger.wasThrown').condition, 'requestUnlisted', 'unknown method refuses');
  assertEqual(admitReadRequest({ ...paused, state: 'exited' }, 'Runtime.getProperties').condition, 'requestNotAdmitted',
    'no read after exit');
  assertEqual(admitReadRequest({ ...paused, state: 'failed' }, 'Runtime.getProperties').condition, 'requestNotAdmitted',
    'no read after adapter failure');

  // The control path needs the grant and carries configuration only.
  assertEqual(admitControlRequest(runnable, 'NodeWorker.detach', {}, []).condition, 'missingEffect',
    'a control request without its grant was admitted');
  assertEqual(admitControlRequest(runnable, 'NodeWorker.detach', {}, ['controlRuntime']).category, 'control',
    'a granted worker detach was refused');
  assertEqual(admitControlRequest(runnable, 'Runtime.runIfWaitingForDebugger', {}, ['controlRuntime']).ok, true,
    'a granted startup release was refused');
  assertEqual(admitControlRequest(runnable, 'Runtime.evaluate', {}, ['controlRuntime']).condition,
    'evaluationRequiresIntent', 'an evaluation was admitted on the control path');
  assertEqual(admitControlRequest(runnable, 'Runtime.getProperties', {}, ['controlRuntime']).condition,
    'readRequiresNoGrant', 'a zero-grant read was admitted on the control path');

  // A nested worker message must itself be a read, on both the outer and the nested path.
  const nestedRead = admitControlRequest(runnable, 'NodeWorker.sendMessageToWorker', {
    message: JSON.stringify({ id: 1, method: 'Runtime.getProperties', params: {} }),
  }, ['controlRuntime']);
  assertEqual(nestedRead.category, 'control', 'a nested read was refused');
  const nestedEvaluate = admitControlRequest(runnable, 'NodeWorker.sendMessageToWorker', {
    message: JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: '1+1' } }),
  }, ['controlRuntime']);
  assertEqual(nestedEvaluate.condition, 'evaluationRequiresIntent', 'a nested evaluation was admitted');
  const nestedControl = admitControlRequest(runnable, 'NodeWorker.sendMessageToWorker', {
    message: JSON.stringify({ id: 3, method: 'Debugger.setBreakpointByUrl', params: {} }),
  }, ['controlRuntime']);
  assertEqual(nestedControl.condition, 'nestedControlNotAdmitted', 'a nested control request was admitted');
  assertEqual(nestedRead.inner, 'Runtime.getProperties', 'the admitted nested method');

  // A breakpoint condition is target JavaScript and is refused.
  assertEqual(admitControlRequest(runnable, 'Debugger.setBreakpointByUrl',
    { url: 'file:///a.js', lineNumber: 3, condition: 'x > 1' }, ['controlRuntime']).condition,
  'breakpointConditionUnsupported', 'a conditional breakpoint was admitted');
  let thrown = null;
  try {
    startupStopRequests([{ url: 'file:///a.js', lineNumber: 3, condition: 'x > 1' }]);
  } catch (error) {
    thrown = error.condition;
  }
  assertEqual(thrown, 'breakpointConditionUnsupported', 'a conditional startup stop was admitted');

  assertEqual(requestForIntent('resume-step', { action: 'stepIn' }).method, 'Debugger.stepInto', 'stepIn mapping');
  assertEqual(requestForIntent('evaluate', { expression: 'x', frame: 'f1' }).method, 'Debugger.evaluateOnCallFrame',
    'frame evaluation mapping');
  assertEqual(startupStopRequests([{ url: 'file:///a.js', lineNumber: 3 }])[0].method,
    'Debugger.setBreakpointByUrl', 'located startup stop mapping');
});

// ---------------------------------------------------------------------------
// Bootstrap document admission.

test('launch-document-admission-refusals', () => {
  const node = TARGET_NODE;
  const good = { version: 1, node, argv: [node, '--inspect-brk=127.0.0.1:0', '/tmp/target.mjs'], env: { A: 'b' } };
  assert(admitLaunchDocument(JSON.stringify(good)).ok, 'valid document admitted');
  const cases = [
    [`\uFEFF${JSON.stringify(good)}`, 'launchDocumentBom'],
    ['{"version":1', 'launchDocumentMalformed'],
    [JSON.stringify({ ...good, extra: true }), 'launchDocumentUnknownField'],
    [JSON.stringify({ version: 1, node }), 'launchDocumentMissingField'],
    [JSON.stringify({ ...good, version: 2 }), 'launchDocumentVersion'],
    [JSON.stringify({ ...good, node: 'node' }), 'launchNodeNotAbsolute'],
    [JSON.stringify({ ...good, argv: [] }), 'launchArgvInvalid'],
    [JSON.stringify({ ...good, argv: ['/bin/sh', '-c', 'x'] }), 'launchArgvMismatch'],
    [JSON.stringify({ ...good, env: { A: 1 } }), 'launchEnvInvalid'],
    [JSON.stringify({ ...good, env: { 'A=B': 'x' } }), 'launchEnvInvalid'],
  ];
  for (const [text, condition] of cases) {
    const refusal = admitLaunchDocument(text);
    assertEqual(refusal.ok, false, `refusal ${condition}`);
    assertEqual(refusal.condition, condition, `condition for ${text.slice(0, 40)}`);
  }
  const nul = admitLaunchDocument(JSON.stringify(good).replace('"A":"b"', '"A":"b\\u0000c"'));
  assertEqual(nul.condition, 'launchDocumentNul', 'NUL in the document refuses');
});

// ---------------------------------------------------------------------------
// Endpoint discovery over the recorded target stderr.

test('endpoint-watch-partial-coalesced-replacement-truncation', async () => {
  const dir = privateDir('endpoint-watch');
  const path = join(dir, 'stderr');
  const other = join(dir, 'other');

  assertEqual(JSON.stringify(parseInspectorBanner('banner ws://127.0.0.1:1/x\n')), 'null', 'no banner without the phrase');
  const partial = parseInspectorBanner('Debugger listening on ws://127.0.0.1:9000/abc');
  assertEqual(partial, null, 'a banner without its newline is not an endpoint');

  // Partial then completed append on one file.
  writeFileSync(path, '');
  const seen = [];
  const failures = [];
  const handle = watchTargetStderr({ path, onEndpoint: (value) => seen.push(value), onFailure: (value) => failures.push(value) });
  writeFileSync(path, 'Debugger listening on ws://127.0.0');
  await sleep(150);
  assertEqual(seen.length, 0, 'partial banner is not reported');
  writeFileSync(path, 'Debugger listening on ws://127.0.0.1:9001/aaaa\nFor help, see: x\n');
  await sleep(300);
  assertEqual(seen.length, 1, 'completed banner is reported once');
  assertEqual(seen[0].port, 9001, 'port');
  assertEqual(seen[0].uuid, 'aaaa', 'uuid');
  handle.stop();

  // Coalesced appends: two writes before one observation.
  writeFileSync(other, '');
  const coalesced = [];
  const handle2 = watchTargetStderr({ path: other, onEndpoint: (value) => coalesced.push(value) });
  writeFileSync(other, 'noise\nDebugger listening on ws://127.0.0.1:9002/bbbb\nmore noise\n');
  await sleep(300);
  assertEqual(coalesced.length, 1, 'coalesced append parsed');
  assertEqual(coalesced[0].uuid, 'bbbb', 'coalesced uuid');
  handle2.stop();

  // Replacement: a different file at the same path refuses.
  const replacedPath = join(dir, 'replaced');
  writeFileSync(replacedPath, 'start\n');
  const replaced = [];
  const replacedFailures = [];
  const handle3 = watchTargetStderr({
    path: replacedPath,
    onEndpoint: (value) => replaced.push(value),
    onFailure: (value) => replacedFailures.push(value),
  });
  writeFileSync(join(dir, 'replacement'), 'Debugger listening on ws://127.0.0.1:9003/cccc\n');
  renameSync(join(dir, 'replacement'), replacedPath);
  await sleep(300);
  handle3.scan();
  assertEqual(replaced.length, 0, 'replacement is not adopted');
  assertEqual(replacedFailures.length, 1, 'replacement refused');
  assertEqual(replacedFailures[0].condition, 'endpointReplaced', 'replacement condition');
  handle3.stop();

  // Truncation: a shorter file at the same identity refuses.
  const truncatedPath = join(dir, 'truncated');
  writeFileSync(truncatedPath, 'noise noise noise\n');
  const truncatedFailures = [];
  const handle4 = watchTargetStderr({ path: truncatedPath, onFailure: (value) => truncatedFailures.push(value) });
  truncateSync(truncatedPath, 3);
  await sleep(300);
  handle4.scan();
  assertEqual(truncatedFailures.length, 1, 'truncation refused');
  assertEqual(truncatedFailures[0].condition, 'endpointTruncated', 'truncation condition');
  handle4.stop();

  // Watch failure: the recorded file is gone.
  const missingFailures = [];
  const handle5 = watchTargetStderr({ path: join(dir, 'absent'), onFailure: (value) => missingFailures.push(value) });
  assertEqual(missingFailures.length, 1, 'missing file refused');
  assertEqual(missingFailures[0].condition, 'endpointWatchFailed', 'watch failure condition');
  handle5.stop();
  assertEqual(failures.length, 0, 'no unexpected failure');
});

// ---------------------------------------------------------------------------
// Captured script metadata.

test('script-table-records-metadata-and-loaded-identity', () => {
  const table = createScriptTable();
  const entry = table.record({
    scriptId: '42',
    url: 'file:///work/main.js',
    startLine: 0,
    startColumn: 0,
    endLine: 10,
    endColumn: 1,
    executionContextId: 1,
    hash: 'abcdef',
    sourceMapURL: 'file:///work/main.js.map',
  });
  assertEqual(entry.url, 'file:///work/main.js', 'url');
  assertEqual(table.byUrl('file:///work/main.js').length, 1, 'url index');
  const attached = table.attachLoaded({ scriptId: '42', source: 'const x = 1;\n' });
  assertEqual(attached.loaded.length, 13, 'loaded length');
  assertEqual(attached.loaded.sha256.length, 64, 'loaded digest');
  assertEqual(attached.map.url, 'file:///work/main.js.map', 'map reference');
  assertEqual(attached.map.embedded, false, 'map is not embedded');
  let conflict = null;
  try {
    table.record({ scriptId: '42', url: 'file:///other.js' });
  } catch (error) {
    conflict = error.condition;
  }
  assertEqual(conflict, 'scriptIdentityConflict', 'identity conflict refuses');
});

// ---------------------------------------------------------------------------
// Retained correction regressions.

test('counter-text-boundary-cases', () => {
  assert(counterValid('0'), 'the initial counter was refused');
  assert(counterValid('9'.repeat(40)), 'a long counter was refused');
  for (const invalid of ['', '00', '01', '-1', '+1', '1.0', '1e3', ' 1', '1 ', '0x1',
    '1\n', '1\r', '0\n', '1\r\n', '1\u2028', '1\u2029', '1\u0000']) {
    assertEqual(counterValid(invalid), false, `counterValid admitted ${JSON.stringify(invalid)}`);
  }
  assertEqual(counterNext('1\n').ok, false, 'a trailing line terminator was incremented');
  assertEqual(counterNext('4294967295').value, '4294967296', 'U32 boundary successor');
  assertEqual(counterNext('9007199254740991').value, '9007199254740992', 'safe-integer boundary successor');
  assertEqual(counterNext('9007199254740992').value, '9007199254740993', 'successor past the double boundary');
  assertEqual(counterNext('9'.repeat(40)).value, `1${'0'.repeat(40)}`, 'long all-nine carry');
  assertEqual(counterNext('01').ok, false, 'a non-canonical counter was normalized');
  assertEqual(counterNext('10' + '0'.repeat(30)).ok, true, 'a long canonical counter was refused');

  // A retired reference stays retired across an increment at any magnitude.
  const scope = { runtime: 'rt:c', adapter: 'adapter:1', epoch: '9007199254740992', mutationGeneration: '0' };
  const ref = refIdentity({
    runtime: 'rt:c', adapter: 'adapter:1', thread: 'main:0',
    epoch: '9007199254740992', mutationGeneration: '0', kind: 'object', handle: 'h',
  });
  assert(admitRef(ref, scope).ok, 'the live ref was refused');
  const advanced = nextState(
    { state: 'running', epoch: scope.epoch, mutationGeneration: scope.mutationGeneration, pending: null, targetLiveness: 'live' },
    { type: 'paused' },
  );
  assertEqual(advanced.record.epoch, '9007199254740993', 'the increment is exact');
  assertEqual(admitRef(ref, { ...scope, epoch: advanced.record.epoch }).condition, 'staleReference',
    'the increment re-admitted a retired ref');
});

test('transport-refuses-non-loopback-and-keeps-the-endpoint-out-of-errors', async () => {
  assertEqual(admitLoopbackEndpoint('ws://10.0.0.5:9229/uuid').condition, 'endpointNotLoopback',
    'a non-loopback endpoint was admitted');
  assertEqual(admitLoopbackEndpoint('not a url').condition, 'endpointMalformed', 'a malformed endpoint was admitted');
  assertEqual(admitLoopbackEndpoint('http://127.0.0.1:9229/uuid').condition, 'endpointNotWebSocket',
    'a non-websocket endpoint was admitted');
  assert(admitLoopbackEndpoint('ws://127.0.0.1:9229/uuid').ok, 'a loopback endpoint was refused');
  const { CdpTransport } = await import('./cdp-transport.mjs');
  let refusal = null;
  try {
    await CdpTransport.connect('ws://198.51.100.7:9229/secret-uuid');
  } catch (error) {
    refusal = error;
  }
  assert(refusal !== null, 'a non-loopback connection was attempted');
  assertEqual(refusal.condition, 'endpointNotLoopback', 'the connection refusal condition');
  assert(!JSON.stringify(refusal.detail ?? '').includes('secret-uuid'), 'the refusal disclosed the endpoint');
  assert(!refusal.message.includes('secret-uuid'), 'the refusal message disclosed the endpoint');
});



test('bootstrap-exec-in-place-same-pid-and-declared-environment', async () => {
  const slug = 'bootstrap-exec-in-place';
  const keeper = spawnKeeper({
    slug,
    target: join(HERE, 'cdp-fixture-longrun.mjs'),
    env: { PATH: '/usr/bin:/bin', BATON_CDP_FIXTURE_MARKER: 'declared-value' },
  });
  const { session } = openSession({ slug, runtime: 'rt:bootstrap', keeper });
  try {
    const endpoint = await withDeadline(keeper.endpoint(), 20000, 'endpoint');
    const launchRecords = read(keeper.stderrPath).trim().split('\n').map((line) => JSON.parse(line));
    const prepared = launchRecords.find((record) => record.kind === 'launchPrepared');
    assert(prepared !== undefined, 'the bootstrap recorded its pre-exec phase');
    assertEqual(prepared.phase, 'pre-exec', 'the record names its own phase');
    assert(prepared.executable.resolved !== null, 'the executable resolution is recorded');
    assert(prepared.executable.size > 0, 'the executable size is recorded');
    assert(typeof prepared.executable.mode === 'string', 'the executable mode is recorded');
    assert(prepared.bootstrap.sha256 !== prepared.executable.resolved, 'bootstrap and executable identities are distinct');
    assert(prepared.bootstrap.path.endsWith('bootstrap.mjs'), 'bootstrap path recorded');
    assertEqual(prepared.envKeys.join(','), 'BATON_CDP_FIXTURE_MARKER,PATH', 'declared environment keys');

    await session.execute('launch', { effects: ['controlRuntime'], webSocketUrl: endpoint.url });
    const paused = await withDeadline(session.waitFor('Debugger.paused'), 15000, 'initial pause');
    assertEqual(paused.params.reason, 'Break on start', 'initial break');
    await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });

    // The target runs, so its heartbeat carries the pid and environment it sees.
    let heartbeat = null;
    for (let attempt = 0; attempt < 100 && heartbeat === null; attempt += 1) {
      await sleep(50);
      const lines = read(keeper.stdoutPath).trim().split('\n').filter((line) => line.length > 0);
      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.heartbeat === true) heartbeat = record;
      }
    }
    assert(heartbeat !== null, 'the target produced a heartbeat');
    assertEqual(heartbeat.pid, keeper.pid, 'the target kept the bootstrap pid: no surviving wrapper');
    assertEqual(heartbeat.marker, 'declared-value', 'the declared marker reached the target');
    const platformInjected = heartbeat.envKeys.filter((key) => !['PATH', 'BATON_CDP_FIXTURE_MARKER'].includes(key));
    assert(platformInjected.every((key) => key === '__CF_USER_TEXT_ENCODING'),
      `unexpected inherited variables: ${platformInjected.join(',')}`);

    const release = await session.execute('release', { effects: ['controlRuntime'], signal: 'SIGKILL', query: 'q-release' });
    assertEqual(release.state, 'releasing', 'release records the intent');
    assertEqual(release.keeper.disposition, 'acknowledged', 'the keeper result is adopted');
    const exit = await withDeadline(keeper.exited, 10000, 'target exit');
    assertEqual(exit.signal, 'SIGKILL', 'actual exit evidence names the signal');
    assertEqual(session.snapshot().state, 'releasing', 'the adapter reports no exit it did not observe');
  } finally {
    session.close();
    keeper.stop();
  }
});

test('paused-target-breakpoint-stop-and-epoch-mutation-retirement', async () => {
  const slug = 'breakpoint-stop';
  const target = join(HERE, 'cdp-fixture-basic.mjs');
  const keeper = spawnKeeper({ slug, target, env: { PATH: '/usr/bin:/bin' } });
  const { session } = openSession({ slug, runtime: 'rt:breakpoint', keeper });
  const source = read(target).split('\n');
  const breakLine = source.findIndex((line) => line.includes('const value = counter.total;'));
  assert(breakLine > 0, 'fixture breakpoint line found');
  try {
    const endpoint = await withDeadline(keeper.endpoint(), 20000, 'endpoint');
    await session.execute('launch', { effects: ['controlRuntime'], webSocketUrl: endpoint.url });
    const first = await withDeadline(session.waitFor('Debugger.paused'), 15000, 'initial pause');
    assertEqual(session.snapshot().epoch, '1', 'initial pause epoch');
    const scope = session.snapshot().refScope;
    const staleProbe = refIdentity({
      runtime: scope.runtime, adapter: scope.adapter, thread: 'main:0',
      epoch: scope.epoch, mutationGeneration: scope.mutationGeneration, kind: 'object', handle: 'probe',
    });
    assert(session.admitRef(staleProbe).ok, 'a ref at the live epoch is admitted');

    const breakpoint = await session.control({
      query: 'q-breakpoint',
      method: 'Debugger.setBreakpointByUrl',
      params: { url: pathToFileURL(target).href, lineNumber: breakLine },
      effects: ['controlRuntime'],
    });
    assert(typeof breakpoint.result.breakpointId === 'string', 'breakpoint id recorded');
    await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
    const stopped = await withDeadline(
      session.waitFor('Debugger.paused', { predicate: (params) => (params.hitBreakpoints ?? []).length > 0 }),
      15000,
      'breakpoint stop',
    );
    const snapshot = session.snapshot();
    assertEqual(snapshot.state, 'paused', 'stopped at the requested breakpoint');
    assertEqual(stopped.params.hitBreakpoints.length, 1, 'one hit breakpoint');
    assertEqual(stopped.params.callFrames[0].location.lineNumber, breakLine, 'stopped on the requested line');

    const refusal = session.admitRef(staleProbe);
    assertEqual(refusal.condition, 'staleReference', 'the previous pause ref is stale');

    // A live-value ref issued during this pause is retired by the evaluation.
    const frame = stopped.params.callFrames[0];
    const local = frame.scopeChain.find((entry) => entry.type === 'local') ?? frame.scopeChain[0];
    const properties = await session.send({
      query: 'q-locals',
      method: 'Runtime.getProperties',
      params: { objectId: local.object.objectId, ownProperties: true },
    });
    const counter = properties.result.result.find((row) => row.name === 'counter');
    assert(counter !== undefined && counter.value !== undefined, 'counter local read');
    const liveRef = refIdentity({
      runtime: scope.runtime, adapter: scope.adapter, thread: 'main:0',
      epoch: snapshot.epoch, mutationGeneration: snapshot.mutationGeneration, kind: 'object', handle: counter.value.objectId,
    });
    assert(session.admitRef(liveRef).ok, 'counter ref admitted at this pause');
    const evaluated = await session.execute('evaluate', {
      effects: ['controlRuntime', 'evaluateRuntime'],
      expression: 'counter.total',
      frame: frame.callFrameId,
      query: 'q-eval',
    });
    assertEqual(evaluated.inBandException, false, 'no in-band exception');
    assertEqual(evaluated.result.result.value, 6, 'evaluated total');
    assertEqual(session.snapshot().mutationGeneration, counterNext(snapshot.mutationGeneration).value,
      'evaluation advances the mutation generation by exactly one successor');
    assertEqual(session.admitRef(liveRef).condition, 'refRetiredByMutation', 'the live-value ref is retired');

    await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
    const exit = await withDeadline(keeper.exited, 15000, 'target exit');
    assertEqual(exit.code, 0, 'target exited normally');
    const summary = JSON.parse(read(keeper.stdoutPath).trim().split('\n').pop());
    assertEqual(summary.total, 6, 'fixture total');
    assertEqual(summary.pid, keeper.pid, 'same child across the bootstrap');
  } finally {
    session.close();
    keeper.stop();
  }
});

test('property-descriptors-do-not-execute-getters', async () => {
  const slug = 'descriptor-read';
  const target = join(HERE, 'cdp-fixture-basic.mjs');
  const keeper = spawnKeeper({ slug, target, env: { PATH: '/usr/bin:/bin' } });
  const { session } = openSession({ slug, runtime: 'rt:descriptor', keeper });
  const source = read(target).split('\n');
  const breakLine = source.findIndex((line) => line.includes('const value = counter.total;'));
  try {
    const endpoint = await withDeadline(keeper.endpoint(), 20000, 'endpoint');
    await session.execute('launch', { effects: ['controlRuntime'], webSocketUrl: endpoint.url });
    await withDeadline(session.waitFor('Debugger.paused'), 15000, 'initial pause');
    await session.control({
      query: 'q-breakpoint',
      method: 'Debugger.setBreakpointByUrl',
      params: { url: pathToFileURL(target).href, lineNumber: breakLine },
      effects: ['controlRuntime'],
    });
    await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
    const stopped = await withDeadline(
      session.waitFor('Debugger.paused', { predicate: (params) => (params.hitBreakpoints ?? []).length > 0 }),
      15000,
      'breakpoint stop',
    );
    const frame = stopped.params.callFrames[0];
    const local = frame.scopeChain.find((entry) => entry.type === 'local') ?? frame.scopeChain[0];
    const locals = await session.send({
      query: 'q-locals',
      method: 'Runtime.getProperties',
      params: { objectId: local.object.objectId, ownProperties: true },
    });
    const counter = locals.result.result.find((row) => row.name === 'counter');
    const instance = await session.send({
      query: 'q-instance',
      method: 'Runtime.getProperties',
      params: { objectId: counter.value.objectId, ownProperties: false, accessorPropertiesOnly: false },
    });
    const accessor = instance.result.result.find((row) => row.name === 'total');
    assert(accessor !== undefined, 'accessor descriptor read');
    assert(accessor.get !== undefined && accessor.get !== null, 'the descriptor carries the getter');
    assert(accessor.value === undefined, 'no value was produced for the accessor');
    // The fixture counts getter invocations and is stopped before its own read,
    // so a getter ran exactly once at the end: its own read, and no descriptor
    // read executed it.
    await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
    const exit = await withDeadline(keeper.exited, 15000, 'target exit');
    assertEqual(exit.code, 0, 'target exited normally');
    const summary = JSON.parse(read(keeper.stdoutPath).trim().split('\n').pop());
    assertEqual(summary.getterCalls, 1, 'only the target read invoked the getter');
    assertEqual(summary.total, 6, 'fixture total');
  } finally {
    session.close();
    keeper.stop();
  }
});

test('pending-evaluation-admits-release-while-unanswered', async () => {
  const slug = 'pending-evaluation';
  const keeper = spawnKeeper({ slug, target: join(HERE, 'cdp-fixture-longrun.mjs'), env: { PATH: '/usr/bin:/bin' } });
  const { session } = openSession({ slug, runtime: 'rt:pending', keeper });
  try {
    const endpoint = await withDeadline(keeper.endpoint(), 20000, 'endpoint');
    await session.execute('launch', { effects: ['controlRuntime'], webSocketUrl: endpoint.url });
    await withDeadline(session.waitFor('Debugger.paused'), 15000, 'initial pause');

    let settled = false;
    let outcome = null;
    const evaluation = session.execute('evaluate', {
      effects: ['controlRuntime', 'evaluateRuntime'],
      expression: '(() => { for (;;) {} })()',
      query: 'q-blocking',
    }).then(
      (value) => { settled = true; outcome = { ok: true, value }; },
      (error) => { settled = true; outcome = { ok: false, condition: error.condition ?? null }; },
    );
    await sleep(500);
    assertEqual(settled, false, 'the blocking evaluation has not responded');
    const pending = session.snapshot().pending;
    assertEqual(pending.intent, 'evaluate', 'the evaluation is recorded as pending');
    const outbound = session.frames().filter((frame) => frame.direction === 'out'
      && JSON.parse(frame.text).method === 'Runtime.evaluate');
    assertEqual(outbound.length, 1, 'one evaluation request was sent');
    const requestId = JSON.parse(outbound[0].text).id;
    const answered = session.frames().some((frame) => frame.direction === 'in'
      && JSON.parse(frame.text).id === requestId);
    assertEqual(answered, false, 'no response arrived for the blocking evaluation');

    const release = await session.execute('release', {
      effects: ['controlRuntime'],
      signal: 'SIGKILL',
      query: 'q-release',
    });
    assertEqual(release.state, 'releasing', 'release is admitted while the evaluation is pending');
    assertEqual(release.keeper.disposition, 'acknowledged', 'the keeper adopted the signal');
    const exit = await withDeadline(keeper.exited, 10000, 'target exit');
    assertEqual(exit.signal, 'SIGKILL', 'the keeper observed the signal');
    await withDeadline(evaluation, 10000, 'evaluation promise settled after the socket closed');
    assertEqual(settled, true, 'the evaluation finally settled');
    assertEqual(outcome.ok, false, 'it settled as a transport failure, not a fabricated response');
    assertEqual(outcome.condition, 'transportClosed', 'the recorded condition names the closed transport');
  } finally {
    session.close();
    keeper.stop();
  }
});

test('transport-loss-marks-the-stop-historical-and-keeps-target-custody', async () => {
  const slug = 'transport-loss';
  const keeper = spawnKeeper({ slug, target: join(HERE, 'cdp-fixture-longrun.mjs'), env: { PATH: '/usr/bin:/bin' } });
  const { session } = openSession({ slug, runtime: 'rt:loss', keeper });
  try {
    const endpoint = await withDeadline(keeper.endpoint(), 20000, 'endpoint');
    await session.execute('launch', { effects: ['controlRuntime'], webSocketUrl: endpoint.url });
    await withDeadline(session.waitFor('Debugger.paused'), 15000, 'initial pause');
    const stopped = session.snapshot();
    assertEqual(stopped.state, 'paused', 'the target is stopped');
    assertEqual(stopped.lastPause.liveness, 'live', 'the recorded stop is live');

    // The connection is lost. The stop becomes historical and the adapter records its own
    // failure; target custody stays with the keeper.
    session.close();
    await sleep(200);
    const lost = session.snapshot();
    assertEqual(lost.state, 'failed', 'the adapter failure state');
    assertEqual(lost.targetLiveness, 'live', 'transport loss asserted a target exit');
    assertEqual(lost.lastPause.liveness, 'historical', 'the stop is no longer live');
    assertEqual(lost.failure.condition, 'transportClosed', 'the retained transport condition');
    assert(!JSON.stringify(lost).includes(endpoint.uuid), 'the snapshot disclosed the endpoint');

    let alive = true;
    try {
      process.kill(keeper.pid, 0);
    } catch {
      alive = false;
    }
    assert(alive, 'the target process is still alive after the adapter lost its connection');

    // Only the target observer's evidence changes liveness.
    keeper.child.kill('SIGKILL');
    const exit = await withDeadline(keeper.exited, 10000, 'target exit after the keeper reap');
    assertEqual(exit.signal, 'SIGKILL', 'the keeper observed the target signal');
    await session.execute('release', { effects: ['controlRuntime'], signal: 'SIGKILL', query: 'q-release' });
    assertEqual(session.childExited({ signal: 'SIGKILL' }), 'exited', 'target-observer evidence sets the state');
    assertEqual(session.snapshot().targetLiveness, 'exited', 'target-observer evidence sets liveness');
  } finally {
    session.close();
    keeper.stop();
  }
});

test('adapter-loss-leaves-live-target-and-keeper-reaps', async () => {
  const slug = 'adapter-loss';
  const keeper = spawnKeeper({ slug, target: join(HERE, 'cdp-fixture-longrun.mjs'), env: { PATH: '/usr/bin:/bin' } });
  const dir = evidenceDir(slug);
  const readiness = join(dir, 'holder.ready');
  try {
    const endpoint = await withDeadline(keeper.endpoint(), 20000, 'endpoint');
    const holderOut = join(dir, 'holder.stdout');
    const holderErr = join(dir, 'holder.stderr');
    writeFileSync(holderOut, '');
    writeFileSync(holderErr, '');
    const outFd = openSync(holderOut, 'a');
    const errFd = openSync(holderErr, 'a');
    const holder = spawn(TARGET_NODE, [join(HERE, 'cdp-fixture-adapter-holder.mjs'), endpoint.url, readiness], {
      stdio: ['ignore', outFd, errFd],
    });
    closeSync(outFd);
    closeSync(errFd);
    await withDeadline(waitForFile(readiness, 20000), 20000, 'holder readiness');

    const heartbeats = () => read(keeper.stdoutPath).split('\n').filter((line) => line.includes('"heartbeat":true')).length;
    const before = heartbeats();
    assert(before > 0, 'the target was running under the adapter');

    holder.kill('SIGKILL');
    await new Promise((resolveExit) => holder.on('exit', resolveExit));
    await sleep(600);

    // The adapter owned no target lifetime: the target keeps running.
    const after = heartbeats();
    assert(after > before, `the target kept running after the adapter died (${before} -> ${after})`);
    let alive = true;
    try {
      process.kill(keeper.pid, 0);
    } catch {
      alive = false;
    }
    assert(alive, 'the target process is still alive');
    assertEqual(keeper.child.exitCode, null, 'the keeper reports no exit while the target runs');

    // The keeper performs the reap, which is the native release boundary.
    keeper.child.kill('SIGKILL');
    const exit = await withDeadline(keeper.exited, 10000, 'target exit after the keeper reap');
    assertEqual(exit.signal, 'SIGKILL', 'the keeper observed the target signal');
    writeFileSync(join(dir, 'holder.stdout.after'), read(holderOut));
  } finally {
    keeper.stop();
  }
});

test('worker-attachment-records-thread-identity', async () => {
  const slug = 'worker';
  const keeper = spawnKeeper({ slug, target: join(HERE, 'cdp-fixture-worker.mjs'), env: { PATH: '/usr/bin:/bin' } });
  const { session } = openSession({ slug, runtime: 'rt:worker', keeper });
  try {
    const endpoint = await withDeadline(keeper.endpoint(), 20000, 'endpoint');
    await session.execute('launch', { effects: ['controlRuntime'], webSocketUrl: endpoint.url });
    await withDeadline(session.waitFor('Debugger.paused'), 15000, 'initial pause');
    await session.send({ query: 'q-worker-enable', method: 'NodeWorker.enable', params: { waitForDebuggerOnStart: false } });
    const attached = session.waitFor('NodeWorker.attachedToWorker', { after: 0 });
    await session.execute('resume-step', { effects: ['controlRuntime'], action: 'resume' });
    const event = await withDeadline(attached, 15000, 'worker attachment');
    const workerId = String(event.params.workerInfo?.workerId ?? '');
    assert(workerId.length > 0, 'worker id recorded');
    const threads = session.threads();
    assert(threads.some((row) => row.thread === `worker:${workerId}`), `thread identity recorded: ${JSON.stringify(threads)}`);
    assertEqual(session.snapshot().workers.length, 1, 'one attached worker');
    await sleep(500);
    const parent = read(keeper.stdoutPath).trim().split('\n')
      .map((line) => JSON.parse(line))
      .find((record) => record.fromWorker !== undefined);
    assert(parent !== undefined, 'the parent observed the worker message');
    assertEqual(parent.fromWorker.workerReady, true, 'the worker was not paused before its message');
    await session.execute('release', { effects: ['controlRuntime'], signal: 'SIGKILL', query: 'q-release' });
    const exit = await withDeadline(keeper.exited, 10000, 'target exit');
    assertEqual(exit.signal, 'SIGKILL', 'the keeper observed the target signal');
  } finally {
    session.close();
    keeper.stop();
  }
});

// ---------------------------------------------------------------------------
// Runner.

async function main() {
  const selected = CASES.filter((entry) => FILTER === null || entry.name.includes(FILTER));
  for (const entry of selected) {
    const started = Date.now();
    try {
      await withDeadline(Promise.resolve().then(entry.fn), 60000, entry.name);
      results.push({ name: entry.name, ok: true, ms: Date.now() - started });
      process.stdout.write(`ok   ${entry.name}\n`);
    } catch (error) {
      results.push({ name: entry.name, ok: false, ms: Date.now() - started, detail: error.message, condition: error.condition ?? null });
      process.stdout.write(`FAIL ${entry.name}: ${error.message}\n`);
    }
  }
  const failed = results.filter((row) => !row.ok);
  const verdict = {
    suite: 'cdp',
    node: TARGET_NODE,
    nodeVersion: readNodeVersion(TARGET_NODE),
    evidence: RUN,
    cases: results.length,
    failed: failed.length,
    results,
  };
  writeFileSync(join(RUN, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ verdict: verdict.failed === 0 ? 'pass' : 'fail', cases: verdict.cases, failed: verdict.failed, run: RUN })}\n`);
  process.exitCode = verdict.failed === 0 ? 0 : 1;
}

function readNodeVersion(node) {
  try {
    return execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

await main();
