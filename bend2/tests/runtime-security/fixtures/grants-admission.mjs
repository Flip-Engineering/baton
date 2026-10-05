// Fixture: grants before send on the intent and observation paths.
//
// BATON_EXPECT=historical reproduces the current behavior: effectful methods
// reachable through the observation send path with no grants and outside the
// pending-intent serialization, and a breakpoint condition forwarded with an
// empty effect set.
//
// BATON_EXPECT=corrected accepts the fixed candidate: the same methods refuse
// without their grant, mutate requests respect the pending-intent
// serialization, and a breakpoint condition requires the evaluate grant. The
// corrected run must not fail because the historical notes expect admission.
//
// Positive controls are asserted in both modes: the launch intent requires
// controlRuntime, evaluate and pause-family requests refuse on the send path,
// the observe intent requires no grants, and worker inner evaluate and resume
// refuse.
import { EnvironmentRefusal, loadEnvironment } from '../lib/env.mjs';
import { createReport, finish, failEnvironment } from '../lib/assert.mjs';

let environment;
try {
  environment = loadEnvironment();
} catch (error) {
  if (error instanceof EnvironmentRefusal) failEnvironment(error.condition, error.detail);
  throw error;
}

const reporter = createReport('grants-admission', environment, environment.expect);

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
let paused = apply(running, { type: 'paused' });
const pending = apply(running, { type: 'evaluationSent', query: 'q1' });

const observations = {
  launchWithoutGrants: admitIntent(waiting, 'launch', { effects: [] }),
  launchWithControl: admitIntent(waiting, 'launch', { effects: ['controlRuntime'] }),
  sendWaitState: admitRequest(waiting, 'Runtime.runIfWaitingForDebugger'),
  sendWorkerDetach: admitRequest(running, 'NodeWorker.detach'),
  sendWorkerEnable: admitRequest(running, 'NodeWorker.enable'),
  intentPauseWhilePending: admitIntent(pending, 'pause', { effects: ['controlRuntime'] }),
  sendWaitStateWhilePending: admitRequest(pending, 'Runtime.runIfWaitingForDebugger'),
  sendBreakpointWhilePending: admitRequest(pending, 'Debugger.setBreakpointByUrl'),
  sendSetPauseOnExceptionsWhilePending: admitRequest(pending, 'Debugger.setPauseOnExceptions'),
  sendEvaluate: admitRequest(running, 'Runtime.evaluate'),
  sendEvaluateOnCallFrame: admitRequest(paused, 'Debugger.evaluateOnCallFrame'),
  observeIntent: admitIntent(running, 'observe', { effects: [] }),
  breakpointTableEffects: INTENT_TABLE.breakpoint.effects,
  breakpointIntentWithoutGrants: admitIntent(running, 'breakpoint', { effects: [] }),
};

const conditionParams = {
  action: 'setByUrl',
  url: 'file:///tmp/fixture.js',
  lineNumber: 3,
  condition: '(globalThis.__baton_condition_ran = true, false)',
};
try {
  observations.breakpointRequestWithCondition = requestForIntent('breakpoint', conditionParams);
} catch (error) {
  observations.breakpointRequestWithCondition = { threw: error.condition ?? String(error) };
}

const inner = (method, params = {}) => admitRequest(running, 'NodeWorker.sendMessageToWorker',
  { message: JSON.stringify({ id: 1, method, params }) });
observations.workerInnerRunIfWaiting = inner('Runtime.runIfWaitingForDebugger');
observations.workerInnerSetBreakpoint = inner('Debugger.setBreakpointByUrl');
observations.workerInnerEvaluate = inner('Runtime.evaluate');
observations.workerInnerResume = inner('Debugger.resume');

// Positive controls, required in both modes.
reporter.check('control:launch-requires-grant',
  observations.launchWithoutGrants.ok === false && /controlRuntime/.test(observations.launchWithoutGrants.detail ?? ''),
  observations.launchWithoutGrants);
reporter.check('control:launch-admitted-with-grant',
  observations.launchWithControl.ok === true, observations.launchWithControl);
reporter.check('control:evaluate-requires-intent',
  observations.sendEvaluate.ok === false, observations.sendEvaluate);
reporter.check('control:evaluate-on-call-frame-requires-intent',
  observations.sendEvaluateOnCallFrame.ok === false, observations.sendEvaluateOnCallFrame);
reporter.check('control:observe-requires-no-grant',
  observations.observeIntent.ok === true, observations.observeIntent);
reporter.check('control:worker-inner-evaluate-refused',
  observations.workerInnerEvaluate.ok === false, observations.workerInnerEvaluate);
reporter.check('control:worker-inner-resume-refused',
  observations.workerInnerResume.ok === false, observations.workerInnerResume);
reporter.check('control:pause-intent-serialized-while-pending',
  observations.intentPauseWhilePending.ok === false
  && observations.intentPauseWhilePending.condition === 'runtimeBusy', observations.intentPauseWhilePending);

// The condition-carrying breakpoint either requires the evaluate grant at the
// table, or the request construction refuses.
const conditionRequiresGrant = (Array.isArray(observations.breakpointTableEffects)
  && observations.breakpointTableEffects.includes('evaluateRuntime'))
  || observations.breakpointRequestWithCondition?.threw !== undefined;

if (environment.expect === 'historical') {
  reporter.check('historical:wait-state-admitted-without-grant', observations.sendWaitState.ok === true, observations.sendWaitState);
  reporter.check('historical:worker-detach-admitted-without-grant', observations.sendWorkerDetach.ok === true, observations.sendWorkerDetach);
  reporter.check('historical:mutate-admitted-while-pending', observations.sendWaitStateWhilePending.ok === true, observations.sendWaitStateWhilePending);
  reporter.check('historical:breakpoint-condition-forwarded-without-grant',
    observations.breakpointRequestWithCondition?.params?.condition === conditionParams.condition, observations.breakpointRequestWithCondition);
} else {
  reporter.check('corrected:wait-state-refused-without-grant', observations.sendWaitState.ok === false, observations.sendWaitState);
  reporter.check('corrected:worker-detach-refused-without-grant', observations.sendWorkerDetach.ok === false, observations.sendWorkerDetach);
  reporter.check('corrected:worker-enable-refused-without-grant', observations.sendWorkerEnable.ok === false, observations.sendWorkerEnable);
  reporter.check('corrected:mutate-serialized-while-pending',
    observations.sendWaitStateWhilePending.ok === false, observations.sendWaitStateWhilePending);
  reporter.check('corrected:set-pause-on-exceptions-serialized-while-pending',
    observations.sendSetPauseOnExceptionsWhilePending.ok === false, observations.sendSetPauseOnExceptionsWhilePending);
  reporter.check('corrected:worker-inner-mutate-refused',
    observations.workerInnerRunIfWaiting.ok === false, observations.workerInnerRunIfWaiting);
  reporter.check('corrected:worker-inner-breakpoint-refused',
    observations.workerInnerSetBreakpoint.ok === false, observations.workerInnerSetBreakpoint);
  reporter.check('corrected:breakpoint-condition-requires-evaluate-grant', conditionRequiresGrant,
    { tableEffects: observations.breakpointTableEffects, request: observations.breakpointRequestWithCondition });
}

finish(environment, 'grants-admission.result.json', reporter.finalize({ observations }));
