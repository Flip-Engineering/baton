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
// Counter strings: epoch and mutationGeneration are canonical unsigned
// decimal strings owned by the CDP counter module and pass through here
// unchanged. Ref admission happens before any backend request through the
// composer-injected admitRef, because the backend may hand out byte-identical
// ids again at a later pause (recorded: an error while running, and silent
// rebinding at the next pause, were both observed).

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

// Maps Debugger.paused callFrames to observation frames. callFrames carry
// generated positions only; the composer binds resolveOriginal(scriptId,
// line, column), which decodes the script's local or embedded map and returns
// {path, line, column, name, mapDigest} or null. Every frame keeps its
// generated position and names its mapping provenance: 'mapped', 'unmapped'
// or 'unknownScript' when the script carries no decodable map. An async chain
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
  const frames = callFrames.map((callFrame) => {
    const location = callFrame?.location;
    const generated = {
      scriptId: location?.scriptId ?? null,
      line: location?.lineNumber ?? null,
      column: location?.columnNumber ?? null,
    };
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
    return {
      functionName: callFrame?.functionName ?? '',
      callFrameId: callFrame?.callFrameId ?? null,
      thread,
      generated,
      original,
      provenance,
    };
  });
  const async = {
    present: asyncStackTrace != null,
    captureEnabled: asyncCaptureEnabled === true,
    note:
      asyncCaptureEnabled === true
        ? null
        : 'async chain content is incomplete unless Debugger.setAsyncCallStackDepth was enabled before the chain formed',
  };
  return { frames, async };
}

// Summarizes one pause's scope chain. One Runtime.getProperties request per
// level (recorded fact): loadScope(scope) returns the response for exactly
// one scope object. Each scope names its object description, its expansion
// payload (identity members plus handle; the canonical ref encoding happens
// at composition through the canonical ref owner), the one-level property
// descriptors with their own completeness records, and the internal property
// list kept separate. Module bindings appear in the CommonJS wrapper frame's
// local scope and class-method `this` is the instance; both stay ordinary
// scopes here.
export function scopeSummaries({ scopeChain, identity = null, loadScope }) {
  if (!Array.isArray(scopeChain)) return { condition: 'malformedScopeChain' };
  const scopes = scopeChain.map((scope) => {
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
      if (loaded && loaded.condition) {
        summary.expansionRefusal = loaded;
      } else {
        summary.properties = loaded.result.map(propertyDescriptorSummary);
        summary.internalProperties = internalPropertiesSummary(loaded.internalProperties);
        summary.expansion = expansionCompleteness(loaded);
      }
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

// Names the observed worker threads. Basic discovery and state only: worker
// breakpoints, worker scopes and worker exception pause support stay
// unavailable until real qualification, and the limits travel with the
// inventory. Worker, debugger and context identities stay distinct per
// worker; endpoint URLs and UUIDs never enter the inventory.
export function workerInventory({ attached = [], detached = [] }) {
  const workers = attached.map((event) => {
    const info = event?.workerInfo ?? {};
    return {
      workerId: info.workerId ?? null,
      type: info.type ?? null,
      title: info.title ?? null,
      url: info.url ?? null,
      sessionId: event.sessionId ?? null,
      state: 'attached',
    };
  });
  const detachedIds = new Set(
    detached
      .map((event) => event?.workerInfo?.workerId ?? event?.workerId ?? null)
      .filter((id) => typeof id === 'string'),
  );
  for (const worker of workers) {
    if (detachedIds.has(worker.workerId)) worker.state = 'detached';
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

// Turns a ref admission decision into a refusal that can be returned before
// any backend request. Returns null for an admitted ref. The note names the
// recorded reuse behavior that makes adapter-side validation mandatory.
export function staleRefRefusal(admitDecision) {
  if (!admitDecision || admitDecision.ok !== false) return null;
  return {
    refused: true,
    condition: admitDecision.condition,
    note: 'handles are pause-scoped: a ref from another epoch or mutation generation is refused before any backend request, even though the backend may rebind byte-identical ids at a later pause',
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
