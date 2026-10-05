// Fixture: grants before send on the read path, the control path and the intents.
//
// Mode is selected before any producer import or probe. Candidate mode imports
// the current modules and exercises the current API. Historical mode imports
// only the historical module, requires the pinned adapter surface, and never
// executes a current-API probe, so the two eras are not mixed.
import { EnvironmentRefusal, FIXTURE_ENTRIES, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment } from '../lib/assert.mjs';
import { requirePin } from '../lib/pins.mjs';
import { historicalSendObservations, requireHistoricalApi } from '../lib/historical-adapter.mjs';

let environment;
let historical = false;
try {
  environment = openEnvironmentOrExit(FIXTURE_ENTRIES['grants-admission']);
  if (environment.pin !== null) {
    requirePin(environment, 'grants-admission');
    historical = true;
  }
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('grants-admission', environment);
const safe = (fn) => {
  try {
    return fn();
  } catch (error) {
    return { threw: error.condition ?? String(error) };
  }
};
const CONTROL = ['controlRuntime'];
const breakpointParams = { url: 'file:///tmp/fixture.js', lineNumber: 3 };
const conditionParams = { ...breakpointParams, condition: '(globalThis.__baton_condition_ran = true, false)' };
const regexParams = { ...breakpointParams, urlRegex: '.*fixture.*' };
const workerInner = (method) => ({ message: JSON.stringify({ id: 1, method, params: {} }) });

let state;
let observations = {};
try {
  state = await import(environment.runtimePath('cdp-state.mjs'));
} catch (error) {
  reporter.check('producer:state-loadable', false, String(error?.message ?? error));
  finish(environment, 'grants-admission.result.json', reporter.finalize({ historical }));
}
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
const pending = apply(running, { type: 'evaluationSent', query: 'q1' });

if (historical) {
  // Historical era only: the pinned adapter surface, no current-API probe.
  const intents = await import(environment.runtimePath('cdp-intents.mjs'));
  const historicalModule = requireHistoricalApi(intents, environment.pinName);
  const send = historicalSendObservations(historicalModule, { running, waiting, pending });
  observations = { historicalSend: send };
  reporter.check('historical:wait-state-admitted-without-grant', send.waitState.ok === true, send.waitState);
  reporter.check('historical:worker-detach-admitted-without-grant', send.workerDetach.ok === true, send.workerDetach);
  reporter.check('historical:mutate-admitted-while-pending', send.waitStateWhilePending.ok === true, send.waitStateWhilePending);
  reporter.check('historical:breakpoint-condition-forwarded-without-grant',
    send.breakpointRequest?.params?.condition === conditionParams.condition, send.breakpointRequest);
  reporter.check('historical:no-current-api-probe', true, 'current probes were not executed in this mode');
  reporter.note(`historical provenance: retained history covers ${JSON.stringify(environment.historicalScope?.retainedHistoryFiles ?? [])}; unverified for era ${JSON.stringify(environment.historicalScope?.unverifiedForEra ?? [])}; exact historical qualification ${environment.historicalScope?.exactHistoricalQualification}`);
  finish(environment, 'grants-admission.result.json', reporter.finalize({ historical, observations }));
}

const intents = await import(environment.runtimePath('cdp-intents.mjs'));
const session = await import(environment.runtimePath('cdp-session.mjs'));

observations = {
  sessionShape: { createAdapterSession: typeof session.createAdapterSession },
  launchWithoutGrants: safe(() => intents.admitIntent(waiting, 'launch', { effects: [] })),
  launchWithControl: safe(() => intents.admitIntent(waiting, 'launch', { effects: CONTROL })),
  pauseGrantedFromRunning: safe(() => intents.admitIntent(running, 'pause', { effects: CONTROL })),
  observeNoGrants: safe(() => intents.admitIntent(running, 'observe', { effects: [] })),
  readPathEvaluate: safe(() => intents.admitReadRequest(running, 'Runtime.evaluate')),
  readPathPause: safe(() => intents.admitReadRequest(running, 'Debugger.resume')),
  readPathControl: safe(() => intents.admitReadRequest(running, 'Runtime.runIfWaitingForDebugger')),
  controlUngranted: safe(() => intents.admitControlRequest(running, 'Runtime.runIfWaitingForDebugger', {}, [])),
  controlGranted: safe(() => intents.admitControlRequest(running, 'Runtime.runIfWaitingForDebugger', {}, CONTROL)),
  controlWhilePending: safe(() => intents.admitControlRequest(pending, 'Runtime.runIfWaitingForDebugger', {}, CONTROL)),
  pauseWhilePendingGranted: safe(() => intents.admitIntent(pending, 'pause', { effects: CONTROL })),
  evaluateWhilePendingGranted: safe(() => intents.admitIntent(pending, 'evaluate', {
    effects: ['controlRuntime', 'evaluateRuntime'],
  })),
  releaseWhilePendingGranted: safe(() => intents.admitIntent(pending, 'release', { effects: CONTROL, signal: 'SIGTERM' })),
  breakpointConditionFree: safe(() => intents.admitControlRequest(running, 'Debugger.setBreakpointByUrl', breakpointParams, CONTROL)),
  breakpointWithCondition: safe(() => intents.admitControlRequest(running, 'Debugger.setBreakpointByUrl', conditionParams, CONTROL)),
  breakpointWithExtraParam: safe(() => intents.admitControlRequest(running, 'Debugger.setBreakpointByUrl', regexParams, CONTROL)),
  breakpointAbsentLocation: safe(() => intents.admitControlRequest(running, 'Debugger.setBreakpoint', {}, CONTROL)),
  startupStopConditionFree: safe(() => intents.startupStopRequests([breakpointParams])),
  startupStopWithCondition: safe(() => intents.startupStopRequests([conditionParams])),
  workerInnerControl: safe(() => intents.admitControlRequest(running, 'NodeWorker.sendMessageToWorker',
    workerInner('Runtime.runIfWaitingForDebugger'), CONTROL)),
  workerInnerEvaluate: safe(() => intents.admitControlRequest(running, 'NodeWorker.sendMessageToWorker',
    workerInner('Runtime.evaluate'), CONTROL)),
};

// Admission-order probes on a session with no connection: these show the named
// refusal precedes the transport. They are admission-order evidence only; the
// outbound-frame claim is made by the session-transport fixture against a real
// inspector process.
const unconnected = session.createAdapterSession({ runtime: 'rt:fixture', adapter: 'fixture-adapter', incarnation: '0' });
const unconnectedProbe = async (method, params) => {
  try {
    await unconnected.control({ method, params, effects: CONTROL });
    return { ok: true, frames: unconnected.frames().length };
  } catch (error) {
    return { refused: error.condition ?? error.name ?? String(error), frames: unconnected.frames().length };
  }
};
observations.unconnectedControlCondition = await unconnectedProbe('Debugger.setBreakpointByUrl', conditionParams);
observations.unconnectedControlLocationMissing = await unconnectedProbe('Debugger.setBreakpoint', {});
observations.unconnectedControlValid = await unconnectedProbe('Debugger.setBreakpointByUrl', breakpointParams);

reporter.check('control:launch-requires-grant', observations.launchWithoutGrants.ok === false
  && /controlRuntime/.test(observations.launchWithoutGrants.detail ?? ''), observations.launchWithoutGrants);
reporter.check('control:launch-admitted-with-grant', observations.launchWithControl.ok === true, observations.launchWithControl);
reporter.check('control:pause-admitted-with-grant-from-running',
  observations.pauseGrantedFromRunning.ok === true, observations.pauseGrantedFromRunning);
reporter.check('control:observe-requires-no-grant', observations.observeNoGrants.ok === true, observations.observeNoGrants);
reporter.check('read-path:evaluate-refused', observations.readPathEvaluate.ok === false, observations.readPathEvaluate);
reporter.check('read-path:pause-refused', observations.readPathPause.ok === false, observations.readPathPause);
reporter.check('read-path:control-refused-without-grant', observations.readPathControl.ok === false, observations.readPathControl);
reporter.check('control-path:ungranted-refused', observations.controlUngranted.ok === false, observations.controlUngranted);
reporter.check('control-path:granted-admitted', observations.controlGranted.ok === true, observations.controlGranted);
reporter.check('serialization:control-refused-while-pending-with-grants',
  observations.controlWhilePending.ok === false && observations.controlWhilePending.condition === 'runtimeBusy',
  observations.controlWhilePending);
reporter.check('serialization:pause-refused-while-pending-with-grants',
  observations.pauseWhilePendingGranted.ok === false && observations.pauseWhilePendingGranted.condition === 'runtimeBusy',
  observations.pauseWhilePendingGranted);
reporter.check('serialization:evaluate-refused-while-pending-with-grants',
  observations.evaluateWhilePendingGranted.ok === false && observations.evaluateWhilePendingGranted.condition === 'runtimeBusy',
  observations.evaluateWhilePendingGranted);
reporter.check('release:admitted-while-pending-with-grants',
  observations.releaseWhilePendingGranted.ok === true, observations.releaseWhilePendingGranted);
reporter.check('breakpoint:condition-free-admitted-with-grants',
  observations.breakpointConditionFree.ok === true, observations.breakpointConditionFree);
reporter.check('breakpoint:condition-refused-with-grants',
  observations.breakpointWithCondition.ok === false
  && observations.breakpointWithCondition.condition === 'breakpointConditionUnsupported', observations.breakpointWithCondition);
reporter.check('breakpoint:extra-param-refused-with-grants',
  observations.breakpointWithExtraParam.ok === false
  && observations.breakpointWithExtraParam.condition === 'breakpointParamsUnsupported', observations.breakpointWithExtraParam);
reporter.check('breakpoint:absent-location-refused-with-grants',
  observations.breakpointAbsentLocation.ok === false
  && observations.breakpointAbsentLocation.condition === 'breakpointLocationMissing', observations.breakpointAbsentLocation);
reporter.check('startup-stop:condition-free-returns-requests',
  Array.isArray(observations.startupStopConditionFree)
  && observations.startupStopConditionFree.length === 1
  && observations.startupStopConditionFree[0].method === 'Debugger.setBreakpointByUrl',
  observations.startupStopConditionFree);
reporter.check('startup-stop:condition-throws',
  typeof observations.startupStopWithCondition?.threw === 'string', observations.startupStopWithCondition);
reporter.check('worker:inner-control-refused', observations.workerInnerControl.ok === false, observations.workerInnerControl);
reporter.check('worker:inner-evaluate-refused', observations.workerInnerEvaluate.ok === false, observations.workerInnerEvaluate);
reporter.check('unconnected:condition-refused-before-transport',
  observations.unconnectedControlCondition.refused === 'breakpointConditionUnsupported'
  && observations.unconnectedControlCondition.frames === 0, observations.unconnectedControlCondition);
reporter.check('unconnected:absent-location-refused-before-transport',
  observations.unconnectedControlLocationMissing.refused === 'breakpointLocationMissing'
  && observations.unconnectedControlLocationMissing.frames === 0, observations.unconnectedControlLocationMissing);
reporter.check('unconnected:valid-control-reaches-transport',
  observations.unconnectedControlValid.refused === 'transportMissing'
  && observations.unconnectedControlValid.frames === 0, observations.unconnectedControlValid);
reporter.note('admission-order probes on an unconnected session are admission-order evidence only; outbound-frame claims belong to the session-transport fixture');

finish(environment, 'grants-admission.result.json', reporter.finalize({ historical, observations }));
