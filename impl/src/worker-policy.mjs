import { createHash } from 'node:crypto';

const AUTONOMY = new Set(['unattended', 'interactive']);
const ACCESS = new Set(['full', 'workspace']);
const CONTAINMENT_MODE = new Set(['workspace_preferred', 'workspace_required', 'external_required']);
const CONTAINMENT_MINIMUM = new Set(['private_runtime', 'tool_workspace', 'external']);
const GUARANTEE = new Set(['private_runtime', 'tool_workspace', 'external']);
const HOST_PROCESS = new Set(['same_uid', 'external']);
const OBSERVATION = new Set(['provider', 'launch', 'runtime_probe', 'unavailable']);
const RESOLVED_CONTAINMENT = new Set(['unverified', 'private_runtime_only', 'tool_workspace', 'external']);
const ATTESTATION = new Set(['satisfied', 'preferred_gap']);
const SAFE_MECHANISM = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._:+/-]{1,128}$/u;

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function closed(value, fields) {
  return record(value) && Object.keys(value).every((key) => fields.includes(key));
}
function unique(values) { return [...new Set(values)].sort(); }
function policyError(message, code = 'worker_policy_invalid') {
  return Object.assign(new TypeError(message), { code });
}

export const DEFAULT_WORKER_POLICY_REQUEST = Object.freeze({
  schemaVersion: 1,
  autonomy: Object.freeze({ mode: 'unattended' }),
  access: Object.freeze({ mode: 'full' }),
  containment: Object.freeze({ mode: 'workspace_preferred', minimum: 'private_runtime' }),
});

export function normalizeWorkerPolicyRequest(value = DEFAULT_WORKER_POLICY_REQUEST) {
  if (!closed(value, ['schemaVersion', 'autonomy', 'access', 'containment']) || value.schemaVersion !== 1
    || !closed(value.autonomy, ['mode']) || !AUTONOMY.has(value.autonomy.mode)
    || !closed(value.access, ['mode']) || !ACCESS.has(value.access.mode)
    || !closed(value.containment, ['mode', 'minimum'])
    || !CONTAINMENT_MODE.has(value.containment.mode)
    || !CONTAINMENT_MINIMUM.has(value.containment.minimum)
    || (value.containment.mode === 'external_required' && value.containment.minimum !== 'external')) {
    throw policyError('worker policy request is invalid');
  }
  return Object.freeze({
    schemaVersion: 1,
    autonomy: Object.freeze({ mode: value.autonomy.mode }),
    access: Object.freeze({ mode: value.access.mode }),
    containment: Object.freeze({
      mode: value.containment.mode, minimum: value.containment.minimum,
    }),
  });
}

export function workerPolicyRequestDigest(value) {
  return digest(normalizeWorkerPolicyRequest(value));
}

export function normalizeWorkerPolicyCard(value) {
  if (!closed(value, ['schemaVersion', 'autonomy', 'access', 'containment']) || value.schemaVersion !== 1
    || !closed(value.autonomy, ['supported', 'default', 'perTask', 'observation', 'mechanisms'])
    || !Array.isArray(value.autonomy.supported) || value.autonomy.supported.length === 0
    || value.autonomy.supported.some((mode) => !AUTONOMY.has(mode))
    || new Set(value.autonomy.supported).size !== value.autonomy.supported.length
    || !value.autonomy.supported.includes(value.autonomy.default)
    || typeof value.autonomy.perTask !== 'boolean'
    || !OBSERVATION.has(value.autonomy.observation)
    || !Array.isArray(value.autonomy.mechanisms)
    || value.autonomy.mechanisms.some((mechanism) => !SAFE_MECHANISM.test(mechanism))
    || !closed(value.access, ['supported', 'default', 'perTask', 'observation', 'mechanisms'])
    || !Array.isArray(value.access.supported) || value.access.supported.length === 0
    || value.access.supported.some((mode) => !ACCESS.has(mode))
    || new Set(value.access.supported).size !== value.access.supported.length
    || !value.access.supported.includes(value.access.default)
    || typeof value.access.perTask !== 'boolean'
    || !OBSERVATION.has(value.access.observation)
    || !Array.isArray(value.access.mechanisms)
    || value.access.mechanisms.some((mechanism) => !SAFE_MECHANISM.test(mechanism))
    || !closed(value.containment, ['hostProcess', 'guarantees', 'configuredPreferences', 'observation'])
    || !HOST_PROCESS.has(value.containment.hostProcess)
    || !Array.isArray(value.containment.guarantees)
    || value.containment.guarantees.some((guarantee) => !GUARANTEE.has(guarantee))
    || !Array.isArray(value.containment.configuredPreferences)
    || value.containment.configuredPreferences.some((mechanism) => !SAFE_MECHANISM.test(mechanism))
    || !OBSERVATION.has(value.containment.observation)) {
    throw policyError('worker policy card is invalid');
  }
  return Object.freeze({
    schemaVersion: 1,
    autonomy: Object.freeze({
      supported: Object.freeze(unique(value.autonomy.supported)),
      default: value.autonomy.default,
      perTask: value.autonomy.perTask,
      observation: value.autonomy.observation,
      mechanisms: Object.freeze(unique(value.autonomy.mechanisms)),
    }),
    access: Object.freeze({
      supported: Object.freeze(unique(value.access.supported)),
      default: value.access.default,
      perTask: value.access.perTask,
      observation: value.access.observation,
      mechanisms: Object.freeze(unique(value.access.mechanisms)),
    }),
    containment: Object.freeze({
      hostProcess: value.containment.hostProcess,
      guarantees: Object.freeze(unique(value.containment.guarantees)),
      configuredPreferences: Object.freeze(unique(value.containment.configuredPreferences)),
      observation: value.containment.observation,
    }),
  });
}

export function normalizeWorkerPolicyResolution(value) {
  if (!closed(value, [
    'schemaVersion', 'requestDigest', 'autonomy', 'access', 'containment',
    'adapterCardDigest', 'resolutionDigest',
  ]) || value.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/u.test(value.requestDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.adapterCardDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.resolutionDigest ?? '')
    || !closed(value.autonomy, ['requested', 'resolved', 'observation', 'mechanisms'])
    || !AUTONOMY.has(value.autonomy.requested) || value.autonomy.resolved !== value.autonomy.requested
    || !OBSERVATION.has(value.autonomy.observation) || !Array.isArray(value.autonomy.mechanisms)
    || value.autonomy.mechanisms.some((mechanism) => !SAFE_MECHANISM.test(mechanism))
    || !closed(value.access, ['requested', 'resolved', 'observation', 'mechanisms'])
    || !ACCESS.has(value.access.requested) || value.access.resolved !== value.access.requested
    || !OBSERVATION.has(value.access.observation) || !Array.isArray(value.access.mechanisms)
    || value.access.mechanisms.some((mechanism) => !SAFE_MECHANISM.test(mechanism))
    || !closed(value.containment, [
      'requested', 'resolved', 'hostProcess', 'guarantees', 'configuredPreferences',
      'observation', 'attestation',
    ])
    || !closed(value.containment.requested, ['mode', 'minimum'])
    || !CONTAINMENT_MODE.has(value.containment.requested.mode)
    || !CONTAINMENT_MINIMUM.has(value.containment.requested.minimum)
    || !RESOLVED_CONTAINMENT.has(value.containment.resolved)
    || !HOST_PROCESS.has(value.containment.hostProcess)
    || !Array.isArray(value.containment.guarantees)
    || value.containment.guarantees.some((guarantee) => !GUARANTEE.has(guarantee))
    || !Array.isArray(value.containment.configuredPreferences)
    || value.containment.configuredPreferences.some((mechanism) => !SAFE_MECHANISM.test(mechanism))
    || !OBSERVATION.has(value.containment.observation)
    || !ATTESTATION.has(value.containment.attestation)) {
    throw policyError('worker policy resolution is invalid');
  }
  const normalized = {
    schemaVersion: 1,
    requestDigest: value.requestDigest,
    autonomy: {
      requested: value.autonomy.requested, resolved: value.autonomy.resolved,
      observation: value.autonomy.observation, mechanisms: unique(value.autonomy.mechanisms),
    },
    access: {
      requested: value.access.requested, resolved: value.access.resolved,
      observation: value.access.observation, mechanisms: unique(value.access.mechanisms),
    },
    containment: {
      requested: clone(value.containment.requested), resolved: value.containment.resolved,
      hostProcess: value.containment.hostProcess, guarantees: unique(value.containment.guarantees),
      configuredPreferences: unique(value.containment.configuredPreferences),
      observation: value.containment.observation, attestation: value.containment.attestation,
    },
    adapterCardDigest: value.adapterCardDigest,
  };
  if (value.resolutionDigest !== digest(normalized)) {
    throw policyError('worker policy resolution digest is invalid');
  }
  return Object.freeze({
    ...normalized,
    autonomy: Object.freeze({
      ...normalized.autonomy, mechanisms: Object.freeze(normalized.autonomy.mechanisms),
    }),
    access: Object.freeze({
      ...normalized.access, mechanisms: Object.freeze(normalized.access.mechanisms),
    }),
    containment: Object.freeze({
      ...normalized.containment,
      requested: Object.freeze(normalized.containment.requested),
      guarantees: Object.freeze(normalized.containment.guarantees),
      configuredPreferences: Object.freeze(normalized.containment.configuredPreferences),
    }),
    resolutionDigest: value.resolutionDigest,
  });
}

export function normalizeWorkerPolicyObservation(value) {
  const axis = (entry, modes) => closed(entry, ['source', 'observed'])
    && OBSERVATION.has(entry.source)
    && (entry.source === 'unavailable' ? entry.observed === null : modes.has(entry.observed));
  if (!closed(value, [
    'schemaVersion', 'resolutionDigest', 'autonomy', 'access', 'containment', 'observationDigest',
  ]) || value.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/u.test(value.resolutionDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.observationDigest ?? '')
    || !axis(value.autonomy, AUTONOMY)
    || !axis(value.access, ACCESS)
    || !axis(value.containment, RESOLVED_CONTAINMENT)) {
    throw policyError('worker policy observation is invalid', 'worker_policy_observation_invalid');
  }
  const normalized = {
    schemaVersion: 1,
    resolutionDigest: value.resolutionDigest,
    autonomy: { source: value.autonomy.source, observed: value.autonomy.observed },
    access: { source: value.access.source, observed: value.access.observed },
    containment: { source: value.containment.source, observed: value.containment.observed },
  };
  if (value.observationDigest !== digest(normalized)) {
    throw policyError('worker policy observation digest is invalid', 'worker_policy_observation_invalid');
  }
  return Object.freeze({
    ...normalized,
    autonomy: Object.freeze(normalized.autonomy),
    access: Object.freeze(normalized.access),
    containment: Object.freeze(normalized.containment),
    observationDigest: value.observationDigest,
  });
}

export function workerPolicyObservationRequired(resolutionValue) {
  const resolution = normalizeWorkerPolicyResolution(resolutionValue);
  return resolution.autonomy.observation !== 'unavailable'
    || resolution.access.observation !== 'unavailable'
    || resolution.containment.observation !== 'unavailable';
}

export function createWorkerPolicyObservation(resolutionValue, observed = {}) {
  const resolution = normalizeWorkerPolicyResolution(resolutionValue);
  const entry = (axis, actual) => ({
    source: axis.observation,
    observed: axis.observation === 'unavailable' ? null : actual ?? null,
  });
  const core = {
    schemaVersion: 1,
    resolutionDigest: resolution.resolutionDigest,
    autonomy: entry(resolution.autonomy, observed.autonomy),
    access: entry(resolution.access, observed.access),
    containment: entry(resolution.containment, observed.containment),
  };
  return normalizeWorkerPolicyObservation({ ...core, observationDigest: digest(core) });
}

export function compareWorkerPolicyObservation(resolutionValue, observationValue) {
  const resolution = normalizeWorkerPolicyResolution(resolutionValue);
  const observation = normalizeWorkerPolicyObservation(observationValue);
  const mismatches = [];
  if (observation.resolutionDigest !== resolution.resolutionDigest) {
    mismatches.push(Object.freeze({
      axis: 'resolution', reason: 'resolution_digest_mismatch',
      expected: resolution.resolutionDigest, observed: observation.resolutionDigest,
    }));
  }
  for (const [name, expected, actual] of [
    ['autonomy', resolution.autonomy, observation.autonomy],
    ['access', resolution.access, observation.access],
    ['containment', resolution.containment, observation.containment],
  ]) {
    if (actual.source !== expected.observation) {
      mismatches.push(Object.freeze({
        axis: name, reason: 'observation_source_mismatch',
        expected: expected.observation, observed: actual.source,
      }));
      continue;
    }
    if (actual.source === 'unavailable') continue;
    const resolved = name === 'containment' ? expected.resolved : expected.resolved;
    if (actual.observed !== resolved) {
      mismatches.push(Object.freeze({
        axis: name, reason: 'observed_value_mismatch', expected: resolved, observed: actual.observed,
      }));
    }
  }
  return Object.freeze(mismatches);
}

export function attestWorkerPolicyObservation(resolutionValue, observed = {}) {
  const observation = createWorkerPolicyObservation(resolutionValue, observed);
  const mismatches = compareWorkerPolicyObservation(resolutionValue, observation);
  if (mismatches.length > 0) {
    const error = policyError('worker policy observation disagrees with the authorized resolution', 'worker_policy_observation_mismatch');
    error.mismatches = mismatches;
    throw error;
  }
  return observation;
}

function resolvedContainment(card) {
  if (card.containment.guarantees.includes('external')) return 'external';
  if (card.containment.guarantees.includes('tool_workspace')) return 'tool_workspace';
  if (card.containment.guarantees.includes('private_runtime')) return 'private_runtime_only';
  return 'unverified';
}

function minimumSatisfied(minimum, guarantees) {
  if (minimum === 'private_runtime') return guarantees.includes('private_runtime')
    || guarantees.includes('tool_workspace') || guarantees.includes('external');
  if (minimum === 'tool_workspace') return guarantees.includes('tool_workspace')
    || guarantees.includes('external');
  return guarantees.includes('external');
}

export function resolveWorkerPolicy(requestValue, cardValue) {
  const request = normalizeWorkerPolicyRequest(requestValue);
  const card = normalizeWorkerPolicyCard(cardValue);
  if (!card.autonomy.supported.includes(request.autonomy.mode)) {
    throw policyError('adapter cannot satisfy requested worker autonomy', 'worker_policy_autonomy_unavailable');
  }
  if (!card.access.supported.includes(request.access.mode)) {
    throw policyError('adapter cannot satisfy requested worker access', 'worker_policy_access_unavailable');
  }
  const minimumMet = minimumSatisfied(request.containment.minimum, card.containment.guarantees);
  const workspaceMet = card.containment.guarantees.includes('tool_workspace')
    || card.containment.guarantees.includes('external');
  const required = request.containment.mode !== 'workspace_preferred';
  if (!minimumMet || (request.containment.mode === 'workspace_required' && !workspaceMet)
    || (request.containment.mode === 'external_required'
      && !card.containment.guarantees.includes('external'))) {
    throw policyError('adapter cannot satisfy required worker containment', 'worker_policy_containment_unavailable');
  }
  const requestDigest = digest(request);
  const cardDigest = digest(card);
  const resolution = {
    schemaVersion: 1,
    requestDigest,
    autonomy: {
      requested: request.autonomy.mode,
      resolved: request.autonomy.mode,
      observation: card.autonomy.observation,
      mechanisms: clone(card.autonomy.mechanisms),
    },
    access: {
      requested: request.access.mode,
      resolved: request.access.mode,
      observation: card.access.observation,
      mechanisms: clone(card.access.mechanisms),
    },
    containment: {
      requested: clone(request.containment),
      resolved: resolvedContainment(card),
      hostProcess: card.containment.hostProcess,
      guarantees: clone(card.containment.guarantees),
      configuredPreferences: clone(card.containment.configuredPreferences),
      observation: card.containment.observation,
      attestation: required || request.containment.minimum !== 'private_runtime'
        ? 'satisfied' : workspaceMet ? 'satisfied' : 'preferred_gap',
    },
    adapterCardDigest: cardDigest,
  };
  return normalizeWorkerPolicyResolution({ ...resolution, resolutionDigest: digest(resolution) });
}
