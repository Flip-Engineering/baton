// Fixture: outbound-frame behavior through the production session and the real
// inspector transport.
//
// A production `createAdapterSession` is launched against a real Node inspector
// child, so the claim "a refused request emits no outbound frame" is measured on
// the live path rather than inferred from an unconnected session. Positive
// control: the same request without a condition emits exactly one outbound
// frame. Pending evaluation: a control request with full grants refuses
// runtimeBusy and adds no outbound frame, while release stays admitted.
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
let banner = null;
let observation = {};
let bodyFailure = null;
let rawStdout = null;
let rawStderr = null;
let custodyReport = null;
const releaseCalls = [];

try {
  const sessionModule = await import(environment.runtimePath('cdp-session.mjs'));
  const found = await waitFor(() => parseBanner(stderr), 20000);
  banner = found.value;
  if (banner === null) throw new Error('no inspector banner');

  const session = sessionModule.createAdapterSession({
    runtime: 'rt:fixture',
    adapter: 'fixture-adapter',
    incarnation: '0',
    control: {
      release: async (args) => {
        releaseCalls.push(args);
        return { accepted: true, fixtureKeeper: 'stub', signal: args?.signal ?? null };
      },
    },
    emit: () => {},
  });

  const launch = await session.execute('launch', { query: 'q-launch', webSocketUrl: banner.url });
  const afterLaunch = outbound(session).length;

  // Refusal on the live path: no outbound frame.
  let refusal = null;
  try {
    await session.control({ query: 'q-refuse', method: 'Debugger.setBreakpointByUrl', params: conditionParams, effects: CONTROL });
    refusal = { ok: true };
  } catch (error) {
    refusal = { refused: error.condition ?? error.name ?? String(error) };
  }
  const afterRefusal = outbound(session).length;

  // Positive control: exactly one outbound frame.
  let positive = null;
  try {
    const result = await session.control({ query: 'q-positive', method: 'Debugger.setBreakpointByUrl', params: breakpointParams, effects: CONTROL });
    positive = { ok: true, category: result?.category ?? null };
  } catch (error) {
    positive = { refused: error.condition ?? error.name ?? String(error) };
  }
  const afterPositive = outbound(session).length;

  // Pending evaluation: refusal on the live path with no outbound frame, and
  // release admitted while it is pending.
  const pendingEvaluation = session.execute('evaluate', { query: 'q-eval', expression: BLOCKED });
  pendingEvaluation.catch(() => {}); // transport closes at cleanup; not a fixture failure
  await new Promise((resolve) => setTimeout(resolve, 300));
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
    release = { ok: true, result: await session.execute('release', { query: 'q-release', signal: 'SIGTERM' }) };
  } catch (error) {
    release = { refused: error.condition ?? error.name ?? String(error) };
  }

  observation = {
    launchState: launch?.state ?? null,
    framesAfterLaunch: afterLaunch,
    refusal,
    framesAfterRefusal: afterRefusal,
    positive,
    framesAfterPositive: afterPositive,
    pendingControl,
    framesBeforePendingControl: beforePendingControl,
    framesAfterPendingControl: afterPendingControl,
    release,
    releaseCalls,
  };
} catch (error) {
  bodyFailure = String(error?.stack ?? error);
} finally {
  custody.kill('SIGKILL');
  rawStdout = writeStream(environment, 'session-transport.subject.stdout.txt', stdout);
  rawStderr = writeStream(environment, 'session-transport.subject.stderr.txt', stderr);
  custodyReport = await cleanupOwned({ timeoutMs: 5000 });
}

reporter.check('fixture:no-uncaught-failure', bodyFailure === null, bodyFailure);
reporter.check('inspector:banner-present', banner !== null, stderr.split('\n').slice(-3).join(' | '));
reporter.check('launch:connected', observation.framesAfterLaunch > 0, observation.framesAfterLaunch);
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
reporter.check('live-pending:control-refused-runtimeBusy',
  observation.pendingControl?.refused === 'runtimeBusy', observation.pendingControl);
reporter.check('live-pending:no-outbound-frame',
  observation.framesAfterPendingControl === observation.framesBeforePendingControl,
  { before: observation.framesBeforePendingControl, after: observation.framesAfterPendingControl });
reporter.check('live-pending:release-admitted',
  observation.release?.ok === true, observation.release);
reporter.check('live-pending:keeper-control-invoked-once',
  Array.isArray(observation.releaseCalls) && observation.releaseCalls.length === 1, observation.releaseCalls);
reporter.check('custody:owned-child-resolved', custodyReport.unresolved.length === 0, custodyReport);

reporter.note('keeper custody is stubbed here; this fixture measures session admission and outbound frames only');
reporter.note(custodyReport.signalObservation);
finish(environment, 'session-transport.result.json', reporter.finalize({
  banner,
  observation,
  bodyFailure,
  rawStdout,
  rawStderr,
  custody: custodyReport,
}));
