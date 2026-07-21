import { createHash } from 'node:crypto';

const POLICY_FIELDS = Object.freeze([
  'language', 'maxArtifactBytes', 'maxCellsPerSession', 'maxEvidenceCoordinates',
  'maxJoinComparisons', 'maxManifestBranches', 'maxProgramBytes', 'maxProgramDepth',
  'maxProgramNodes', 'maxResultItems', 'maxTextBytes', 'recursionDepth', 'schemaVersion',
  'stateMode',
]);
const NORMALIZED_FIELDS = Object.freeze([...POLICY_FIELDS, 'policyDigest']);

const DEFAULT_INPUT = Object.freeze({
  schemaVersion: 1,
  language: 'baton-context-ir-v1',
  stateMode: 'stateless',
  recursionDepth: 1,
  maxManifestBranches: 1_024,
  maxProgramBytes: 64 * 1_024,
  maxProgramNodes: 256,
  maxProgramDepth: 32,
  maxResultItems: 10_000,
  maxJoinComparisons: 1_000_000,
  maxCellsPerSession: 1_024,
  maxTextBytes: 16 * 1_024,
  maxArtifactBytes: 64 * 1_024 * 1_024,
  maxEvidenceCoordinates: 100_000,
});

function policyError(message) {
  return Object.assign(new TypeError(message), { code: 'context_policy_invalid' });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function normalizeContextProgramPolicy(value = DEFAULT_INPUT) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw policyError('Context Program policy must be an object');
  }
  const hasDigest = Object.hasOwn(value, 'policyDigest');
  const expected = hasDigest ? NORMALIZED_FIELDS : POLICY_FIELDS;
  if (Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
    throw policyError('Context Program policy must be one closed deployment-owned contract');
  }
  const integerFields = POLICY_FIELDS.filter((field) => field.startsWith('max'));
  if (value.schemaVersion !== 1
    || value.language !== 'baton-context-ir-v1'
    || value.stateMode !== 'stateless'
    || value.recursionDepth !== 1
    || integerFields.some((field) => !Number.isSafeInteger(value[field]) || value[field] <= 0)
    || value.maxManifestBranches > 4_096
    || value.maxProgramBytes > 1024 * 1_024
    || value.maxProgramNodes > 4_096
    || value.maxProgramDepth > 128
    || value.maxResultItems > 100_000
    || value.maxJoinComparisons > 100_000_000
    || value.maxCellsPerSession > 16_384
    || value.maxTextBytes > 1024 * 1_024
    || value.maxArtifactBytes > 1024 * 1_024 * 1_024
    || value.maxEvidenceCoordinates > 1_000_000
    || value.maxEvidenceCoordinates < value.maxResultItems) {
    throw policyError('Context Program policy values are invalid or unbounded');
  }
  const body = Object.fromEntries(POLICY_FIELDS.map((field) => [field, value[field]]));
  const policyDigest = digest(body);
  if (hasDigest && value.policyDigest !== policyDigest) {
    throw policyError('Context Program policy digest is invalid');
  }
  return deepFreeze({ ...body, policyDigest });
}

export const DEFAULT_CONTEXT_PROGRAM_POLICY = normalizeContextProgramPolicy();
