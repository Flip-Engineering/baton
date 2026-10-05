// Fixture: outbound-frame behavior through the production session and the real
// inspector transport.
//
// Intents carry their actual grants: launch and release need `controlRuntime`,
// evaluate needs `controlRuntime` and `evaluateRuntime`. Startup state is read
// from the session snapshot rather than assumed, and the pending evaluation is
// established by adapter evidence (snapshot.pending plus an observed outbound
// Runtime.evaluate frame) before the busy probe, not by elapsed time. The
// evaluation's own settlement is retained as evidence so an expected unresolved
// evaluation is distinguishable from a setup failure.
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

const outbound = (session) => session.frames().filter((frame) => frame.direction === 'out');
const outboundMethods = (session) => outbound(session).map((frame) => frame.method);

let banner = null;
let session = null;
let observation = {};
let bodyFailure = null;
let cleanupReport = null;
let rawStdout = null;
let rawStderr = null;
let transportAfterCleanup = null;

try {
  const sessionModule = await import(environment.runtimePath('cdp-session.mjs'));
  const found = await waitFor(() => parseBanner(stderr), 20000);
  banner = found.value;
  if (banner === null) throw new Error('no inspector banner');

  session = sessionModule.createAdapterSession({
    runtime: 'rt:fixture',
    adapter: 'fixture-adapter',
    incarnation: '0',
    control: {
      release: async (args) => ({ accepted: true, fixtureKeeper: 'stub', signal: args?.signal ?? null }),
    },
    emit: () => {},
  });

  const launch = await session.execute('launch', { query: 'q-launch', webSocketUrl: banner.url, effects: CONTROL });
  const launchSnapshot = session.snapshot();
  const afterLaunch = outbound(session).length;

  let refusal = null;
  try {
    await session.control({ query: 'q-refuse', method: 'Debugger.setBreakpointByUrl', params: conditionParams, effects: CONTROL });
    refusal = { ok: true };
  } catch (error) {
    refusal = { refused: error.condition ?? error.name ?? String(error) };
  }
  const afterRefusal = outbound(session).length;

  let positive = null;
  try {
    const result = await session.control({ query: 'q-positive', method: 'Debugger.setBreakpointByUrl', params: breakpointParams, effects: CONTROL });
    positive = { ok: true, category: result?.category ?? null };
  } catch (error) {
    positive = { refused: error.condition ?? error.name ?? String(error) };
  }
  const afterPositive = outbound(session).length;

  // Pending evaluation, established by evidence rather than elapsed time.
  const evaluationSettlement = { status: 'unresolved' };
  const evaluation = session.execute('evaluate', { query: 'q-eval', expression: BLOCKED, effects: EVALUATE });
  evaluation.then(
    (value) => {
      evaluationSettlement.status = 'settled';
      evaluationSettlement.value = value?.state ?? null;
    },
    (error) => {
      evaluationSettlement.status = 'rejected';
      evaluationSettlement.condition = error?.condition ?? error?.name ?? String(error);
      evaluationSettlement.detail = error?.detail ?? error?.message ?? null;
    },
  );

  const pendingObserved = await waitFor(
    () => session.snapshot().pending !== null && outboundMethods(session).includes('Runtime.evaluate'),
    10000,
  );
  const pendingSnapshot = session.snapshot();
  const beforePendingControl = outbound(session).length;

  let pendingControl = null;
  try {
    await session.control({ query: 'q-busy', method: 'Runtime.runIfWaitingForDebugger', params: {}, effects: CONTROL });
    pendingControl = { ok: true };
  } catch (error) {
    pendingControl = { refused: error.condition ?? error.name ?? String(error) };
  }
  const afterPendingControl = outbound(session).length;

  let release = null;
  try {
    release = { ok: true, result: await session.execute('release', { query: 'q-release', signal: 'SIGTERM', effects: CONTROL }) };
  } catch (error) {
    release = { refused: error.condition ?? error.name ?? String(error) };
  }

  observation = {
    launchState: launch?.state ?? null,
    launchSnapshotPending: launchSnapshot.pending,
    launchSnapshotState: launchSnapshot.state,
    framesAfterLaunch: afterLaunch,
    outboundAfterLaunch: outboundMethods(session),
    refusal,
    framesAfterRefusal: afterRefusal,
    positive,
    framesAfterPositive: afterPositive,
    pendingObserved: pendingObserved.value === true,
    pendingObservedElapsedMs: pendingObserved.elapsedMs,
    pendingSnapshotPending: pendingSnapshot.pending,
    outboundDuringPending: outboundMethods(session),
    pendingControl,
    framesBeforePendingControl: beforePendingControl,
    framesAfterPendingControl: afterPendingControl,
    release,
  };
} catch (error) {
  bodyFailure = String(error?.stack ?? error);
} finally {
  // Awaited custody first: a kill request is asynchronous, so trailing pipe
  // data may still arrive. Streams are persisted after closure and labelled
  // partial when closure was not observed.
  custody.kill('SIGKILL');
  cleanupReport = await cleanupOwned({ timeoutMs: 5000 });
  const partial = child.pid !== undefined && cleanupReport.unresolved.includes(child.pid);
  rawStdout = { ...writeStream(environment, 'session-transport.subject.stdout.txt', stdout), partial };
  rawStderr = { ...writeStream(environment, 'session-transport.subject.stderr.txt', stderr), partial };
  try {
    transportAfterCleanup = session === null ? null : {
      state: session.snapshot().state,
      failure: session.snapshot().failure,
      frames: session.frames().length,
    };
  } catch (error) {
    transportAfterCleanup = { snapshotRefused: String(error?.message ?? error) };
  }
}

reporter.check('fixture:no-uncaught-failure', bodyFailure === null, bodyFailure);
reporter.check('inspector:banner-present', banner !== null, stderr.split('\n').slice(-3).join(' | '));
reporter.check('launch:connected', (observation.framesAfterLaunch ?? 0) > 0, observation.framesAfterLaunch);
reporter.check('launch:startup-state-observed',
  observation.launchSnapshotState !== undefined
  && ['waitingForStart', 'running', 'pausePending', 'paused'].includes(observation.launchSnapshotState),
  { state: observation.launchSnapshotState, pending: observation.launchSnapshotPending });
reporter.check('launch:no-grant-refusal',
  observation.launchState !== undefined && observation.launchState !== null, observation.launchState);
reporter.check('live-refusal:condition-refused',
  observation.refusal?.refused === 'breakpointConditionUnsupported', observation.refusal);
reporter.check('live-refusal:no-outbound-frame',
  observation.refusal?.refused !== undefined
  && observation.framesAfterRefusal === observation.framesAfterLaunch,
  { before: observation.framesAfterLaunch, after: observation.framesAfterRefusal });
reporter.check('live-positive:valid-control-admitted', observation.positive?.ok === true, observation.positive);
reporter.check('live-positive:exactly-one-outbound-frame',
  observation.framesAfterPositive === observation.framesAfterLaunch + 1,
  { before: observation.framesAfterLaunch, after: observation.framesAfterPositive });
reporter.check('pending:adapter-record-and-frame-evidence',
  observation.pendingObserved === true && observation.pendingSnapshotPending !== null,
  { pendingObserved: observation.pendingObserved, pending: observation.pendingSnapshotPending, outbound: observation.outboundDuringPending });
reporter.check('live-pending:control-refused-runtimeBusy',
  observation.pendingControl?.refused === 'runtimeBusy', observation.pendingControl);
reporter.check('live-pending:no-outbound-frame',
  observation.framesAfterPendingControl === observation.framesBeforePendingControl,
  { before: observation.framesBeforePendingControl, after: observation.framesAfterPendingControl });
reporter.check('live-pending:release-admitted', observation.release?.ok === true, observation.release);
reporter.check('pending:settlement-is-expected-unresolved',
  evaluationSettlement.status === 'unresolved'
  || ['transportClosed', 'transportError', 'transportAborted'].includes(evaluationSettlement.condition),
  evaluationSettlement);
reporter.check('pending:no-setup-failure-hid',
  evaluationSettlement.condition !== 'missingEffect'
  && evaluationSettlement.condition !== 'intentNotAdmitted'
  && evaluationSettlement.condition !== 'runtimeBusy', evaluationSettlement);
reporter.check('custody:owned-child-resolved', cleanupReport.unresolved.length === 0, cleanupReport);
reporter.check('transport:closure-observed-after-cleanup',
  transportAfterCleanup !== null && transportAfterCleanup !== undefined, transportAfterCleanup);

reporter.note('keeper custody is stubbed here; this fixture measures session admission and outbound frames only');
reporter.note(cleanupReport.semantics);
finish(environment, 'session-transport.result.json', reporter.finalize({
  banner,
  observation,
  evaluationSettlement,
  bodyFailure,
  rawStdout,
  rawStderr,
  custody: cleanupReport,
  transportAfterCleanup,
}));
