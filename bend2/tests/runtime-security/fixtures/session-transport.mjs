// Fixture: outbound-frame behavior through the production session, the injected
// connect factory and the real inspector path.
//
// Target: immutable CDP commit 24ecd9d9 (cdp-session sha256 b441b3cf,
// cdp-transport sha256 b147efcd), where createAdapterSession accepts an injected
// `connect` factory defaulting to CdpTransport.connect.
//
// Controlled path: a fixture transport records every outbound frame, so
// "a refused request emits no frame" and "an admitted request emits exactly one"
// are measured deterministically. Real path: a live inspector child, so the
// claims are also observed on the production transport. Intents carry their
// actual grants and pending state comes from adapter evidence, not elapsed time.
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, FIXTURE_ENTRIES, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment, writeStream } from '../lib/assert.mjs';
import { cleanupOwned, own } from '../lib/children.mjs';
import { requirePin } from '../lib/pins.mjs';
import { parseBanner, waitFor } from '../lib/net.mjs';

let environment;
try {
  environment = openEnvironmentOrExit(FIXTURE_ENTRIES['session-transport']);
  if (environment.pin !== null) requirePin(environment, 'session-transport');
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('session-transport', environment);
const CONTROL = ['controlRuntime'];
const EVALUATE = ['controlRuntime', 'evaluateRuntime'];
const breakpointParams = { url: 'file:///tmp/fixture.js', lineNumber: 3 };
const conditionParams = { ...breakpointParams, condition: '(globalThis.__baton_condition_ran = true, false)' };
const BLOCKED = 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)';

const sessionModule = await import(environment.runtimePath('cdp-session.mjs'));
const transportModule = await import(environment.runtimePath('cdp-transport.mjs'));

// ---- Controlled transport -------------------------------------------------
function createStubTransport() {
  const frames = [];
  const handlers = new Map();
  const evaluateCalls = [];
  let failureValue = null;
  return {
    frames: () => frames.slice(),
    failure: () => failureValue,
    // The real connection exposes endpoint identity as a data string, not a
    // function; the stub models that operative shape.
    endpointIdentity: 'stub-identity',
    subscribe(method, handler) {
      const list = handlers.get(method) ?? [];
      list.push(handler);
      handlers.set(method, list);
      return () => handlers.set(method, (handlers.get(method) ?? []).filter((item) => item !== handler));
    },
    subscribeFailure(handler) {
      handlers.set('__failure', [handler]);
      return () => handlers.delete('__failure');
    },
    send(method, params = {}) {
      const text = JSON.stringify({ method, params });
      frames.push({ direction: 'out', method, text });
      return Promise.resolve({});
    },
    // The production session calls connection.evaluate for the evaluate intent,
    // never send. This records the invocation and an outbound frame, then stays
    // pending: the target thread is blocked.
    evaluateCalls,
    evaluate(method, params = {}) {
      evaluateCalls.push({ method, params });
      frames.push({ direction: 'out', method, text: JSON.stringify({ method, params }) });
      return new Promise(() => {});
    },
    close() {
      failureValue = { condition: 'transportClosed', detail: 'fixture stub closed' };
    },
    emit(method, params) {
      for (const handler of handlers.get(method) ?? []) handler(params ?? {}, { method, params: params ?? {} });
    },
  };
}

const outbound = (session) => session.frames().filter((frame) => frame.direction === 'out');
const outboundMethods = (session) => outbound(session).map((frame) => frame.method);

const controlled = {};
let controlledSession = null;
// Retained settlement state lives in the enclosing scope so the checks and the
// result can use it after the finally block, and so its wait can be bounded.
const controlledReleaseCalls = [];
const controlledSettlement = { status: 'unresolved' };
let settlementSettled = null;
const settlementDone = new Promise((resolve) => {
  settlementSettled = resolve;
});
try {
  const stub = createStubTransport();
  const connectCalls = [];
  controlledSession = sessionModule.createAdapterSession({
    runtime: 'rt:controlled',
    adapter: 'fixture-adapter',
    incarnation: '0',
    connect: async (url) => {
      connectCalls.push(url);
      return stub;
    },
    control: {
      release: async (args) => {
        controlledReleaseCalls.push({ signal: args?.signal ?? null, role: args?.role ?? null });
        return { accepted: true, fixtureKeeper: 'stub', signal: args?.signal ?? null };
      },
    },
    emit: () => {},
  });

  const launch = await controlledSession.execute('launch', {
    query: 'q-launch', webSocketUrl: 'ws://127.0.0.1:9229/stub', effects: CONTROL,
  });
  controlled.connectCalls = connectCalls;
  controlled.launchState = launch?.state ?? null;
  controlled.afterLaunchFrames = outboundMethods(controlledSession);
  controlled.startupSnapshot = controlledSession.snapshot().state;

  let refusal = null;
  try {
    await controlledSession.control({ query: 'q-refuse', method: 'Debugger.setBreakpointByUrl', params: conditionParams, effects: CONTROL });
    refusal = { ok: true };
  } catch (error) {
    refusal = { refused: error.condition ?? error.name ?? String(error) };
  }
  controlled.refusal = refusal;
  controlled.framesAfterRefusal = outbound(controlledSession).length;

  let positive = null;
  try {
    const result = await controlledSession.control({ query: 'q-positive', method: 'Debugger.setBreakpointByUrl', params: breakpointParams, effects: CONTROL });
    positive = { ok: true, category: result?.category ?? null };
  } catch (error) {
    positive = { refused: error.condition ?? error.name ?? String(error) };
  }
  controlled.positive = positive;
  controlled.framesAfterPositive = outbound(controlledSession).length;

  const evaluation = controlledSession.execute('evaluate', { query: 'q-eval', expression: BLOCKED, effects: EVALUATE });
  evaluation.then(
    (value) => {
      controlledSettlement.status = 'settled';
      controlledSettlement.value = value?.state ?? null;
      settlementSettled();
    },
    (error) => {
      controlledSettlement.status = 'rejected';
      controlledSettlement.condition = error?.condition ?? error?.name ?? String(error);
      settlementSettled();
    },
  );
  const pendingObserved = await waitFor(
    () => controlledSession.snapshot().pending !== null && outboundMethods(controlledSession).includes('Runtime.evaluate'),
    5000,
  );
  controlled.pendingObserved = pendingObserved.value === true;
  controlled.pendingSnapshot = controlledSession.snapshot().pending;
  controlled.evaluateCalls = stub.evaluateCalls.slice();
  controlled.framesBeforeBusy = outbound(controlledSession).length;

  let busy = null;
  try {
    await controlledSession.control({ query: 'q-busy', method: 'Runtime.runIfWaitingForDebugger', params: {}, effects: CONTROL });
    busy = { ok: true };
  } catch (error) {
    busy = { refused: error.condition ?? error.name ?? String(error) };
  }
  controlled.busy = busy;
  controlled.framesAfterBusy = outbound(controlledSession).length;

  let release = null;
  try {
    release = { ok: true, result: await controlledSession.execute('release', { query: 'q-release', signal: 'SIGTERM', effects: CONTROL }) };
  } catch (error) {
    release = { refused: error.condition ?? error.name ?? String(error) };
  }
  controlled.release = release;
  controlled.releaseCalls = controlledReleaseCalls.slice();
  controlled.settlement = controlledSettlement;

  // S5 boundary observation: with an injected factory the session itself does no
  // endpoint validation, so a non-loopback URL reaches the factory. Recorded, not
  // asserted as a defect; the property lives in the default factory.
  const injectedCalls = [];
  const observerSession = sessionModule.createAdapterSession({
    runtime: 'rt:observer', adapter: 'fixture-adapter', incarnation: '0',
    connect: async (url) => {
      injectedCalls.push(url);
      return createStubTransport();
    },
    control: { release: async () => ({ accepted: true }) },
    emit: () => {},
  });
  let nonLoopback = null;
  try {
    await observerSession.execute('launch', { query: 'q-nonloopback', webSocketUrl: 'ws://10.0.0.5:9229/abc', effects: CONTROL });
    nonLoopback = { admitted: true };
  } catch (error) {
    nonLoopback = { refused: error.condition ?? error.name ?? String(error) };
  }
  controlled.nonLoopbackWithInjectedFactory = { outcome: nonLoopback, factoryCalls: injectedCalls };
} catch (error) {
  controlled.failure = String(error?.stack ?? error);
}

// ---- Default-factory loopback admission (no socket is dialled) -------------
const loopback = {};
try {
  const nonLoopback = transportModule.admitLoopbackEndpoint('ws://10.0.0.5:9229/abc');
  const insecure = transportModule.admitLoopbackEndpoint('wss://127.0.0.1:9229/abc');
  const malformed = transportModule.admitLoopbackEndpoint('not-a-url');
  const portless = transportModule.admitLoopbackEndpoint('ws://127.0.0.1/');
  const ok = transportModule.admitLoopbackEndpoint('ws://127.0.0.1:9229/uuid-1');
  loopback.admit = { nonLoopback, insecure, malformed, portless, ok };
  try {
    await transportModule.CdpTransport.connect('ws://10.0.0.5:9229/abc');
    loopback.defaultConnect = { resolved: true };
  } catch (error) {
    loopback.defaultConnect = { refused: error.condition ?? error.name ?? String(error) };
  }
} catch (error) {
  loopback.failure = String(error?.stack ?? error);
}

// ---- Real inspector path ---------------------------------------------------
const live = {};
let liveSession = null;
const child = spawn(
  '/usr/bin/env',
  ['-i', 'PATH=/usr/bin:/bin', 'HOME=/tmp/baton-fixture-home', 'TMPDIR=/tmp', 'LC_ALL=C',
    environment.floorNode, '--inspect-brk=127.0.0.1:0', environment.helperPath('subject.mjs')],
  { cwd: environment.evidenceDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
);
const custody = own(child);
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));
let rawStdout = null;
let rawStderr = null;
let cleanupReport = null;
try {
  const found = await waitFor(() => parseBanner(stderr), 20000);
  live.banner = found.value;
  if (found.value !== null) {
    liveSession = sessionModule.createAdapterSession({
      runtime: 'rt:live', adapter: 'fixture-adapter', incarnation: '0',
      control: { release: async () => ({ accepted: true, fixtureKeeper: 'stub' }) },
      emit: () => {},
    });
    await liveSession.execute('launch', { query: 'q-live', webSocketUrl: found.value.url, effects: CONTROL });
    const before = outbound(liveSession).length;
    let refusal = null;
    try {
      await liveSession.control({ query: 'q-live-refuse', method: 'Debugger.setBreakpointByUrl', params: conditionParams, effects: CONTROL });
      refusal = { ok: true };
    } catch (error) {
      refusal = { refused: error.condition ?? error.name ?? String(error) };
    }
    const afterRefusal = outbound(liveSession).length;
    let positive = null;
    try {
      await liveSession.control({ query: 'q-live-positive', method: 'Debugger.setBreakpointByUrl', params: breakpointParams, effects: CONTROL });
      positive = { ok: true };
    } catch (error) {
      positive = { refused: error.condition ?? error.name ?? String(error) };
    }
    live.framesBefore = before;
    live.refusal = refusal;
    live.framesAfterRefusal = afterRefusal;
    live.positive = positive;
    live.framesAfterPositive = outbound(liveSession).length;
  }
} catch (error) {
  live.failure = String(error?.stack ?? error);
} finally {
  custody.kill('SIGKILL');
  cleanupReport = await cleanupOwned({ timeoutMs: 5000 });
  const partial = child.pid !== undefined && cleanupReport.unresolved.includes(child.pid);
  rawStdout = { ...writeStream(environment, 'session-transport.subject.stdout.txt', stdout), partial };
  rawStderr = { ...writeStream(environment, 'session-transport.subject.stderr.txt', stderr), partial };
  // Bounded settlement observation: a bound that elapses is recorded as unknown,
  // never as a settled outcome.
  const settlementWait = await Promise.race([
    settlementDone.then(() => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000)),
  ]);
  controlled.settlementWait = settlementWait;
  controlled.settlementUnknown = settlementWait !== 'settled';
  // Live transport closure: observe the recorded failure with a bound.
  if (liveSession !== null) {
    const closure = await waitFor(() => {
      try {
        return liveSession.snapshot().failure !== null;
      } catch {
        return false;
      }
    }, 3000);
    let snapshot = null;
    try {
      snapshot = liveSession.snapshot();
    } catch (error) {
      snapshot = { refused: String(error?.message ?? error) };
    }
    live.transportClosure = {
      recorded: closure.value === true,
      timedOutUnknown: closure.value !== true,
      elapsedMs: closure.elapsedMs,
      failure: snapshot?.failure ?? null,
      state: snapshot?.state ?? null,
    };
  }
}

// ---- Assertions ------------------------------------------------------------
reporter.check('controlled:connect-factory-invoked',
  controlled.connectCalls?.length === 1 && controlled.connectCalls[0] === 'ws://127.0.0.1:9229/stub', controlled.connectCalls);
reporter.check('controlled:startup-frames-sent',
  ['Runtime.enable', 'Debugger.enable'].every((method) => (controlled.afterLaunchFrames ?? []).includes(method)),
  controlled.afterLaunchFrames);
reporter.check('controlled:startup-state-observed',
  typeof controlled.startupSnapshot === 'string', controlled.startupSnapshot);
reporter.check('controlled:condition-refused',
  controlled.refusal?.refused === 'breakpointConditionUnsupported', controlled.refusal);
reporter.check('controlled:refusal-emits-no-frame',
  controlled.framesAfterRefusal === controlled.afterLaunchFrames?.length,
  { before: controlled.afterLaunchFrames?.length, after: controlled.framesAfterRefusal });
reporter.check('controlled:valid-control-admitted', controlled.positive?.ok === true, controlled.positive);
reporter.check('controlled:admitted-control-emits-one-frame',
  controlled.framesAfterPositive === controlled.afterLaunchFrames?.length + 1,
  { before: controlled.afterLaunchFrames?.length, after: controlled.framesAfterPositive });
reporter.check('controlled:pending-from-adapter-evidence',
  controlled.pendingObserved === true && controlled.pendingSnapshot !== null,
  { pending: controlled.pendingSnapshot, observed: controlled.pendingObserved });
reporter.check('controlled:evaluate-invocation-recorded',
  Array.isArray(controlled.evaluateCalls) && controlled.evaluateCalls.length === 1
  && controlled.evaluateCalls[0].method === 'Runtime.evaluate', controlled.evaluateCalls);
reporter.check('controlled:no-unexpected-rejection',
  controlled.settlement?.status !== 'rejected'
  || ['transportClosed', 'transportError', 'transportAborted'].includes(controlled.settlement?.condition),
  controlled.settlement);
reporter.check('controlled:busy-refused-while-pending',
  controlled.busy?.refused === 'runtimeBusy', controlled.busy);
reporter.check('controlled:busy-emits-no-frame',
  controlled.framesAfterBusy === controlled.framesBeforeBusy,
  { before: controlled.framesBeforeBusy, after: controlled.framesAfterBusy });
reporter.check('controlled:release-admitted-while-pending', controlled.release?.ok === true, controlled.release);
reporter.check('controlled:release-invoked-once',
  Array.isArray(controlled.releaseCalls) && controlled.releaseCalls.length === 1, controlled.releaseCalls);
reporter.check('controlled:settlement-observed-without-false-claim',
  ['settled', 'rejected', 'unresolved'].includes(controlled.settlement?.status)
  && ['settled', 'timeout'].includes(controlled.settlementWait)
  && (controlled.settlementWait === 'settled' ? controlled.settlement.status !== 'unresolved' : true),
  { status: controlled.settlement?.status, wait: controlled.settlementWait });
reporter.check('controlled:no-setup-failure', controlled.failure === undefined, controlled.failure);
reporter.check('loopback:non-loopback-refused-by-admission',
  loopback.admit?.nonLoopback?.ok === false && loopback.admit.nonLoopback.condition === 'endpointNotLoopback',
  loopback.admit?.nonLoopback);
reporter.check('loopback:insecure-scheme-refused',
  loopback.admit?.insecure?.ok === false && loopback.admit.insecure.condition === 'endpointNotWebSocket',
  loopback.admit?.insecure);
reporter.check('loopback:malformed-refused',
  loopback.admit?.malformed?.ok === false, loopback.admit?.malformed);
reporter.check('loopback:valid-loopback-admitted-with-identity',
  loopback.admit?.ok?.ok === true && typeof loopback.admit.ok.identity === 'string', loopback.admit?.ok);
reporter.check('loopback:default-connect-refuses-non-loopback',
  loopback.defaultConnect?.refused === 'endpointNotLoopback', loopback.defaultConnect);
reporter.check('live:banner-present', live.banner !== undefined && live.banner !== null, stderr.split('\n').slice(-2).join(' | '));
reporter.check('live:refusal-emits-no-frame',
  live.refusal?.refused === 'breakpointConditionUnsupported' && live.framesAfterRefusal === live.framesBefore,
  { before: live.framesBefore, after: live.framesAfterRefusal, refusal: live.refusal });
reporter.check('live:admitted-control-emits-one-frame',
  live.positive?.ok === true && live.framesAfterPositive === live.framesBefore + 1,
  { before: live.framesBefore, refusalFrames: live.framesAfterRefusal, after: live.framesAfterPositive });
reporter.check('live:no-setup-failure', live.failure === undefined, live.failure);
reporter.check('live:transport-closure-observed-or-unknown',
  live.transportClosure?.recorded === true || live.transportClosure?.timedOutUnknown === true,
  live.transportClosure);
reporter.check('live:closure-not-claimed-when-unknown',
  live.transportClosure?.timedOutUnknown !== true || live.transportClosure?.failure === null,
  live.transportClosure);
reporter.note('live-path scope, stated exactly: the live inspector path exercises breakpoint refusal and admission on the production transport; it does not exercise pending evaluation or release, which are covered on the controlled path');
reporter.note('S4 remains open: this fixture only records whatever transport-closure observation occurs at cleanup, and claims no coverage of the state recorded after a deliberate close');
reporter.check('custody:owned-child-resolved', cleanupReport.unresolved.length === 0, cleanupReport);

reporter.note('the injected connect factory is trusted test infrastructure: the session performs no endpoint admission itself, so loopback enforcement is a property of the default factory, observed here rather than asserted as a session defect');
reporter.note(cleanupReport.semantics);
finish(environment, 'session-transport.result.json', reporter.finalize({
  controlled,
  loopback,
  live,
  rawStdout,
  rawStderr,
  custody: cleanupReport,
}));
