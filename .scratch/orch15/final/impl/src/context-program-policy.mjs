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

/** The ceiling each integer policy field is validated against in normalizeContextProgramPolicy.
 * CONTEXT_REFERENCE_READ_POLICY in context-program.mjs derives from this table; do not hand-copy
 * these values elsewhere. */
export const NORMALIZER_CEILING = Object.freeze({
  maxManifestBranches: 4_096,
  maxProgramBytes: 1024 * 1_024,
  maxProgramNodes: 4_096,
  maxProgramDepth: 128,
  maxResultItems: 100_000,
  maxJoinComparisons: 100_000_000,
  maxCellsPerSession: 16_384,
  maxTextBytes: 1024 * 1_024,
  maxArtifactBytes: 1024 * 1_024 * 1_024,
  maxEvidenceCoordinates: 1_000_000,
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
    || value.maxManifestBranches > NORMALIZER_CEILING.maxManifestBranches
    || value.maxProgramBytes > NORMALIZER_CEILING.maxProgramBytes
    || value.maxProgramNodes > NORMALIZER_CEILING.maxProgramNodes
    || value.maxProgramDepth > NORMALIZER_CEILING.maxProgramDepth
    || value.maxResultItems > NORMALIZER_CEILING.maxResultItems
    || value.maxJoinComparisons > NORMALIZER_CEILING.maxJoinComparisons
    || value.maxCellsPerSession > NORMALIZER_CEILING.maxCellsPerSession
    || value.maxTextBytes > NORMALIZER_CEILING.maxTextBytes
    || value.maxArtifactBytes > NORMALIZER_CEILING.maxArtifactBytes
    || value.maxEvidenceCoordinates > NORMALIZER_CEILING.maxEvidenceCoordinates
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

/** The width ONE context source string is projected at, before the deployment policy's own text
 * bound has its say: the ceiling every chunk of a document was always cut at. */
export const CONTEXT_SOURCE_CHUNK_CEILING_BYTES = 12 * 1024;

/** The ONE chunk-size derivation for a context source string — a repository doc, a retained
 * result, or a document the root's reading leg hands over (#488): never wider than the projection
 * ceiling above, and never wider than the deployment policy's own `maxTextBytes`, so a chunk is a
 * string the deployment's source scan admits by construction. `context-runtime.mjs`'s two chunk
 * loops and `application-cli.mjs`'s reading leg all read THIS function, never a second constant. */
export function contextSourceChunkBytes(policy = DEFAULT_CONTEXT_PROGRAM_POLICY) {
  const bound = policy?.maxTextBytes;
  if (!Number.isSafeInteger(bound) || bound <= 0) {
    throw policyError('Context Program policy maxTextBytes is invalid');
  }
  return Math.min(CONTEXT_SOURCE_CHUNK_CEILING_BYTES, bound);
}

export const DEFAULT_CONTEXT_PROGRAM_POLICY = normalizeContextProgramPolicy();
