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
// The injected CDP requireAdmittedRef normalizer is MANDATORY on every
// operative normalization path - admissionOutcome, staleRefRefusal and the
// capture binding refuse productionNormalizerRequired without it, and no
// local shape validator exists in this module (standalone shape checks live
// in the test files that need them). This module never derives admission
// from the absence of a refusal. A runtimeBusy answer is a terminal refusal
// for the capture, not a retry obligation, and release stays available as
// an intent.
//
// Capture: reads run through an awaited acquisition that samples the
// composer's live session before and after every read and at publication,
// through the injected production admission. An identity change yields an
// explicit changedDuringCapture result with the scopes admitted so far; the
// response observed across a changed read is carried as rawRecord with an
// explicit note that its timing relative to the mutation is NOT
// established, and it is never reported complete. Summary rendering over
// already-acquired records is a separate synchronous operation that
// performs no backend read.
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

function refusal(condition, detail) {
  return { admitted: false, refused: true, condition, detail: detail ?? null, note: ADMISSION_NOTE };
}

// Normalizes one production ref decision into
// {admitted:true, identity} or {admitted:false, refused:true, condition,
// detail, note}; both outcomes always carry the admitted member so callers
// can branch on it directly. The injected production requireAdmittedRef
// (the CDP owner's normalizer) is REQUIRED: it decides alone, its returned
// identity is in-contract by the producer's own guarantee, and its thrown
// refusal renders with its ACTUAL condition and detail values - nothing is
// coerced into another shape. Without it this function refuses with
// productionNormalizerRequired instead of consulting any local validator;
// standalone shape checks live in the test files that need them.
export function admissionOutcome(decision, { requireAdmittedRef } = {}) {
  if (typeof requireAdmittedRef !== 'function') {
    return refusal('productionNormalizerRequired', 'admissionOutcome requires the injected production requireAdmittedRef normalizer');
  }
  try {
    const identity = requireAdmittedRef(decision);
    return { admitted: true, identity };
  } catch (err) {
    const condition = err && typeof err.condition === 'string' ? err.condition : 'refDecisionMalformed';
    return refusal(condition, err && err.detail !== undefined ? err.detail : null);
  }
}

// Renders a decision as a refusal record, or null when the production
// admission admitted the ref. Requires the injected production
// requireAdmittedRef like every operative normalization path; rendered
// conditions are the production normalizer's actual values.
export function staleRefRefusal(decision, options) {
  const outcome = admissionOutcome(decision, options);
  return outcome.admitted ? null : { admitted: false, refused: true, condition: outcome.condition, detail: outcome.detail ?? null, note: outcome.note };
}

// Binds one multirequest capture to a ref the production admission issued at
// capture start. Production normalization is MANDATORY on this operative
// path: requireAdmittedRef (the imported/injected CDP normalizer) is
// required, and every sample delegates to it through the injected
// production admitRef - the standalone shape helper is never consulted
// here. liveNow is a function the composer supplies that returns the
// CURRENT live record at call time (from session.snapshot()); the binding
// never accepts a static live object as the capture's truth. The
// composer's session.admitRef remains the scope authority and runs
// synchronously immediately before each send initiation inside loadScope;
// the caller gates every backend access and the publication on sample().
// An identity change yields the explicit refusal - staleReference after a
// resume, refRetiredByMutation after an evaluation,
// refStopNotLive/refThreadUnknown/refOutsidePause from the session layer,
// runtimeBusy while an evaluation is pending - never a coherent capture by
// assertion.
export function createCaptureBinding({ admitRef, ref, liveNow, requireAdmittedRef }) {
  const missing = [];
  if (typeof admitRef !== 'function') missing.push('admitRef');
  if (typeof requireAdmittedRef !== 'function') missing.push('requireAdmittedRef');
  if (ref === null || ref === undefined) missing.push('ref');
  if (typeof liveNow !== 'function') missing.push('liveNow');
  if (missing.length > 0) {
    const detail = `operative capture requires the injected production admission, normalizer and live sampler; missing: ${missing.join(', ')}`;
    return { sample: () => refusal('productionNormalizerRequired', detail) };
  }
  return {
    sample: () => admissionOutcome(admitRef(ref, liveNow()), { requireAdmittedRef }),
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

function scopeSummaryOf(scope, identity, record) {
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
    expansion: { complete: false, reason: 'recordAbsent' },
  };
  if (record === undefined || record === null) {
    return summary;
  }
  if (record.condition) {
    summary.expansionRefusal = { admitted: false, refused: true, condition: record.condition, detail: record.detail ?? null };
    return summary;
  }
  if (!Array.isArray(record.result)) {
    summary.expansion = expansionCompleteness(record);
    return summary;
  }
  summary.properties = record.result.map(propertyDescriptorSummary);
  summary.internalProperties = internalPropertiesSummary(record.internalProperties);
  summary.expansion = expansionCompleteness(record);
  return summary;
}

// The awaited capture over one pause's scope chain. Every backend read is
// issued by loadScope AFTER the binding samples and admits the live session,
// and sampled again after the read resolves and once more at publication.
// The composer's session.admitRef runs synchronously immediately before
// each send initiation inside loadScope. An identity change across any
// boundary returns {condition:'changedDuringCapture', scopes:<admitted
// prefix>, refusal, stage} with the raw response observed across the read
// carried as rawRecord - the mutation's timing relative to the read is NOT
// established, so that record is an observed response, never described as
// evidence that the mutation preceded it - and never reported complete. A
// scope read that returns its own refusal record stops the capture with
// {condition:'scopeReadRefused', refusal, scopes}. Only a capture whose
// before-read, after-read and publication samples all admitted returns
// {scopes, records}.
export async function captureScopes({ scopeChain, identity = null, loadScope, binding }) {
  if (!Array.isArray(scopeChain)) return { condition: 'malformedScopeChain' };
  if (typeof loadScope !== 'function') return { condition: 'loadScopeRequired' };
  if (!binding || typeof binding.sample !== 'function') return { condition: 'admissionRequired' };
  const scopes = [];
  const records = new Map();
  for (const scope of scopeChain) {
    const before = binding.sample();
    if (!before.admitted) {
      return { condition: 'changedDuringCapture', scopes, refusal: before, stage: 'beforeRead' };
    }
    const rawRecord = await loadScope(scope);
    const after = binding.sample();
    if (!after.admitted) {
      return {
        condition: 'changedDuringCapture',
        scopes,
        refusal: after,
        stage: 'afterRead',
        rawRecord,
        rawRecordNote: 'the response observed across the read; the mutation timing relative to the read is not established',
      };
    }
    if (rawRecord && rawRecord.condition) {
      return { condition: 'scopeReadRefused', refusal: { admitted: false, refused: true, condition: rawRecord.condition, detail: rawRecord.detail ?? null }, scopes };
    }
    records.set(scope, rawRecord);
    scopes.push(scopeSummaryOf(scope, identity, rawRecord));
  }
  const atPublication = binding.sample();
  if (!atPublication.admitted) {
    return { condition: 'changedDuringCapture', scopes, refusal: atPublication, stage: 'publication' };
  }
  return { scopes, records };
}

// Summary-only rendering over already-acquired records. This synchronous
// operation performs NO backend read and accepts no loader: records is a Map
// (or lookup function) from scope object to its awaited response record, as
// returned by captureScopes. A scope without a record renders an absent
// expansion record; it never triggers a read.
export function scopeSummaries({ scopeChain, identity = null, records = null }) {
  if (!Array.isArray(scopeChain)) return { condition: 'malformedScopeChain' };
  const lookup =
    records instanceof Map
      ? (scope) => records.get(scope)
      : typeof records === 'function'
        ? records
        : null;
  const scopes = scopeChain.map((scope) => {
    const record = lookup ? lookup(scope) : undefined;
    const summary = scopeSummaryOf(scope, identity, record);
    if (!lookup) {
      summary.expansion = { complete: false, reason: 'recordAbsent' };
      summary.expansionNote = 'summary rendering performs no reads; acquire records through captureScopes';
    }
    return summary;
  });
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
// and UUIDs never enter capture records or results.
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
