// CDP runtime lane: intent operations, the zero-grant read path and the grant-gated
// control path.
//
// Contract: docs/bend2/semantic-context-spec.md, "Request contract" (effects and
// grants) and "Runtime contract" (intents, serialization, runtime states).
//
// The public runtime intent union is exactly launch, observe, pause, resume-step,
// evaluate and release; there is no separate breakpoint intent. Every operation has a
// fixed required effect subset, and a missing grant refuses before the send.
//
// Two request paths exist:
//   - the read path (`admitReadRequest`) carries only genuinely non-effectful requests
//     (property descriptors, script text, heap and debugger facts). It needs no grant
//     and it never enables a debugger domain, releases a startup wait, detaches a worker
//     session or forwards a nested worker message.
//   - the control path (`admitControlRequest`) carries configuration and session
//     plumbing (domain enablement, the startup release, generated-location breakpoints,
//     async-call-stack depth and worker session plumbing). It requires the
//     controlRuntime grant, and a nested worker message is admitted only when its inner
//     method is itself a read. A breakpoint condition is target JavaScript, so this
//     profile refuses it rather than labelling it non-evaluating.
//
// Evaluation and pause-state requests are admitted only through their intents.

export const EFFECTS = Object.freeze([
  'executeTarget',
  'planTargetSql',
  'replayMigrations',
  'evaluateRuntime',
  'controlRuntime',
]);

// Intent -> required effects, the states it is admitted from, and whether it serializes
// against other state-changing intents. `launch` also carries the optional startup stop
// position, which is the approved place where generated-location breakpoints are set.
export const INTENT_TABLE = Object.freeze({
  launch: Object.freeze({
    effects: Object.freeze(['controlRuntime']),
    states: Object.freeze(['starting', 'waitingForStart']),
    serialized: true,
    owner: 'target-keeper',
  }),
  observe: Object.freeze({
    effects: Object.freeze([]),
    states: Object.freeze(['waitingForStart', 'running', 'pausePending', 'paused', 'releasing', 'failed']),
    serialized: false,
    owner: 'adapter',
  }),
  pause: Object.freeze({
    effects: Object.freeze(['controlRuntime']),
    states: Object.freeze(['running']),
    serialized: true,
    owner: 'adapter',
  }),
  'resume-step': Object.freeze({
    effects: Object.freeze(['controlRuntime']),
    states: Object.freeze(['paused']),
    serialized: true,
    owner: 'adapter',
  }),
  evaluate: Object.freeze({
    effects: Object.freeze(['controlRuntime', 'evaluateRuntime']),
    states: Object.freeze(['running', 'paused']),
    serialized: true,
    owner: 'adapter',
  }),
  release: Object.freeze({
    effects: Object.freeze(['controlRuntime']),
    states: Object.freeze(['starting', 'waitingForStart', 'running', 'pausePending', 'paused', 'releasing', 'failed']),
    serialized: false,
    owner: 'target-keeper',
  }),
});

export const RELEASE_SIGNALS = Object.freeze(['SIGTERM', 'SIGKILL']);

// The zero-grant read path. Every entry reads descriptors, script text, heap or debugger
// facts and runs no target code; none of them enables a debugger domain, releases a
// startup wait or changes a worker session.
export const READ_REQUESTS = Object.freeze([
  'Runtime.getProperties',
  'Runtime.getHeapUsage',
  'Runtime.getIsolateId',
  'Debugger.getScriptSource',
  'Debugger.getPossibleBreakpoints',
  'Debugger.getStackTrace',
  'Schema.getDomains',
]);

// The grant-gated control path: configuration and session plumbing, never evaluation.
export const CONTROL_REQUESTS = Object.freeze([
  'Runtime.enable',
  'Runtime.runIfWaitingForDebugger',
  'Debugger.enable',
  'Debugger.setAsyncCallStackDepth',
  'Debugger.setBreakpointByUrl',
  'Debugger.setBreakpoint',
  'Debugger.removeBreakpoint',
  'Debugger.setBreakpointsActive',
  'Debugger.setPauseOnExceptions',
  'NodeWorker.enable',
  'NodeWorker.disable',
  'NodeWorker.detach',
  'NodeWorker.sendMessageToWorker',
]);

// Breakhpoint requests whose parameters are target JavaScript rather than a location.
const BREAKPOINT_REQUESTS = Object.freeze(['Debugger.setBreakpointByUrl', 'Debugger.setBreakpoint']);

// The complete parameter set this profile admits for a generated-location breakpoint. A
// breakpoint condition, a URL pattern or any other field refuses: those parameters carry
// target JavaScript or widen the selection beyond the decoded location.
const BREAKPOINT_PARAMS = Object.freeze({
  'Debugger.setBreakpointByUrl': Object.freeze(['url', 'lineNumber', 'columnNumber']),
  'Debugger.setBreakpoint': Object.freeze(['location']),
  'Debugger.removeBreakpoint': Object.freeze(['breakpointId']),
});

const isNonNegative = (value) => Number.isSafeInteger(value) && value >= 0;

// The location metadata each breakpoint request requires. A request that names no
// location refuses here rather than reaching the backend as an error.
function admitBreakpointLocation(method, params) {
  if (method === 'Debugger.setBreakpointByUrl') {
    if (typeof params.url !== 'string' || params.url.length === 0) {
      return refusal('breakpointLocationMissing', 'url');
    }
    if (!isNonNegative(params.lineNumber)) return refusal('breakpointLocationMissing', 'lineNumber');
    if (params.columnNumber !== undefined && !isNonNegative(params.columnNumber)) {
      return refusal('breakpointLocationMissing', 'columnNumber');
    }
    return { ok: true };
  }
  if (method === 'Debugger.setBreakpoint') {
    if (typeof params.location !== 'object' || params.location === null || Array.isArray(params.location)) {
      return refusal('breakpointLocationMissing', 'location');
    }
    return { ok: true };
  }
  if (typeof params.breakpointId !== 'string' || params.breakpointId.length === 0) {
    return refusal('breakpointLocationMissing', 'breakpointId');
  }
  return { ok: true };
}

// Requests that execute target code. They are admitted only through the evaluate
// intent, which advances the mutation generation before the send.
export const EVALUATE_REQUESTS = Object.freeze([
  'Runtime.evaluate',
  'Debugger.evaluateOnCallFrame',
  'Runtime.callFunctionOn',
  'Runtime.compileScript',
]);

// Requests that change the pause state. They are admitted only through the pause or
// resume-step intent, which owns the pause epoch.
export const PAUSE_REQUESTS = Object.freeze([
  'Debugger.pause',
  'Debugger.resume',
  'Debugger.stepOver',
  'Debugger.stepInto',
  'Debugger.stepOut',
]);

const CONTROL_STATES = Object.freeze(['starting', 'waitingForStart', 'running', 'pausePending', 'paused']);

export class IntentRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'IntentRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

function refusal(condition, detail) {
  return { ok: false, condition, detail: detail === undefined ? null : detail };
}

// Admit one intent against the runtime record and the caller's explicit grants.
// Grants are the request's declared effects; a missing required effect refuses before
// any send or effect.
export function admitIntent(record, intent, { effects = [], signal = null, priorSignal = null } = {}) {
  const entry = INTENT_TABLE[intent];
  if (entry === undefined) return refusal('intentUnknown', String(intent));
  if (typeof record !== 'object' || record === null) return refusal('intentMalformed', 'record');
  for (const required of entry.effects) {
    if (!Array.isArray(effects) || !effects.includes(required)) {
      return refusal('missingEffect', `${intent} requires ${required}`);
    }
  }
  if (intent === 'release') {
    if (!RELEASE_SIGNALS.includes(signal)) return refusal('releaseSignalUnsupported', String(signal));
    // SIGKILL cannot be overwritten by SIGTERM.
    if (priorSignal === 'SIGKILL' && signal === 'SIGTERM') {
      return refusal('signalDowngrade', 'SIGKILL intent cannot be overwritten by SIGTERM');
    }
  }
  if (!entry.states.includes(record.state)) {
    return refusal('intentNotAdmitted', `${intent} from ${record.state}`);
  }
  if (entry.serialized && record.pending !== null) {
    return refusal('runtimeBusy', `pending ${record.pending.intent}`);
  }
  return { ok: true, intent, decision: { owner: entry.owner, serialized: entry.serialized, effects: entry.effects } };
}

// The zero-grant read path. `params` is never inspected for effectful content: no
// request in this table carries one.
export function admitReadRequest(record, method) {
  if (typeof record !== 'object' || record === null) return refusal('requestMalformed', 'record');
  if (record.state === 'exited') return refusal('requestNotAdmitted', 'read after exited');
  if (record.state === 'failed') return refusal('requestNotAdmitted', 'read after adapter failure');
  if (READ_REQUESTS.includes(method)) return { ok: true, method, category: 'read' };
  if (EVALUATE_REQUESTS.includes(method)) return refusal('evaluationRequiresIntent', method);
  if (PAUSE_REQUESTS.includes(method)) return refusal('stateChangeRequiresIntent', method);
  if (CONTROL_REQUESTS.includes(method)) return refusal('controlRequiresGrant', method);
  return refusal('requestUnlisted', method);
}

// The grant-gated control path. The control grant is checked before the method, and the
// method before the parameters, so a refusal names the first failed predicate.
export function admitControlRequest(record, method, params = {}, effects = []) {
  if (typeof record !== 'object' || record === null) return refusal('requestMalformed', 'record');
  if (!Array.isArray(effects) || !effects.includes('controlRuntime')) {
    return refusal('missingEffect', `${method} requires controlRuntime`);
  }
  if (!CONTROL_REQUESTS.includes(method)) {
    if (EVALUATE_REQUESTS.includes(method)) return refusal('evaluationRequiresIntent', method);
    if (PAUSE_REQUESTS.includes(method)) return refusal('stateChangeRequiresIntent', method);
    if (READ_REQUESTS.includes(method)) return refusal('readRequiresNoGrant', method);
    return refusal('requestUnlisted', method);
  }
  if (!CONTROL_STATES.includes(record.state)) {
    return refusal('requestNotAdmitted', `${method} from ${record.state}`);
  }
  if (BREAKPOINT_REQUESTS.includes(method) && params !== null && Object.hasOwn(params, 'condition')) {
    return refusal('breakpointConditionUnsupported', 'a breakpoint condition is target JavaScript');
  }
  if (Object.hasOwn(BREAKPOINT_PARAMS, method)) {
    if (params === null || typeof params !== 'object') return refusal('breakpointParamsMalformed', method);
    for (const key of Object.keys(params)) {
      if (!BREAKPOINT_PARAMS[method].includes(key)) {
        return refusal('breakpointParamsUnsupported', `${method}.${key}`);
      }
    }
    const location = admitBreakpointLocation(method, params);
    if (!location.ok) return location;
  }
  // State-changing CDP requests serialize per runtime: a control request is refused while
  // a state-changing intent is in flight, so no second request reaches the target while
  // an evaluation is pending. Release is an intent, not a control request, and stays
  // available to the owner.
  if (record.pending !== null) {
    return refusal('runtimeBusy', `pending ${record.pending.intent}`);
  }
  if (method === 'NodeWorker.sendMessageToWorker') {
    const inner = admitNestedWorkerMessage(params);
    if (!inner.ok) return inner;
    return { ok: true, method, category: 'control', inner: inner.method };
  }
  return { ok: true, method, category: 'control' };
}

// A nested worker message must itself be a read: the worker channel cannot carry an
// evaluation, a pause-state change or a configuration request the outer channel would
// refuse without its own grant.
function admitNestedWorkerMessage(params) {
  const message = params?.message;
  if (typeof message !== 'string') return refusal('workerMessageMalformed', 'message is not text');
  let parsed;
  try {
    parsed = JSON.parse(message);
  } catch (error) {
    return refusal('workerMessageMalformed', error.message);
  }
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.method !== 'string') {
    return refusal('workerMessageMalformed', 'message has no method');
  }
  if (EVALUATE_REQUESTS.includes(parsed.method)) return refusal('evaluationRequiresIntent', parsed.method);
  if (PAUSE_REQUESTS.includes(parsed.method)) return refusal('stateChangeRequiresIntent', parsed.method);
  if (CONTROL_REQUESTS.includes(parsed.method)) return refusal('nestedControlNotAdmitted', parsed.method);
  if (!READ_REQUESTS.includes(parsed.method)) return refusal('requestUnlisted', parsed.method);
  return { ok: true, method: parsed.method };
}

// The protocol request a state-changing intent sends.
export function requestForIntent(intent, params = {}) {
  switch (intent) {
    case 'pause':
      return { method: 'Debugger.pause', params: {} };
    case 'resume-step': {
      const action = params.action;
      const methods = {
        resume: 'Debugger.resume',
        next: 'Debugger.stepOver',
        stepIn: 'Debugger.stepInto',
        stepOut: 'Debugger.stepOut',
      };
      const method = methods[action];
      if (method === undefined) throw new IntentRefusal('resumeActionUnsupported', String(action));
      return { method, params: {} };
    }
    case 'evaluate': {
      const expression = params.expression;
      if (typeof expression !== 'string' || expression.length === 0) {
        throw new IntentRefusal('evaluateExpressionMissing', null);
      }
      if (params.frame !== undefined && params.frame !== null) {
        return { method: 'Debugger.evaluateOnCallFrame', params: { callFrameId: params.frame, expression } };
      }
      return { method: 'Runtime.evaluate', params: { expression } };
    }
    default:
      throw new IntentRefusal('intentUnknown', String(intent));
  }
}

// The startup stop of a launch intent: generated-location breakpoints, decoded by the
// caller. A condition is refused because it is target JavaScript.
export function startupStopRequests(stopAt) {
  if (stopAt === undefined || stopAt === null) return [];
  const positions = Array.isArray(stopAt) ? stopAt : [stopAt];
  return positions.map((position) => {
    if (typeof position !== 'object' || position === null) {
      throw new IntentRefusal('stopAtMalformed', null);
    }
    if (typeof position.url !== 'string' || position.url.length === 0
      || !Number.isSafeInteger(position.lineNumber) || position.lineNumber < 0) {
      throw new IntentRefusal('stopAtMalformed', 'stopAt needs a generated url and line');
    }
    if (Object.hasOwn(position, 'condition')) {
      throw new IntentRefusal('breakpointConditionUnsupported', 'a breakpoint condition is target JavaScript');
    }
    const params = { url: position.url, lineNumber: position.lineNumber };
    if (Number.isSafeInteger(position.columnNumber)) params.columnNumber = position.columnNumber;
    return { method: 'Debugger.setBreakpointByUrl', params };
  });
}
