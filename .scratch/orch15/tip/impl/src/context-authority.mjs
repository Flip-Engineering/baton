import {
  contextValueDigest, normalizeContextProgram, normalizeManifestAny,
} from './context-program.mjs';
import { normalizeContextProgramPolicy } from './context-program-policy.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const EFFECT_OPS = new Set(['map', 'reduce', 'review', 'verify']);
const ARTIFACT_MEDIA = Object.freeze({
  context_provider_result: 'application/vnd.baton.context-provider-result+json',
  context_value: 'application/vnd.baton.context-value+json',
  context_evidence: 'application/vnd.baton.context-cell-evidence+json',
  context_call_evidence: 'application/vnd.baton.context-call-evidence+json',
});
const AUTHORITY_FIELDS = Object.freeze(['actor', 'principalId', 'repoId', 'runId']);

function authorityError(message, code = 'context_authority_invalid') {
  return Object.assign(new TypeError(message), { code });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function normalizeContextAuthority(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...AUTHORITY_FIELDS].sort().join(',')) {
    throw authorityError('Context authority is malformed', 'context_authority_invalid');
  }
  const normalized = {};
  for (const field of AUTHORITY_FIELDS) {
    const text = value[field];
    if (typeof text !== 'string' || text.length === 0 || text.includes('\0')
      || Buffer.byteLength(text) > 512 || !/^[A-Za-z0-9._:@/-]+$/u.test(text)) {
      throw authorityError(`Context authority ${field} is invalid`, 'context_authority_invalid');
    }
    normalized[field] = text;
  }
  return deepFreeze(normalized);
}

function expressions(value) {
  if (!value || typeof value !== 'object') return [];
  const nested = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === 'op') continue;
    if (Array.isArray(child)) nested.push(...child.flatMap(expressions));
    else if (child && typeof child === 'object') nested.push(...expressions(child));
  }
  return [value, ...nested];
}

export function contextProgramIsPure(program, policy) {
  const normalized = normalizeContextProgram(program, policy);
  return !expressions(normalized.expression).some((expression) => EFFECT_OPS.has(expression.op));
}

export function contextProgramInputRefs(program, manifest, policy) {
  const normalizedProgram = normalizeContextProgram(program, policy);
  const normalizedManifest = normalizeManifestAny(manifest, policy);
  const branches = new Map(normalizedManifest.branches.map((branch) => [branch.name, branch]));
  const refs = new Map();
  for (const expression of expressions(normalizedProgram.expression)) {
    if (expression.op !== 'source') continue;
    const branch = branches.get(expression.branch);
    if (!branch) {
      throw authorityError(`Context Program branch ${expression.branch} is unavailable`,
        'context_cell_invalid');
    }
    refs.set(branch.ref, Object.freeze({
      kind: 'context_source', branch: branch.name, ref: branch.ref, digest: branch.digest,
    }));
  }
  return deepFreeze([...refs.values()].sort((left, right) => (
    left.branch < right.branch ? -1 : left.branch > right.branch ? 1 : 0
  )));
}

export function contextSessionIdentity({ manifest, environmentDigest, policy }) {
  const normalizedPolicy = normalizeContextProgramPolicy(policy);
  const normalizedManifest = normalizeManifestAny(manifest, normalizedPolicy);
  if (!DIGEST.test(environmentDigest ?? '')) {
    throw authorityError('Context session environment digest is invalid', 'context_session_invalid');
  }
  const core = {
    schemaVersion: 1,
    kind: 'baton.context_session',
    repoId: normalizedManifest.repoId,
    // REPL-1 rule 4b: the ONLY manifest-kind-typed deref in the identity core. Everything else
    // (repoId, tree, manifestDigest, policyDigest, sessionId derivation) is kind-agnostic, so a
    // REPL and a Workflow session never collide on sessionId (their manifestDigests differ).
    runId: normalizedManifest.kind === 'baton.repl_manifest'
      ? normalizedManifest.repl.runId : normalizedManifest.workflow.runId,
    manifestDigest: normalizedManifest.digest,
    environmentDigest,
    policyDigest: normalizedPolicy.policyDigest,
    tree: normalizedManifest.tree,
  };
  const sessionDigest = contextValueDigest(core);
  return deepFreeze({
    ...core, sessionId: `context-session:${sessionDigest}`, sessionDigest,
    manifest: normalizedManifest,
  });
}

export function contextCellIdentity({ session, program, ordinal, predecessor = null, policy }) {
  const normalizedPolicy = normalizeContextProgramPolicy(policy);
  const normalizedProgram = normalizeContextProgram(program, normalizedPolicy);
  if (!session || typeof session !== 'object' || Array.isArray(session)
    || !/^context-session:[a-f0-9]{64}$/u.test(session.sessionId ?? '')
    || !DIGEST.test(session.manifestDigest ?? '') || !DIGEST.test(session.environmentDigest ?? '')
    || session.policyDigest !== normalizedPolicy.policyDigest
    || !Number.isSafeInteger(ordinal) || ordinal <= 0
    || (predecessor !== null && !/^cell:[a-f0-9]{64}$/u.test(predecessor))) {
    throw authorityError('Context cell session coordinates are invalid', 'context_cell_invalid');
  }
  const inputRefs = contextProgramInputRefs(
    normalizedProgram, session.manifest, normalizedPolicy,
  );
  const contentCore = {
    schemaVersion: 1,
    kind: 'baton.context_cell',
    manifestDigest: session.manifestDigest,
    programDigest: normalizedProgram.programDigest,
    environmentDigest: session.environmentDigest,
    policyDigest: session.policyDigest,
  };
  const cellId = `cell:${contextValueDigest(contentCore)}`;
  const admissionCore = {
    ...contentCore,
    cellId,
    sessionId: session.sessionId,
    generation: 1,
    ordinal,
    predecessor,
    inputRefs,
    executionKind: 'pure',
    program: normalizedProgram,
  };
  return deepFreeze({
    ...admissionCore, admissionDigest: contextValueDigest(admissionCore),
  });
}

export function normalizeContextArtifactRef(value, expectedKind, policy) {
  const normalizedPolicy = normalizeContextProgramPolicy(policy);
  const mediaType = ARTIFACT_MEDIA[expectedKind];
  if (!mediaType || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',')
      !== ['bytes', 'digest', 'handle', 'kind', 'mediaType'].sort().join(',')
    || value.kind !== expectedKind || value.mediaType !== mediaType
    || !DIGEST.test(value.digest ?? '') || value.handle !== `art:sha256:${value.digest}`
    || !Number.isSafeInteger(value.bytes) || value.bytes <= 0
    || value.bytes > normalizedPolicy.maxArtifactBytes) {
    throw authorityError('Context artifact ref is invalid', 'context_artifact_integrity');
  }
  return deepFreeze({ ...value });
}
