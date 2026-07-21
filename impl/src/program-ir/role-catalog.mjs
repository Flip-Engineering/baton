// Phase 93a.2 role catalog schema v2 (§93.7). A catalog binds each role to an exact
// harness/model/effort route request, a separately authorized service-tier request (null rules
// exhaustive), and a worker-policy request whose digest recomputes over the Program-canonical
// bytes of the normalized Phase 92/default schema-v1 request. Inline NodeTemplates revalidate and
// recompute nodeTemplateDigest; content_ref bindings are immutable approved artifacts and receive
// shape-only validation here (byte revalidation happens at replay, never from current defaults).
// catalogDigest recomputes over the full normalized catalog excluding itself. No I/O, no clocks,
// no randomness: every rejection happens before any effect.

import {
  canonicalProgramDigest, canonicalValueText, compareProgramIdentityKeys, deepFreezeProgramValue,
  isProgramValueAuthority, normalizeCanonicalProgramValue,
} from './canonical-value.mjs';
import {
  boundedText, digestValue, exactFields, fail, nonnegativeInteger, normalizePathArray,
  normalizeSafeIdSet, normalizeVerificationContractRef, safeId,
} from './control-nodes.mjs';
import { isProgramPolicy } from './program-policy.mjs';
import { normalizeWorkerPolicyRequest } from '../worker-policy.mjs';

const catalogs = new WeakSet();

function authority(value) {
  if (!isProgramValueAuthority(value)) {
    fail('Role catalog validation requires deployment-injected authority', 'program_policy_invalid');
  }
  return value;
}

function requirePolicy(value) {
  if (!isProgramPolicy(value)) {
    fail('Role catalog validation requires a normalized ProgramPolicy', 'program_policy_invalid');
  }
  return value;
}

// The Phase 92/default schema-v1 request shape is owned by worker-policy.mjs; its normalizer is
// reused here and its errors are folded into program_invalid. The digest domain is the Program
// canonical bytes of the normalized request (§93.7), not the historical worker-policy digest.
export function normalizeRoleWorkerPolicyRequest(value, deployed) {
  let request;
  try {
    request = normalizeWorkerPolicyRequest(value);
  } catch {
    fail('Role workerPolicyRequest is not a valid Phase 92/default schema-v1 request');
  }
  return { request, digest: canonicalProgramDigest(request, deployed) };
}

function normalizeRouteRequest(value, label) {
  exactFields(value, ['harness', 'model', 'effort'], label);
  return {
    harness: safeId(value.harness, `${label}.harness`),
    model: safeId(value.model, `${label}.model`),
    effort: safeId(value.effort, `${label}.effort`),
  };
}

function normalizeServiceTierRequest(value, label) {
  exactFields(value, ['mode', 'value', 'authorizationDigest'], label);
  if (value.mode === 'exact') {
    return {
      mode: 'exact',
      value: boundedText(value.value, `${label}.value`, 1024),
      authorizationDigest: digestValue(value.authorizationDigest, `${label}.authorizationDigest`),
    };
  }
  if (value.mode === 'none') {
    if (value.value !== null || value.authorizationDigest !== null) {
      fail(`${label} mode "none" requires null value and null authorizationDigest`);
    }
    return { mode: 'none', value: null, authorizationDigest: null };
  }
  fail(`${label}.mode is invalid`);
}

function normalizeIndependenceFamily(value, label, deployed) {
  exactFields(value, ['harnessFamily', 'modelFamily', 'familyDigest'], label);
  const harnessFamily = safeId(value.harnessFamily, `${label}.harnessFamily`);
  const modelFamily = safeId(value.modelFamily, `${label}.modelFamily`);
  const familyDigest = digestValue(value.familyDigest, `${label}.familyDigest`);
  if (familyDigest !== canonicalProgramDigest({ harnessFamily, modelFamily }, deployed)) {
    fail(`${label}.familyDigest is invalid`);
  }
  return { harnessFamily, modelFamily, familyDigest };
}

function normalizeArtifactRef(value, label) {
  exactFields(value, ['kind', 'artifactId', 'artifactDigest', 'mediaType', 'bytes'], label);
  if (value.kind !== 'artifact_ref') fail(`${label}.kind is invalid`);
  const artifactDigest = digestValue(value.artifactDigest, `${label}.artifactDigest`);
  if (value.artifactId !== `artifact:${artifactDigest}`) fail(`${label}.artifactId is invalid`);
  return {
    kind: 'artifact_ref',
    artifactId: value.artifactId,
    artifactDigest,
    mediaType: boundedText(value.mediaType, `${label}.mediaType`, 1024),
    bytes: nonnegativeInteger(value.bytes, `${label}.bytes`),
  };
}

function normalizeNodeTemplate(value, { deployed, policy, roleRequestText }) {
  const label = 'NodeTemplate';
  exactFields(value, [
    'definitionOfDone', 'pathScope', 'contextScope', 'risk', 'verificationContract',
    'capabilities', 'effects', 'requiredEffects', 'workerPolicyRequest',
  ], label);
  if (!Array.isArray(value.definitionOfDone) || value.definitionOfDone.length < 1
    || value.definitionOfDone.length > policy.maxEvidenceRefs) {
    fail(`${label}.definitionOfDone must contain 1..maxEvidenceRefs entries`);
  }
  const definitionOfDone = value.definitionOfDone.map((entry, index) => boundedText(
    entry, `${label}.definitionOfDone[${index}]`, policy.maxValueBytes));
  const setBound = { min: 0, max: policy.maxEvidenceRefs };
  const capabilities = normalizeSafeIdSet(value.capabilities, `${label}.capabilities`, setBound);
  const effects = normalizeSafeIdSet(value.effects, `${label}.effects`, setBound);
  const requiredEffects = normalizeSafeIdSet(value.requiredEffects, `${label}.requiredEffects`, setBound);
  if (requiredEffects.some((effect) => !effects.includes(effect))) {
    fail(`${label}.requiredEffects must be a subset of effects`);
  }
  const { request } = normalizeRoleWorkerPolicyRequest(value.workerPolicyRequest, deployed);
  if (canonicalValueText(request, deployed) !== roleRequestText) {
    fail(`${label}.workerPolicyRequest must be byte-identical to the role workerPolicyRequest`);
  }
  return {
    definitionOfDone,
    pathScope: normalizePathArray(value.pathScope, `${label}.pathScope`,
      { min: 1, max: policy.maxEvidenceRefs }),
    contextScope: normalizePathArray(value.contextScope, `${label}.contextScope`,
      { min: 1, max: policy.maxEvidenceRefs }),
    risk: safeId(value.risk, `${label}.risk`),
    verificationContract: normalizeVerificationContractRef(value.verificationContract,
      `${label}.verificationContract`),
    capabilities,
    effects,
    requiredEffects,
    workerPolicyRequest: request,
  };
}

function normalizeTemplateBinding(value, { deployed, policy, roleRequestText }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('TemplateBinding must be an object');
  }
  if (value.kind === 'inline') {
    exactFields(value, ['kind', 'nodeTemplate', 'nodeTemplateDigest'], 'TemplateBinding inline');
    const nodeTemplate = normalizeNodeTemplate(value.nodeTemplate, { deployed, policy, roleRequestText });
    const nodeTemplateDigest = digestValue(value.nodeTemplateDigest,
      'TemplateBinding inline.nodeTemplateDigest');
    if (nodeTemplateDigest !== canonicalProgramDigest(nodeTemplate, deployed)) {
      fail('TemplateBinding inline.nodeTemplateDigest does not match its canonical template bytes');
    }
    return { kind: 'inline', nodeTemplate, nodeTemplateDigest };
  }
  if (value.kind === 'content_ref') {
    exactFields(value, ['kind', 'artifact', 'nodeTemplateDigest', 'approvalDigest'],
      'TemplateBinding content_ref');
    return {
      kind: 'content_ref',
      artifact: normalizeArtifactRef(value.artifact, 'TemplateBinding content_ref.artifact'),
      nodeTemplateDigest: digestValue(value.nodeTemplateDigest,
        'TemplateBinding content_ref.nodeTemplateDigest'),
      approvalDigest: digestValue(value.approvalDigest, 'TemplateBinding content_ref.approvalDigest'),
    };
  }
  fail('TemplateBinding kind is unknown');
}

function normalizeRole(value, { deployed, policy }) {
  const label = 'Role';
  exactFields(value, [
    'role', 'routeRequest', 'serviceTierRequest', 'workerPolicyRequest',
    'workerPolicyRequestDigest', 'templateBinding', 'nodeTemplateDigest', 'independenceFamily',
  ], label);
  const role = safeId(value.role, `${label}.role`);
  const { request, digest } = normalizeRoleWorkerPolicyRequest(value.workerPolicyRequest, deployed);
  const workerPolicyRequestDigest = digestValue(value.workerPolicyRequestDigest,
    `${label}.workerPolicyRequestDigest`);
  if (workerPolicyRequestDigest !== digest) {
    fail(`${label} worker policy request digest does not match the normalized request`);
  }
  const roleRequestText = canonicalValueText(request, deployed);
  const templateBinding = normalizeTemplateBinding(value.templateBinding,
    { deployed, policy, roleRequestText });
  const nodeTemplateDigest = digestValue(value.nodeTemplateDigest, `${label}.nodeTemplateDigest`);
  if (nodeTemplateDigest !== templateBinding.nodeTemplateDigest) {
    fail(`${label}.nodeTemplateDigest does not match its template binding`);
  }
  return {
    role,
    routeRequest: normalizeRouteRequest(value.routeRequest, `${label}.routeRequest`),
    serviceTierRequest: normalizeServiceTierRequest(value.serviceTierRequest,
      `${label}.serviceTierRequest`),
    workerPolicyRequest: request,
    workerPolicyRequestDigest,
    templateBinding,
    nodeTemplateDigest,
    independenceFamily: normalizeIndependenceFamily(value.independenceFamily,
      `${label}.independenceFamily`, deployed),
  };
}

export function isProgramRoleCatalog(value) {
  return Boolean(value && typeof value === 'object' && catalogs.has(value));
}

export function normalizeRoleCatalog(value, { authority: valueAuthority, policy } = {}) {
  const deployed = authority(valueAuthority);
  const programPolicy = requirePolicy(policy);
  const normalized = normalizeCanonicalProgramValue(value, deployed);
  exactFields(normalized, ['schemaVersion', 'kind', 'roles', 'catalogDigest'], 'Role catalog');
  if (normalized.schemaVersion !== 2) fail('Role catalog schemaVersion must be 2');
  if (normalized.kind !== 'baton.program_role_catalog') fail('Role catalog kind is invalid');
  if (!Array.isArray(normalized.roles) || normalized.roles.length < 1
    || normalized.roles.length > programPolicy.maxProgramNodes) {
    fail('Role catalog roles must contain 1..maxProgramNodes entries');
  }
  const roles = normalized.roles.map((role) => normalizeRole(role, { deployed, policy: programPolicy }));
  const names = roles.map((role) => role.role);
  if (new Set(names).size !== names.length) fail('Role catalog contains a duplicate role');
  roles.sort((left, right) => compareProgramIdentityKeys(left.role, right.role));
  const catalogDigest = digestValue(normalized.catalogDigest, 'Role catalog catalogDigest');
  const catalog = {
    schemaVersion: 2, kind: 'baton.program_role_catalog', roles, catalogDigest,
  };
  const { catalogDigest: _omitted, ...sansDigest } = catalog;
  if (catalogDigest !== canonicalProgramDigest(sansDigest, deployed)) {
    fail('Role catalog catalogDigest does not match its canonical bytes');
  }
  const frozen = deepFreezeProgramValue(catalog);
  catalogs.add(frozen);
  return frozen;
}
