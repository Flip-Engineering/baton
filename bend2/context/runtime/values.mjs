// RemoteObject value observation (docs/bend2/semantic-context-spec.md,
// Runtime contract; the recorded CDP research facts).
//
// Module boundary: these are CDP-specific value shapes for the optional CDP
// module. Generalized value semantics keep each provider's own types,
// representation, completeness and actual availability: no universal
// JavaScript null/undefined model, no getter-execution or stepping
// assumptions, and no completeness claim beyond what the provider actually
// returned. The reusable parts for other modules are the capture/provenance
// records and their admission, not these protocol shapes.
//
// Non-evaluating only: values and previews come from Runtime.getProperties
// responses. Accessor properties remain descriptors and no getter executes
// during observation; Runtime.callFunctionOn and evaluateOnCallFrame are
// evaluate-intent operations outside this module.
//
// Value semantics: observed values follow the provider's general JSON
// semantics. Numbers keep their exact provider value and sign (negative and
// fractional values included); the provider emits either a value field or an
// unserializableValue field (NaN, Infinity, -0, bigint) and this module
// retains whichever fields are present verbatim, never inventing or dropping
// one; null subtype, the undefined type and a JSON null value remain three
// distinct observations. No numeric range validation is applied to observed
// values.
//
// Counter strings: epoch and mutationGeneration are canonical unsigned
// decimal strings owned by the CDP counter module. This module carries them
// unchanged; it never increments, formats or range-checks them.

export const PREVIEW_NOTE =
  'a preview is an incomplete rendering; overflow:false does not prove complete strings; full expansion through expansion refs is the only completeness path';

export const VALUE_LIMITS = {
  previewIncomplete: 'previewIncomplete',
  accessorNotExecuted: 'accessorNotExecuted',
  expansionRefused: 'expansionRefused',
};

// Describes one CDP RemoteObject. Every recorded field is preserved: the
// value passes through unchanged, an unserializableValue is carried verbatim
// and takes precedence over any value field, and an objectId marks a handle
// that can be expanded through a ref query.
export function describeRemoteObject(remoteObject) {
  if (remoteObject === null || typeof remoteObject !== 'object' || Array.isArray(remoteObject)) {
    return { condition: 'malformedRemoteObject' };
  }
  const described = {
    type: remoteObject.type ?? null,
    subtype: remoteObject.subtype ?? null,
    className: remoteObject.className ?? null,
    description: remoteObject.description ?? null,
  };
  if (Object.prototype.hasOwnProperty.call(remoteObject, 'value')) {
    described.value = remoteObject.value;
  }
  if (Object.prototype.hasOwnProperty.call(remoteObject, 'unserializableValue')) {
    described.unserializableValue = remoteObject.unserializableValue;
  }
  if (typeof remoteObject.objectId === 'string') {
    described.objectId = remoteObject.objectId;
  }
  if (remoteObject.preview !== undefined) {
    described.preview = remoteObject.preview;
  }
  return described;
}

// Names which of null-subtype object, undefined type and JSON null value an
// observed RemoteObject represents. Returns null for none of them.
export function nullKind(remoteObject) {
  if (!remoteObject || typeof remoteObject !== 'object') return null;
  if (remoteObject.type === 'undefined') return 'undefined';
  if (remoteObject.subtype === 'null') return 'null';
  if (
    remoteObject.type === 'object' &&
    (remoteObject.subtype === undefined || remoteObject.subtype === null) &&
    Object.prototype.hasOwnProperty.call(remoteObject, 'value') &&
    remoteObject.value === null
  ) {
    return 'jsonNullValue';
  }
  return null;
}

// Classifies a preview rendering. The conservative rule is that any preview
// is incomplete: complete is false for every preview, the overflow flag is
// passed through, and a trailing U+2026 in a property value or the
// description is reported as a truncation hint. The recorded fixture
// thresholds (string previews near 100 characters, five previewed object
// properties, one hundred previewed array elements) are fixture facts, not
// rules; this function never reads them.
export function previewCompleteness(preview) {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    return { condition: 'noPreview' };
  }
  const properties = Array.isArray(preview.properties) ? preview.properties : [];
  const truncationSuspected =
    properties.some((p) => p && typeof p === 'object' && typeof p.value === 'string' && p.value.endsWith('\u2026')) ||
    (typeof preview.description === 'string' && preview.description.endsWith('\u2026'));
  return {
    complete: false,
    reason: VALUE_LIMITS.previewIncomplete,
    overflow: preview.overflow === true,
    truncationSuspected,
    note: PREVIEW_NOTE,
  };
}

// Summarizes one property descriptor. Data properties keep their value as a
// described RemoteObject; accessor properties keep their getter and setter as
// described RemoteObjects (handles when present, null otherwise) and are
// never invoked here. Symbol property descriptors retain their symbol field
// as a described RemoteObject beside the name. isOwn is preserved exactly as
// the provider recorded it: a descriptor without the field reports null
// rather than an invented ownership claim. Distinct handles that alias one
// target are kept apart.
export function propertyDescriptorSummary(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return { condition: 'malformedPropertyDescriptor' };
  }
  const summary = {
    name: typeof descriptor.name === 'string' ? descriptor.name : describeRemoteObject(descriptor.name),
    isOwn: typeof descriptor.isOwn === 'boolean' ? descriptor.isOwn : null,
    kind: 'data',
  };
  if (descriptor.symbol !== undefined) {
    summary.symbol = describeRemoteObject(descriptor.symbol);
  }
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    summary.kind = 'accessor';
    summary.get = descriptor.get === undefined ? null : describeRemoteObject(descriptor.get);
    summary.set = descriptor.set === undefined ? null : describeRemoteObject(descriptor.set);
  } else {
    summary.writable = descriptor.writable === true;
    summary.value = Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? describeRemoteObject(descriptor.value)
      : { condition: 'malformedPropertyDescriptor' };
  }
  if (descriptor.enumerable !== undefined) summary.enumerable = descriptor.enumerable === true;
  if (descriptor.configurable !== undefined) summary.configurable = descriptor.configurable === true;
  if (descriptor.wasThrown === true) summary.wasThrown = true;
  if (descriptor.synthetic === true) summary.synthetic = true;
  return summary;
}

// Retains the internal property list ([[Prototype]] and friends) beside the
// ordinary descriptor list; ownership and internal metadata are never merged
// into it.
export function internalPropertiesSummary(internalProperties) {
  if (!Array.isArray(internalProperties)) return [];
  return internalProperties.map((entry) => ({
    name: entry?.name ?? null,
    value: entry && entry.value !== undefined ? describeRemoteObject(entry.value) : null,
  }));
}

// Builds the expansion payload for a descriptor: the object handle plus the
// identity members the canonical ref encoding needs. identity carries
// {runtime, adapter, thread, epoch, mutationGeneration} with the counter
// strings as canonical decimal text; the ref array encoding itself belongs to
// the canonical ref owner and happens at composition. Returns null when the
// descriptor carries no expandable handle.
export function expansionPayload(descriptor, identity) {
  if (!descriptor || typeof descriptor !== 'object') return null;
  const holder =
    (descriptor.value && typeof descriptor.value === 'object' && descriptor.value.objectId) ||
    (descriptor.get && typeof descriptor.get === 'object' && descriptor.get.objectId) ||
    null;
  if (typeof holder !== 'string' || holder === '') return null;
  return { kind: 'object', handle: holder, identity };
}

// Classifies a Runtime.getProperties response used as full expansion. The
// response carries the complete own-property list; a transport-level
// exceptionDetails refuses the expansion claim. Nothing here executed an
// accessor: Runtime.getProperties returns descriptors.
export function expansionCompleteness(response) {
  if (!response || typeof response !== 'object') {
    return { complete: false, reason: 'malformedExpansionResponse' };
  }
  if (response.exceptionDetails) {
    return { complete: false, reason: VALUE_LIMITS.expansionRefused, exceptionDetails: response.exceptionDetails };
  }
  if (!Array.isArray(response.result)) {
    return { complete: false, reason: 'malformedExpansionResponse' };
  }
  return {
    complete: true,
    reason: 'fullExpansion',
    propertyCount: response.result.length,
    internalPropertyCount: Array.isArray(response.internalProperties) ? response.internalProperties.length : 0,
    accessorExecuted: false,
  };
}
