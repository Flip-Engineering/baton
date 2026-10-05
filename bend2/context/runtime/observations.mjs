// One-epoch runtime observation assembly (docs/bend2/semantic-context-spec.md,
// Runtime contract; the recorded CDP research facts).
//
// Read path only. This module composes observations from property
// descriptors, script source reads and recorded protocol events. It never
// releases startup waits, sets or removes breakpoints, resumes or steps the
// target, evaluates expressions, or mutates workers; those are control and
// evaluate intents owned by the lifecycle composition, and the ordinary
// observe intent requires no controlRuntime grant.
//
// Admission: every backend access is gated on the production ref decision.
// The composer injects the CDP owner's admitRef (decision === 'admitted' with
// identity, or {decision:'refused', condition, detail}); this module treats
// anything else as a refusal and never derives admission from the absence of
// a refusal. A runtimeBusy answer is a terminal refusal for the capture, not
// a retry obligation, and release stays available as an intent.
//
// Counter strings: epoch and mutationGeneration are canonical unsigned
// decimal strings owned by the CDP counter module and pass through here
// unchanged. Stop liveness comes from the composer's snapshot
// (lastPause.liveness); anything but 'live' means no live stop, and a
// resumption is never inferred from a send attempt.

import {
  describeRemoteObject,
  expansionCompleteness,
  expansionPayload,
  internalPropertiesSummary,
  nullKind,
  previewCompleteness,
  propertyDescriptorSummary,
} from './values.mjs';

export { describeRemoteObject, nullKind, previewCompleteness, propertyDescriptorSummary, expansionPayload, expansionCompleteness };

export const ADMISSION_NOTE =
  'backend access requires an explicit admitted ref decision from the production admission; a refusal or a malformed candidate refuses before any send, and a runtimeBusy answer is a refusal rather than a retry obligation';

function refusalOf(decision) {
  if (decision && typeof decision === 'object' && decision.decision === 'refused') {
    return {
      refused: true,
      condition: typeof decision.condition === 'string' ? decision.condition : 'refDecisionRefused',
      detail: decision.detail ?? null,
      note: ADMISSION_NOTE,
    };
  }
  const hasDecision = decision !== null && typeof decision === 'object' && decision.decision !== undefined;
  return {
    refused: true,
    condition: hasDecision ? 'refDecisionMalformed' : 'refDecisionRefused',
    detail: null,
    note: ADMISSION_NOTE,
  };
}

// Normalizes one production ref decision. Only {decision:'admitted',
// ok:true, identity} admits; a candidate that claims admission while
// carrying ok:false refuses as refDecisionContradictory (the production law
// ref_decision_refuses_a_contradictory_candidate pins that shape), an
// admitted candidate without the asserted members refuses as
// refDecisionMalformed, and a refused decision renders its own condition and
// detail. The returned outcome is either {admitted:true, identity} or
// {refused:true, condition, detail, note}; nothing in between, so no caller
// can read absence of refusal as admission.
export function admissionOutcome(decision) {
  if (decision && typeof decision === 'object' && decision.decision === 'admitted') {
    if (decision.ok === false) {
      return { refused: true, condition: 'refDecisionContradictory', detail: null, note: ADMISSION_NOTE };
    }
    if (decision.ok === true && decision.identity && typeof decision.identity === 'object') {
      return { admitted: true, identity: decision.identity };
    }
    return { refused: true, condition: 'refDecisionMalformed', detail: null, note: ADMISSION_NOTE };
  }
  return refusalOf(decision);
}

// Renders a decision as a refusal record, or null when the production
// admission admitted the ref. Rendered conditions include the production
// set: refMalformed, foreignRuntime, foreignAdapter, staleReference,
// refRetiredByMutation, refOutsidePause, refStopNotLive, refThreadUnknown,
// and refDecisionMalformed/refDecisionRefused for malformed or non-admitted
// candidates.
export function staleRefRefusal(decision) {
  const outcome = admissionOutcome(decision);
  return outcome.admitted ? null : { refused: true, condition: outcome.condition, detail: outcome.detail ?? null, note: outcome.note };
}

// Binds one multirequest capture to a ref the production admission issued at
// capture start. check(live) re-admits that ref against the composer's
// current live record before every asynchronous read and at capture end,
// through the injected production admitRef; this module never re-implements
// the comparison. The outcome is the production decision rendered: admitted,
// or an explicit refusal (staleReference after a resume, refRetiredByMutation
// after an evaluation, refStopNotLive/refThreadUnknown/refOutsidePause from
// the session layer, runtimeBusy while an evaluation is pending). An
// observed identity change yields the explicit refusal; it never becomes a
// coherent capture by assertion.
export function createCaptureBinding({ admitRef, ref }) {
  if (typeof admitRef !== 'function') {
    return { check: () => ({ refused: true, condition: 'refDecisionMalformed', detail: 'no production admission was injected', note: ADMISSION_NOTE }) };
  }
  if (ref === null || ref === undefined) {
    return { check: () => ({ refused: true, condition: 'refDecisionMalformed', detail: 'capture carries no issued ref', note: ADMISSION_NOTE }) };
  }
  return {
    check: (live) => admissionOutcome(admitRef(ref, live ?? null)),
  };
}

function mapFrameLocation(frame) {
  // Debugger.paused call frames nest the location; async StackFrames carry it
  // flat beside an optional url. Both shapes resolve here.
  const location = frame?.location ?? {
    scriptId: frame?.scriptId,
    lineNumber: frame?.lineNumber,
    columnNumber: frame?.columnNumber,
  };
  return {
    scriptId: location?.scriptId ?? null,
    line: location?.lineNumber ?? null,
    column: location?.columnNumber ?? null,
    url: typeof frame?.url === 'string' ? frame.url : null,
  };
}

function mapFrameList(callFrames, thread, resolveOriginal, asyncChainDepth = null) {
  return (Array.isArray(callFrames) ? callFrames : []).map((frame) => {
    const generated = mapFrameLocation(frame);
    let original = null;
    let provenance = 'unknownScript';
    if (
      typeof generated.scriptId === 'string' &&
      Number.isSafeInteger(generated.line) &&
      Number.isSafeInteger(generated.column) &&
      typeof resolveOriginal === 'function'
    ) {
      const mapped = resolveOriginal(generated.scriptId, generated.line, generated.column);
      if (mapped) {
        original = {
          path: mapped.path,
          line: mapped.line,
          column: mapped.column,
          name: mapped.name ?? null,
          mapDigest: mapped.mapDigest,
        };
        provenance = 'mapped';
      } else {
        provenance = 'unmapped';
      }
    }
    const record = {
      functionName: frame?.functionName ?? '',
      callFrameId: frame?.callFrameId ?? null,
      thread,
      generated,
      original,
      provenance,
    };
    if (asyncChainDepth !== null) {
      record.async = true;
      record.asyncDepth = asyncChainDepth;
    }
    return record;
  });
}

function mapAsyncChain(chain, thread, resolveOriginal, depth, seen) {
  if (!chain || typeof chain !== 'object' || seen.has(chain)) return null;
  seen.add(chain);
  return {
    description: typeof chain.description === 'string' ? chain.description : null,
    frames: mapFrameList(chain.callFrames, thread, resolveOriginal, depth),
    parent: mapAsyncChain(chain.parent, thread, resolveOriginal, depth + 1, seen),
  };
}

// Maps Debugger.paused callFrames to observation frames, retaining the
// recorded async chain instead of a present flag. callFrames carry generated
// positions only; the composer binds resolveOriginal(scriptId, line,
// column), which decodes the script's local or embedded map and returns
// {path, line, column, name, mapDigest} or null. Every frame keeps its
// generated position and names its mapping provenance: 'mapped', 'unmapped'
// or 'unknownScript' when the script carries no decodable map. The async
// chain records its frames and parent chain with their own provenance and
// states whether async capture was enabled before the chain formed; a chain
// captured without that earlier enable is explicitly incomplete.
export function mapStackFrames({
  callFrames,
  asyncStackTrace = null,
  asyncCaptureEnabled = false,
  thread = 'main:0',
  resolveOriginal,
}) {
  if (!Array.isArray(callFrames)) return { condition: 'malformedCallFrames' };
  const frames = mapFrameList(callFrames, thread, resolveOriginal, null);
  const async = {
    present: asyncStackTrace != null,
    captureEnabled: asyncCaptureEnabled === true,
    note:
      asyncCaptureEnabled === true
        ? null
        : 'async chain content is incomplete unless Debugger.setAsyncCallStackDepth was enabled before the chain formed',
    chain: asyncStackTrace != null ? mapAsyncChain(asyncStackTrace, thread, resolveOriginal, 0, new WeakSet()) : null,
  };
  return { frames, async };
}

// Summarizes one pause's scope chain. One Runtime.getProperties request per
// level (recorded fact): loadScope(scope) returns the already-awaited
// response record for exactly one scope object - a promise is refused as
// asyncScopeRecordUnresolved, because this assembly never dereferences an
// unsettled read. Before each loadScope the injected admission binding
// (createCaptureBinding) re-admits the capture ref against the live record;
// a refusal stops the capture with an explicit changedDuringCapture result
// carrying the scopes collected so far, never a coherent capture by
// assertion. Each scope names its object description, its expansion payload
// (identity members plus handle; the canonical ref encoding happens at
// composition through the canonical ref owner), the one-level property
// descriptors with their own completeness records, and the internal property
// list kept separate.
export function scopeSummaries({ scopeChain, identity = null, loadScope, admission = null, live = null }) {
  if (!Array.isArray(scopeChain)) return { condition: 'malformedScopeChain' };
  const scopes = [];
  for (const scope of scopeChain) {
    if (admission && typeof admission.check === 'function') {
      const outcome = admission.check(live);
      if (!outcome || !outcome.admitted) {
        return {
          condition: 'changedDuringCapture',
          scopes,
          refusal: outcome && outcome.refused
            ? outcome
            : { refused: true, condition: outcome?.condition ?? 'refDecisionMalformed', detail: outcome?.detail ?? null, note: ADMISSION_NOTE },
        };
      }
    }
    const object = scope?.object ? describeRemoteObject(scope.object) : { condition: 'missingScopeObject' };
    const summary = {
      type: scope?.type ?? null,
      name: scope?.name ?? null,
      object,
      nullKind: scope?.object ? nullKind(scope.object) : null,
      objectPayload: scope?.object?.objectId ? expansionPayload({ value: scope.object }, identity) : null,
      properties: [],
      internalProperties: [],
      preview: scope?.object?.preview ? previewCompleteness(scope.object.preview) : null,
    };
    if (typeof loadScope === 'function' && typeof scope?.object?.objectId === 'string') {
      const loaded = loadScope(scope);
      if (loaded && typeof loaded.then === 'function') {
        summary.expansionRefusal = {
          refused: true,
          condition: 'asyncScopeRecordUnresolved',
          detail: 'loadScope returned an unsettled promise; the composer awaits each read before assembling',
        };
      } else if (loaded && loaded.condition) {
        summary.expansionRefusal = { refused: true, condition: loaded.condition, detail: loaded.detail ?? null };
      } else if (!loaded || !Array.isArray(loaded.result)) {
        summary.expansion = expansionCompleteness(loaded);
      } else {
        summary.properties = loaded.result.map(propertyDescriptorSummary);
        summary.internalProperties = internalPropertiesSummary(loaded.internalProperties);
        summary.expansion = expansionCompleteness(loaded);
      }
    }
    scopes.push(summary);
  }
  return { scopes };
}

// Captures an exception value. During a pause the exception value is
// Debugger.paused.data (a RemoteObject); Runtime.exceptionThrown fires only
// while the target is not paused. The two sources are never merged: a call
// that supplies both refuses, and a call that supplies neither refuses.
export function captureException({ paused, pausedData = null, exceptionThrownEvent = null }) {
  if (paused === true) {
    if (exceptionThrownEvent) return { condition: 'conflictingExceptionSources' };
    if (!pausedData) return { condition: 'noExceptionObserved' };
    return { source: 'paused.data', value: describeRemoteObject(pausedData) };
  }
  if (exceptionThrownEvent) {
    if (pausedData) return { condition: 'conflictingExceptionSources' };
    const details = exceptionThrownEvent.exceptionDetails ?? null;
    if (!details) return { condition: 'noExceptionObserved' };
    const exceptionObject =
      details.exception ??
      { type: 'object', className: 'Error', description: details.text ?? null };
    return {
      source: 'exceptionThrown',
      value: describeRemoteObject(exceptionObject),
      text: details.text ?? null,
      stackTrace: details.stackTrace ?? null,
    };
  }
  return { condition: 'noExceptionObserved' };
}

// Names the observed worker threads against the actual detach events. A
// NodeWorker.attachedToWorker event records the worker identity under its
// session id; NodeWorker.detachedFromWorker names that session id, so a
// detached session is matched through it - never through the worker id
// alone. A session that detached is never reported attached; a detach whose
// session has no recorded attach is recorded as an unmatched detach instead
// of being dropped. Basic discovery and state only: worker breakpoints,
// worker scopes and worker exception pause support stay unavailable until
// real qualification, and the limits travel with the inventory. Worker,
// debugger and context identities stay distinct per worker; endpoint URLs
// and UUIDs never enter the inventory. Worker and session lifetime admission
// belongs to the CDP owner.
export function workerInventory({ attached = [], detachedFromWorker = [], detached = [] } = {}) {
  const workers = [];
  const bySession = new Map();
  for (const event of attached) {
    const info = event?.workerInfo ?? {};
    const worker = {
      workerId: info.workerId ?? null,
      type: info.type ?? null,
      title: info.title ?? null,
      url: info.url ?? null,
      sessionId: event.sessionId ?? null,
      state: 'attached',
      detached: null,
    };
    workers.push(worker);
    if (worker.sessionId !== null) bySession.set(worker.sessionId, worker);
  }
  for (const event of [...(Array.isArray(detachedFromWorker) ? detachedFromWorker : []), ...(Array.isArray(detached) ? detached : [])]) {
    const sessionId = event?.sessionId ?? null;
    const recorded = sessionId !== null ? bySession.get(sessionId) : undefined;
    if (recorded) {
      recorded.state = 'detached';
      recorded.detached = { sessionId, reason: event?.reason ?? null };
    } else {
      workers.push({
        workerId: event?.workerInfo?.workerId ?? null,
        type: event?.workerInfo?.type ?? null,
        title: event?.workerInfo?.title ?? null,
        url: event?.workerInfo?.url ?? null,
        sessionId,
        state: 'detached',
        detached: { sessionId, reason: event?.reason ?? null },
        note: 'detach arrived without a recorded attached event for this session',
      });
    }
  }
  return {
    workers,
    limits: ['workerBreakpointsUnavailable', 'workerScopesUnavailable', 'workerExceptionsUnavailable'],
  };
}

// Builds the capture record of one multirequest observation: its start and
// end protocol event identities, per-response consistency, unverified control
// exclusivity, and the epoch string the capture was taken at. Event
// identities are protocol event/sequence identities; inspector endpoint URLs
// and UUIDs never enter capture records or results. A capture whose live
// stop is not 'live' is named by the caller's own refusal; this record is
// built only for captures that actually ran.
export function captureIdentity({ startEvent, endEvent, epoch }) {
  if (!startEvent || !endEvent) return { condition: 'captureIncomplete' };
  return {
    startEvent,
    endEvent,
    consistency: 'per-response',
    controlExclusivity: 'unverified',
    epoch,
  };
}

// Builds the runtime evidence item of an observed fact with explicit nulls:
// every field is present, and an absent member is null rather than omitted.
// Runtime facts classify as observed; epoch and mutationGeneration (where the
// caller embeds them) stay canonical decimal strings.
export function runtimeEvidence({ runtime, epoch, thread = null, script = null, generated = null, original = null }) {
  if (typeof runtime !== 'string' || runtime === '') return { condition: 'missingRuntimeIdentity' };
  if (typeof epoch !== 'string' || epoch === '') return { condition: 'missingEpoch' };
  return { kind: 'runtime', runtime, epoch, thread, script, generated, original };
}
