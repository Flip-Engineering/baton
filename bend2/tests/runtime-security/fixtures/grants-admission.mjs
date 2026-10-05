// Fixture: grants before send on the intent and observation paths.
//
// Candidate mode: the effectful methods reachable through the observation send
// path refuse without their grant, mutate requests respect the pending-intent
// serialization, and a condition-carrying breakpoint requires the evaluate
// grant. The public intent table is read optionally: the approved public shape
// may not expose a breakpoint entry at all, so nothing is dereferenced
// unconditionally and table metadata alone is never accepted as proof. The
// conditional-breakpoint requirement is established behaviorally.
//
// Historical mode runs only under a registered closure pin and asserts that the
// bypass was present in that exact closure.
import { EnvironmentRefusal, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment } from '../lib/assert.mjs';
import { historicalExpectation } from '../lib/pins.mjs';

let environment;
let historical = false;
try {
  environment = openEnvironmentOrExit();
  if (environment.historicalPin !== null) {
    historicalExpectation(environment, 'grants-admission');
    historical = true;
  }
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('grants-admission', environment);

let intents;
let state;
try {
  intents = await import(environment.runtimePath('cdp-intents.mjs'));
  state = await import(environment.runtimePath('cdp-state.mjs'));
} catch (error) {
  reporter.check('producer:modules-loadable', false, String(error?.message ?? error));
  finish(environment, 'grants-admission.result.json', reporter.finalize());
}

const { admitIntent, admitRequest, requestForIntent, INTENT_TABLE } = intents;
const table = INTENT_TABLE ?? {};
const breakpointEntry = table.breakpoint ?? null;
const apply = (record, event) => {
  const next = state.nextState(record, event);
  if (!next.ok) throw new Error(`${event.type}: ${next.condition} ${next.detail}`);
  return next.record;
};

let running = state.initialRecord();
running = apply(running, { type: 'launchStarted' });
running = apply(running, { type: 'endpointDiscovered' });
running = apply(running, { type: 'startReleaseSent' });
let waiting = state.initialRecord();
waiting = apply(waiting, { type: 'launchStarted' });
waiting = apply(waiting, { type: 'endpointDiscovered' });
const paused = apply(running, { type: 'paused' });
const pending = apply(running, { type: 'evaluationSent', query: 'q1' });

const safe = (fn) => {
  try {
    return fn();
  } catch (error) {
    return { threw: error.condition ?? String(error) };
  }
};

const observations = {
  launchWithoutGrants: admitIntent(waiting, 'launch', { effects: [] }),
  launchWithControl: admitIntent(waiting, 'launch', { effects: ['controlRuntime'] }),
  pauseGrantedFromRunning: admitIntent(running, 'pause', { effects: ['controlRuntime'] }),
  sendWaitState: admitRequest(waiting, 'Runtime.runIfWaitingForDebugger'),
  sendWorkerDetach: admitRequest(running, 'NodeWorker.detach'),
  sendWorkerEnable: admitRequest(running, 'NodeWorker.enable'),
  intentPauseWhilePendingGranted: admitIntent(pending, 'pause', { effects: ['controlRuntime'] }),
  intentEvaluateWhilePendingGranted: admitIntent(pending, 'evaluate', { effects: ['controlRuntime', 'evaluateRuntime'] }),
  sendWaitStateWhilePending: admitRequest(pending, 'Runtime.runIfWaitingForDebugger'),
  sendBreakpointWhilePending: admitRequest(pending, 'Debugger.setBreakpointByUrl'),
  sendSetPauseOnExceptionsWhilePending: admitRequest(pending, 'Debugger.setPauseOnExceptions'),
  sendEvaluate: admitRequest(running, 'Runtime.evaluate'),
  sendEvaluateOnCallFrame: admitRequest(paused, 'Debugger.evaluateOnCallFrame'),
  observeIntent: admitIntent(running, 'observe', { effects: [] }),
  breakpointTableEffects: breakpointEntry === null ? null : breakpointEntry.effects,
  breakpointIntentNoGrants: breakpointEntry === null ? null : safe(() => admitIntent(running, 'breakpoint', { effects: [] })),
  breakpointIntentEvaluateGranted: breakpointEntry === null
    ? null
    : safe(() => admitIntent(running, 'breakpoint', { effects: ['evaluateRuntime'] })),
};

const conditionParams = {
  action: 'setByUrl',
  url: 'file:///tmp/fixture.js',
  lineNumber: 3,
  condition: '(globalThis.__baton_condition_ran = true, false)',
};
observations.breakpointRequestWithCondition = typeof requestForIntent === 'function'
  ? safe(() => requestForIntent('breakpoint', conditionParams))
  : { threw: 'requestForIntentAbsent' };
observations.breakpointRequestWithoutCondition = typeof requestForIntent === 'function'
  ? safe(() => requestForIntent('breakpoint', { ...conditionParams, condition: undefined }))
  : { threw: 'requestForIntentAbsent' };

const inner = (method) => admitRequest(running, 'NodeWorker.sendMessageToWorker',
  { message: JSON.stringify({ id: 1, method, params: {} }) });
observations.workerInnerRunIfWaiting = inner('Runtime.runIfWaitingForDebugger');
observations.workerInnerSetBreakpoint = inner('Debugger.setBreakpointByUrl');
observations.workerInnerEvaluate = inner('Runtime.evaluate');
observations.workerInnerResume = inner('Debugger.resume');

// Positive controls, required in both modes.
reporter.check('control:launch-requires-grant',
  observations.launchWithoutGrants.ok === false
  && /controlRuntime/.test(observations.launchWithoutGrants.detail ?? ''), observations.launchWithoutGrants);
reporter.check('control:launch-admitted-with-grant',
  observations.launchWithControl.ok === true, observations.launchWithControl);
reporter.check('control:pause-admitted-with-grant-from-running',
  observations.pauseGrantedFromRunning.ok === true, observations.pauseGrantedFromRunning);
reporter.check('control:evaluate-requires-intent', observations.sendEvaluate.ok === false, observations.sendEvaluate);
reporter.check('control:evaluate-on-call-frame-requires-intent',
  observations.sendEvaluateOnCallFrame.ok === false, observations.sendEvaluateOnCallFrame);
reporter.check('control:observe-requires-no-grant', observations.observeIntent.ok === true, observations.observeIntent);
reporter.check('control:worker-inner-evaluate-refused', observations.workerInnerEvaluate.ok === false, observations.workerInnerEvaluate);
reporter.check('control:worker-inner-resume-refused', observations.workerInnerResume.ok === false, observations.workerInnerResume);
reporter.check('control:pause-serialized-while-pending-with-grants',
  observations.intentPauseWhilePendingGranted.ok === false
  && observations.intentPauseWhilePendingGranted.condition === 'runtimeBusy', observations.intentPauseWhilePendingGranted);
reporter.check('control:evaluate-serialized-while-pending-with-grants',
  observations.intentEvaluateWhilePendingGranted.ok === false
  && observations.intentEvaluateWhilePendingGranted.condition === 'runtimeBusy', observations.intentEvaluateWhilePendingGranted);

// Behavioral conditional-breakpoint requirement, tolerant of the public shape.
const requestRefused = observations.breakpointRequestWithCondition?.threw !== undefined
  && observations.breakpointRequestWithoutCondition?.threw === undefined;
const intentRefusesWithoutGrant = breakpointEntry !== null
  && observations.breakpointIntentNoGrants?.ok === false;
const intentAdmitsWithEvaluate = breakpointEntry !== null
  && observations.breakpointIntentEvaluateGranted?.ok === true;
const breakpointAbsentFromPublicTable = breakpointEntry === null;
const conditionRequiresGrant = requestRefused
  || (intentRefusesWithoutGrant && intentAdmitsWithEvaluate)
  || breakpointAbsentFromPublicTable;

if (historical) {
  reporter.check('historical:wait-state-admitted-without-grant', observations.sendWaitState.ok === true, observations.sendWaitState);
  reporter.check('historical:worker-detach-admitted-without-grant', observations.sendWorkerDetach.ok === true, observations.sendWorkerDetach);
  reporter.check('historical:mutate-admitted-while-pending', observations.sendWaitStateWhilePending.ok === true, observations.sendWaitStateWhilePending);
  reporter.check('historical:breakpoint-condition-forwarded-without-grant',
    observations.breakpointRequestWithCondition?.params?.condition === conditionParams.condition,
    observations.breakpointRequestWithCondition);
} else {
  reporter.check('candidate:wait-state-refused-without-grant', observations.sendWaitState.ok === false, observations.sendWaitState);
  reporter.check('candidate:worker-detach-refused-without-grant', observations.sendWorkerDetach.ok === false, observations.sendWorkerDetach);
  reporter.check('candidate:worker-enable-refused-without-grant', observations.sendWorkerEnable.ok === false, observations.sendWorkerEnable);
  reporter.check('candidate:mutate-serialized-while-pending', observations.sendWaitStateWhilePending.ok === false, observations.sendWaitStateWhilePending);
  reporter.check('candidate:set-pause-on-exceptions-serialized-while-pending',
    observations.sendSetPauseOnExceptionsWhilePending.ok === false, observations.sendSetPauseOnExceptionsWhilePending);
  reporter.check('candidate:worker-inner-mutate-refused', observations.workerInnerRunIfWaiting.ok === false, observations.workerInnerRunIfWaiting);
  reporter.check('candidate:worker-inner-breakpoint-refused', observations.workerInnerSetBreakpoint.ok === false, observations.workerInnerSetBreakpoint);
  reporter.check('candidate:conditional-breakpoint-requires-evaluate-grant', conditionRequiresGrant, {
    requestRefused,
    intentRefusesWithoutGrant,
    intentAdmitsWithEvaluate,
    breakpointAbsentFromPublicTable,
    requestWithCondition: observations.breakpointRequestWithCondition,
    requestWithoutCondition: observations.breakpointRequestWithoutCondition,
  });
  reporter.note('open question for the CDP owner: the approved public breakpoint shape (intent vs request construction) is not asserted here, only its grant behavior');
}

finish(environment, 'grants-admission.result.json', reporter.finalize({ historical, observations }));
